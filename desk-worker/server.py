"""Private reading-room API. Run on loopback behind an HTTPS reverse proxy."""

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
from urllib.parse import parse_qs, urlsplit

KEY_FORMAT = re.compile(r"[A-Za-z0-9_-]{43}")
ENTRY_ROUTE = re.compile(r"/v1/entries/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})")
MONTH_FORMAT = re.compile(r"[1-9]\d{3}-(0[1-9]|1[0-2])")
SESSION_MS = 30 * 24 * 60 * 60 * 1000
BODY_LIMIT = 24 * 1024


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class LoginLimit:
    def __init__(self):
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
                return count < 10
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


class DeskServer(ThreadingHTTPServer):
    def __init__(self, address, database, site_origin, key):
        self.database = database
        self.site_origin = site_origin
        self.key = key
        self.login_limit = LoginLimit()
        with closing(self.connect()) as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        super().__init__(address, DeskRequest)

    def connect(self):
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
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
        return {"entries": [dict(entry) for entry in entries], "marked": [row["day"] for row in marks]}

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
                " WHERE id = ? AND version = ? AND kind = 'note' AND deleted = 0",
                (data["body"].strip(), entry_id, version)
            )
        else:
            raise RequestError(400, "修改内容有误。")
        if not cursor.rowcount:
            raise RequestError(409, "这条记录已在其他设备上变动。请检查最新内容后重试。")

    def route(self, connection, url):
        path, method = url.path, self.command
        if path == "/v1/session" and method == "POST":
            return self.sign_in(connection), 200
        digest = self.authorize(connection)
        if path == "/v1/session" and method == "DELETE":
            connection.execute("DELETE FROM desk_sessions WHERE hash = ?", (digest,))
        elif path == "/v1/day" and method == "GET":
            return self.read_day(connection, url.query), 200
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
