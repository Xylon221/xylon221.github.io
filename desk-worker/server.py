"""Private reading-room API. Run on loopback behind an HTTPS reverse proxy."""

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import closing
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

KEY_FORMAT = re.compile(r"[A-Za-z0-9_-]{43}")
ENTRY_ROUTE = re.compile(r"/v1/entries/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})")
MONTH_FORMAT = re.compile(r"[1-9]\d{3}-(0[1-9]|1[0-2])")
SESSION_MS = 30 * 24 * 60 * 60 * 1000
BODY_LIMIT = 24 * 1024
COMMENT_ROUTE = re.compile(r"/v1/comments/([a-f0-9-]{36})(/like)?")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
ARTICLE_PATH = re.compile(r"/\d{4}/(?:0[1-9]|1[0-2])/[^/\s?#]+/")
EMAIL = re.compile(r"[^\s@]{1,100}@[^\s@.]+(?:\.[^\s@.]+)+")
JPEG_PREFIX = "data:image/jpeg;base64,"
JOURNAL_FIELDS = {"title": 80, "weather": 25, "mood": 25, "events": 1600,
                  "reflection": 2400, "goal_status": 12, "goal": 500, "exercise": 160}


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class RequestLimit:
    def __init__(self, limit):
        self.limit = limit
        self.lock = threading.Lock()
        self.attempts = OrderedDict()

    def allow(self, client):
        now = time.monotonic()
        with self.lock:
            while self.attempts and next(iter(self.attempts.values()))[0] <= now:
                self.attempts.popitem(last=False)
            if client in self.attempts:
                expires, count = self.attempts[client]
                self.attempts[client] = (expires, count + 1)
                return count < self.limit
            if len(self.attempts) >= 4096:
                self.attempts.popitem(last=False)
            self.attempts[client] = (now + 60, 1)
            return True


def now_ms():
    return time.time_ns() // 1_000_000


def valid_day(value):
    if not isinstance(value, str) or len(value) != 10 or "-" not in value:
        return False
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return False
    return day.year >= 1000 and day.isoformat() == value


def valid_body(value, limit):
    if not isinstance(value, str) or not 0 < len(value.strip()) <= limit:
        return False
    try:
        value.encode("utf-8")
        return True
    except UnicodeError:
        return False


def uuid_value(value):
    return isinstance(value, str) and UUID.fullmatch(value)


def article_path(value):
    article = unquote(value) if isinstance(value, str) and len(value) <= 600 else ""
    if not ARTICLE_PATH.fullmatch(article):
        raise RequestError(400, "文章路径有误。")
    return article


def comment_website(value):
    if not value:
        return ""
    if not valid_body(value, 300) or any(char.isspace() for char in value):
        raise RequestError(400, "网址格式有误。")
    try:
        site = urlsplit(value)
        if site.scheme in ("https", "http") and site.hostname and site.username is None and site.password is None:
            return value
    except ValueError:
        pass
    raise RequestError(400, "请输入以 https:// 或 http:// 开头的网址。")


def comment_image(value):
    if not value:
        return ""
    if isinstance(value, str) and len(value) <= 16500 and value.startswith(JPEG_PREFIX):
        try:
            data = base64.b64decode(value[len(JPEG_PREFIX):], validate=True)
            if data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
                return value
        except (ValueError, binascii.Error):
            pass
    raise RequestError(400, "图片过大或格式有误。")


class DeskServer(ThreadingHTTPServer):
    def __init__(self, address, database, site_origin, key):
        self.database = database
        self.site_origin = site_origin
        self.key = key
        self.login_limit = RequestLimit(10)
        self.comment_limit = RequestLimit(6)
        self.like_limit = RequestLimit(45)
        with closing(self.connect()) as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        super().__init__(address, DeskRequest)

    def connect(self):
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection


class DeskRequest(BaseHTTPRequestHandler):
    timeout = 15

    def log_message(self, message, *args):
        pass

    def reply(self, payload, status=200):
        origin = self.headers.get("Origin")
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if origin == self.server.site_origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        if status == 204:
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
            return
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise RequestError(415, "请使用 JSON 格式提交。")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= BODY_LIMIT:
                raise RequestError(413, "提交内容为空或过长。")
            value = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, RecursionError):
            raise RequestError(400, "提交格式有误。") from None

    def session_hash(self, token):
        return hmac.new(self.server.key.encode(), token.encode(), hashlib.sha256).hexdigest()

    def sign_in(self, connection):
        client = self.headers.get("X-Real-IP", self.client_address[0])
        if not self.server.login_limit.allow(client):
            raise RequestError(429, "登录尝试过多，请稍后再试。")
        supplied = self.read_json().get("key")
        if not (isinstance(supplied, str) and KEY_FORMAT.fullmatch(supplied)
                and hmac.compare_digest(supplied, self.server.key)):
            raise RequestError(401, "站主密钥有误。")
        token = secrets.token_urlsafe(32)
        timestamp = now_ms()
        connection.execute("DELETE FROM desk_sessions WHERE expires_at <= ?", (timestamp,))
        connection.execute("INSERT INTO desk_sessions (hash, expires_at) VALUES (?, ?)",
                           (self.session_hash(token), timestamp + SESSION_MS))
        return {"token": token}

    def authorize(self, connection):
        scheme, _, token = self.headers.get("Authorization", "").partition(" ")
        if scheme == "Bearer" and KEY_FORMAT.fullmatch(token):
            digest = self.session_hash(token)
            if connection.execute("SELECT 1 FROM desk_sessions WHERE hash = ? AND expires_at > ?",
                                  (digest, now_ms())).fetchone():
                return digest
        raise RequestError(401, "请登录后查看私人记录。")

    def read_day(self, connection, query):
        parameters = parse_qs(query)
        day = parameters.get("day", [""])[0]
        month = parameters.get("month", [""])[0]
        if not valid_day(day) or not MONTH_FORMAT.fullmatch(month):
            raise RequestError(400, "请选择有效日期。")
        connection.execute("BEGIN")
        entries = connection.execute(
            """SELECT id, kind, body, done, created_at, version FROM desk_entries
               WHERE day = ? AND deleted = 0 ORDER BY created_at, id""", (day,)
        ).fetchall()
        marks = connection.execute(
            "SELECT DISTINCT day FROM desk_entries WHERE day >= ? AND day < ? AND deleted = 0 ORDER BY day",
            (month + "-01", month + "-32")
        ).fetchall()
        payload = {"entries": [dict(entry) for entry in entries], "marked": [row["day"] for row in marks]}
        if parameters.get("overview") == ["1"]:
            journal = connection.execute("SELECT * FROM desk_journal WHERE day = ?", (day,)).fetchone()
            payload["journal"] = dict(journal) if journal else None
            payload["days"] = self.month_overview(connection, month)
        return payload

    def month_overview(self, connection, month):
        dates = {}
        bounds = (month + "-01", month + "-32")
        for row in connection.execute(
                "SELECT day, title, weather, mood, substr(reflection,1,260) AS reflection, goal_status"
                " FROM desk_journal WHERE day >= ? AND day < ? AND (title <> '' OR weather <> '' OR mood <> ''"
                " OR events <> '' OR reflection <> '' OR goal_status <> '' OR goal <> '' OR exercise <> '')", bounds):
            dates[row["day"]] = dict(row)
        for row in connection.execute(
                """SELECT day, sum(kind='task') AS tasks, sum(kind='task' AND done=1) AS done,
                          sum(kind='note') AS notes
                   FROM desk_entries WHERE day >= ? AND day < ? AND deleted=0 GROUP BY day""", bounds):
            dates.setdefault(row["day"], {}).update(dict(row))
        for row in connection.execute(
                """SELECT day, body, done FROM (
                   SELECT day, substr(body,1,100) AS body, done,
                   row_number() OVER (PARTITION BY day ORDER BY done,created_at,id) AS rank FROM desk_entries
                   WHERE day >= ? AND day < ? AND kind='task' AND deleted=0)
                   WHERE rank <= 2 ORDER BY day,rank""", bounds):
            dates[row["day"]].setdefault("preview", []).append({"body": row["body"], "done": row["done"]})
        return dates

    def save_journal(self, connection):
        data = self.read_json()
        day, version = data.get("day"), data.get("version")
        if not valid_day(day) or type(version) is not int or not 0 <= version < 2**53:
            raise RequestError(400, "日期或版本有误。")
        values = []
        for name, length in JOURNAL_FIELDS.items():
            value = data.get(name, "")
            if value != "" and not valid_body(value, length):
                raise RequestError(400, "日常记录内容有误或过长。")
            values.append(value.strip())
        if data.get("goal_status", "").strip() not in ("", "未开始", "进行中", "已完成"):
            raise RequestError(400, "目标状态有误。")
        columns = ",".join(JOURNAL_FIELDS)
        if version == 0:
            placeholders = ",".join("?" for _ in range(len(values) + 1))
            result = connection.execute(
                f"INSERT INTO desk_journal (day,{columns}) VALUES ({placeholders}) ON CONFLICT(day) DO NOTHING",
                [day, *values])
        else:
            assignments = ",".join(f"{name}=?" for name in JOURNAL_FIELDS)
            result = connection.execute(
                f"UPDATE desk_journal SET {assignments},version=version+1 WHERE day=? AND version=?",
                [*values, day, version])
        if not result.rowcount:
            raise RequestError(409, "这一天刚在其他设备上改过。已保留你的草稿，可载入云端版本。")

    def create_entry(self, connection):
        data = self.read_json()
        entry_id, day, kind, body = (data.get(field) for field in ("id", "day", "kind", "body"))
        if (not isinstance(entry_id, str) or not ENTRY_ROUTE.fullmatch("/v1/entries/" + entry_id)
                or not valid_day(day) or kind not in ("task", "note")
                or not valid_body(body, 160 if kind == "task" else 4000)):
            raise RequestError(400, "记录内容或日期有误。")
        body = body.strip()
        connection.execute(
            "INSERT INTO desk_entries (id, day, kind, body, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (entry_id, day, kind, body, now_ms())
        )
        saved = connection.execute("SELECT day, kind, body, deleted, version FROM desk_entries WHERE id = ?",
                                   (entry_id,)).fetchone()
        if (saved["deleted"] or saved["day"] != day or saved["kind"] != kind
                or (saved["version"] == 1 and saved["body"] != body)):
            raise RequestError(409, "这条记录已变动，请刷新后重试。")

    def change_entry(self, connection, entry_id):
        data = self.read_json()
        version = data.get("version")
        if type(version) is not int or not 1 <= version <= 2**53 - 1:
            raise RequestError(400, "记录版本有误。")
        if self.command == "DELETE":
            cursor = connection.execute(
                "UPDATE desk_entries SET deleted = 1, body = '', version = version + 1"
                " WHERE id = ? AND version = ? AND deleted = 0", (entry_id, version)
            )
        elif type(data.get("done")) is bool:
            cursor = connection.execute(
                "UPDATE desk_entries SET done = ?, version = version + 1"
                " WHERE id = ? AND version = ? AND kind = 'task' AND deleted = 0",
                (int(data["done"]), entry_id, version)
            )
        elif valid_body(data.get("body"), 4000):
            cursor = connection.execute(
                "UPDATE desk_entries SET body = ?, version = version + 1"
                " WHERE id = ? AND version = ? AND (kind = 'note' OR length(?) <= 160) AND deleted = 0",
                (data["body"].strip(), entry_id, version, data["body"].strip())
            )
        else:
            raise RequestError(400, "修改内容有误。")
        if not cursor.rowcount:
            raise RequestError(409, "这条记录已在其他设备上变动。请检查最新内容后重试。")

    def read_comments(self, connection, query):
        parameters = parse_qs(query)
        article = article_path(parameters.get("article", [""])[0])
        visitor = parameters.get("visitor", [""])[0]
        cursor = parameters.get("before", [""])[0]
        before = int(cursor) if re.fullmatch(r"[0-9]{1,18}", cursor) else 2**63 - 1
        fingerprint = self.session_hash("reaction:" + visitor) if uuid_value(visitor) else ""
        roots = connection.execute(
            """SELECT id,rowid FROM blog_comments WHERE article=? AND root_id IS NULL AND rowid<?
               AND (deleted=0 OR EXISTS (SELECT 1 FROM blog_comments AS reply
                  WHERE reply.root_id=blog_comments.id AND reply.deleted=0))
               ORDER BY rowid DESC LIMIT 13""", (article, before)).fetchall()
        threads = roots[:12]
        comments = []
        if threads:
            ids = [root["id"] for root in threads]
            keys = ",".join("?" for _ in ids)
            rows = connection.execute(
                f"""SELECT comment.id, comment.parent_id, comment.root_id, comment.nickname, comment.website,
                           comment.message, comment.image, comment.created_at, comment.deleted,
                           parent.nickname AS reply_to,
                           instr('0123456789abcdef', substr(comment.email_hash,1,1)) % 5 AS avatar_tone,
                           (SELECT count(*) FROM blog_comment_likes WHERE comment_id=comment.id) AS likes,
                           EXISTS (SELECT 1 FROM blog_comment_likes WHERE comment_id=comment.id AND visitor=?) AS liked
                      FROM blog_comments AS comment LEFT JOIN blog_comments AS parent ON parent.id=comment.parent_id
                     WHERE comment.id IN ({keys}) OR (comment.root_id IN ({keys}) AND comment.deleted=0)
                     ORDER BY comment.rowid""", [fingerprint, *ids, *ids]).fetchall()
            groups = {root: [] for root in ids}
            for row in rows:
                groups[row["root_id"] or row["id"]].append(dict(row))
            comments = [comment for root in ids for comment in groups[root]]
        count = connection.execute(
            "SELECT count(*) FROM blog_comments WHERE article=? AND deleted=0", (article,)).fetchone()[0]
        return {"comments": comments, "count": count, "next": threads[-1]["rowid"] if len(roots) > 12 else None}

    def post_comment(self, connection):
        client = self.headers.get("X-Real-IP", self.client_address[0])
        if not self.server.comment_limit.allow(client):
            raise RequestError(429, "发表评论太频繁，请稍后再试。")
        data = self.read_json()
        if data.get("trap"):
            raise RequestError(400, "评论未提交。")
        comment_id, message = data.get("id"), data.get("message")
        article = article_path(data.get("article"))
        parent = data.get("parent") or None
        if not uuid_value(comment_id) or (parent and not uuid_value(parent)):
            raise RequestError(400, "评论或回复目标有误。")
        image = comment_image(data.get("image"))
        if not valid_body(message, 500) and not (message == "" and image):
            raise RequestError(400, "请输入 500 字以内的留言，或附上一张图片。")
        anonymous = data.get("anonymous") is True
        if anonymous:
            nickname, email_hash, website = "匿名访客", "", ""
        else:
            nickname, email = data.get("nickname"), data.get("email")
            if not valid_body(nickname, 30) or not valid_body(email, 254) or not EMAIL.fullmatch(email.strip()):
                raise RequestError(400, "请填写昵称和有效邮箱。")
            nickname = nickname.strip()
            email_hash = self.session_hash("comment-email:" + email.strip().lower())
            website = comment_website(data.get("website"))
        root = None
        if parent:
            origin = connection.execute(
                "SELECT root_id FROM blog_comments WHERE id=? AND article=? AND deleted=0", (parent, article)).fetchone()
            if origin is None:
                raise RequestError(404, "这条评论已不可回复。")
            root = origin["root_id"] or parent
        connection.execute(
            """INSERT INTO blog_comments
               (id,article,parent_id,root_id,nickname,email_hash,website,message,image,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING""",
            (comment_id, article, parent, root, nickname, email_hash, website, message.strip(), image, now_ms()))

    def like_comment(self, connection, comment_id):
        client = self.headers.get("X-Real-IP", self.client_address[0])
        if not self.server.like_limit.allow(client):
            raise RequestError(429, "操作太频繁，请稍后再试。")
        data = self.read_json()
        visitor, liked = data.get("visitor"), data.get("liked")
        if not uuid_value(visitor) or type(liked) is not bool:
            raise RequestError(400, "点赞请求有误。")
        fingerprint = self.session_hash("reaction:" + visitor)
        connection.execute("BEGIN IMMEDIATE")
        if not connection.execute("SELECT 1 FROM blog_comments WHERE id=? AND deleted=0", (comment_id,)).fetchone():
            raise RequestError(404, "这条评论已不可用。")
        if liked:
            connection.execute("INSERT OR IGNORE INTO blog_comment_likes VALUES (?,?)", (comment_id, fingerprint))
        else:
            connection.execute("DELETE FROM blog_comment_likes WHERE comment_id=? AND visitor=?", (comment_id, fingerprint))
        count = connection.execute(
            "SELECT count(*) FROM blog_comment_likes WHERE comment_id=?", (comment_id,)).fetchone()[0]
        return {"likes": count, "liked": liked}

    def route(self, connection, url):
        path, method = url.path, self.command
        if path == "/v1/comments":
            if method == "GET":
                return self.read_comments(connection, url.query), 200
            if method == "POST":
                self.post_comment(connection)
                return {"ok": True}, 201
        if match := COMMENT_ROUTE.fullmatch(path):
            if method == "PATCH" and match[2]:
                return self.like_comment(connection, match[1]), 200
            if method == "DELETE" and not match[2]:
                self.authorize(connection)
                connection.execute(
                    "UPDATE blog_comments SET deleted=1,nickname='',email_hash='',website='',message='',image='' WHERE id=?",
                    (match[1],))
                connection.execute("DELETE FROM blog_comment_likes WHERE comment_id=?", (match[1],))
                return {"ok": True}, 200
        if path == "/v1/session" and method == "POST":
            return self.sign_in(connection), 200
        digest = self.authorize(connection)
        if path == "/v1/session" and method == "DELETE":
            connection.execute("DELETE FROM desk_sessions WHERE hash = ?", (digest,))
        elif path == "/v1/day" and method == "GET":
            return self.read_day(connection, url.query), 200
        elif path == "/v1/journal" and method == "PATCH":
            self.save_journal(connection)
        elif path == "/v1/entries" and method == "POST":
            self.create_entry(connection)
            return {"ok": True}, 201
        elif method in ("PATCH", "DELETE") and (match := ENTRY_ROUTE.fullmatch(path)):
            self.change_entry(connection, match[1])
        else:
            raise RequestError(404, "接口不存在。")
        return {"ok": True}, 200

    def handle_request(self):
        origin = self.headers.get("Origin")
        if origin and origin != self.server.site_origin:
            self.reply({"message": "此来源不可访问。"}, 403)
            return
        if self.command == "OPTIONS":
            self.reply(None, 204)
            return
        try:
            with closing(self.server.connect()) as connection, connection:
                payload, status = self.route(connection, urlsplit(self.path))
        except RequestError as error:
            payload, status = {"message": str(error)}, error.status
        except (sqlite3.Error, OSError, UnicodeError):
            payload, status = {"message": "云同步暂时不可用，请稍后重试。"}, 503
        try:
            self.reply(payload, status)
        except (BrokenPipeError, ConnectionResetError):
            pass

    do_GET = do_POST = do_PATCH = do_DELETE = do_OPTIONS = handle_request


if __name__ == "__main__":
    key = Path(os.environ["DESK_KEY_FILE"]).read_text(encoding="ascii").strip()
    if not KEY_FORMAT.fullmatch(key):
        raise SystemExit("DESK_KEY_FILE must contain a 32-byte URL-safe secret.")
    server = DeskServer(
        ("127.0.0.1", int(os.environ.get("DESK_PORT", "8786"))),
        os.environ["DESK_DATABASE"], os.environ["DESK_SITE_ORIGIN"], key
    )
    server.serve_forever()
