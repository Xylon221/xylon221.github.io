const encoder = new TextEncoder();
const pageSize = 20;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fields = 'id, nickname, avatar, message, created_at';

function reply(env, value, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': env.SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  return new Response(value === null ? null : JSON.stringify(value), { status, headers });
}

function articlePath(input) {
  if (typeof input !== 'string' || input.length > 600 || !/^\/\d{4}\/\d{2}\/[^/?#]+\/$/.test(input)) return '';
  try {
    const parts = input.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.some(part => /[/\\\x00-\x1f]/.test(part) || part === '.' || part === '..')) return '';
    return `/${parts.map(encodeURIComponent).join('/')}/`;
  } catch { return ''; }
}

async function requestData(request) {
  if (!request.body || !request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body.getReader();
  const decode = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decode.decode());
      size += value.length;
      if (size > 32_768) { await reader.cancel(); return null; }
      text += decode.decode(value, { stream: true });
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function isAvatar(value) {
  if (typeof value !== 'string' || value.length > 24_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const image = Uint8Array.from(atob(value.slice(23)), char => char.charCodeAt(0));
    if (image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) return false;
    for (let offset = 2; offset + 9 < image.length;) {
      if (image[offset++] !== 0xff) return false;
      while (image[offset] === 0xff) offset++;
      const marker = image[offset++];
      const length = (image[offset] << 8) | image[offset + 1];
      if (length < 2 || offset + length > image.length) return false;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        const height = (image[offset + 3] << 8) | image[offset + 4];
        const width = (image[offset + 5] << 8) | image[offset + 6];
        return width > 0 && width <= 128 && height > 0 && height <= 128;
      }
      if (marker === 0xda) return false;
      offset += length;
    }
  } catch { return false; }
  return false;
}

function publicComment(row) {
  return { id: row.id, nickname: row.nickname, avatar: row.avatar, message: row.message, createdAt: new Date(row.created_at).toISOString() };
}

async function list(requestUrl, env) {
  const article = articlePath(requestUrl.searchParams.get('article'));
  if (!article) return reply(env, { error: '文章地址无效。' }, 400);
  const before = requestUrl.searchParams.get('before');
  let statement;
  if (before) {
    const [time, id, extra] = before.split(':');
    if (!/^\d{13}$/.test(time) || !uuid.test(id) || extra !== undefined) return reply(env, { error: '分页参数无效。' }, 400);
    statement = env.DB.prepare(`SELECT ${fields} FROM comments WHERE article = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(article, Number(time), Number(time), id, pageSize + 1);
  } else {
    statement = env.DB.prepare(`SELECT ${fields} FROM comments WHERE article = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(article, pageSize + 1);
  }
  const { results } = await statement.all();
  const comments = results.slice(0, pageSize);
  const last = comments.at(-1);
  return reply(env, { comments: comments.map(publicComment), next: results.length > pageSize ? `${last.created_at}:${last.id}` : null });
}

async function authorKey(env, request, day) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.COMMENTS_ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const value = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}/${ip}`)));
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function add(request, env) {
  const draft = await requestData(request);
  const article = articlePath(draft?.article);
  const id = typeof draft?.requestId === 'string' ? draft.requestId : '';
  const nickname = typeof draft?.nickname === 'string' ? draft.nickname.trim() : '';
  const message = typeof draft?.message === 'string' ? draft.message.trim() : '';
  if (!article || !uuid.test(id) || draft.website || !nickname || nickname.length > 30 || !message || message.length > 1200 || !isAvatar(draft.avatar)) {
    return reply(env, { error: '请填写有效昵称、上传头像并输入评论。' }, 400);
  }
  const existing = await env.DB.prepare(`SELECT ${fields}, article FROM comments WHERE id = ?`).bind(id).first();
  if (existing?.article === article) return reply(env, { comment: publicComment(existing) });
  if (existing) return reply(env, { error: '提交信息已变化，请重新输入后提交。' }, 409);
  const index = await fetch(new URL('/search.json', env.SITE_ORIGIN));
  if (!index.ok) return reply(env, { error: '暂时无法核对文章。' }, 503);
  const posts = await index.json();
  if (!Array.isArray(posts) || !posts.some(post => articlePath(post?.url) === article)) return reply(env, { error: '找不到这篇已发布文章。' }, 404);
  const created_at = Date.now();
  const author = await authorKey(env, request, new Date(created_at).toISOString().slice(0, 10));
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO comments (id, article, nickname, avatar, message, created_at, author_key)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM comments WHERE author_key = ? AND created_at > ?)`)
    .bind(id, article, nickname, draft.avatar, message, created_at, author, author, created_at - 20_000).run();
  if (!result.meta.changes) {
    const retry = await env.DB.prepare(`SELECT ${fields}, article FROM comments WHERE id = ?`).bind(id).first();
    if (retry?.article === article) return reply(env, { comment: publicComment(retry) });
    return reply(env, { error: '提交太快，请稍等再发表。' }, 429);
  }
  return reply(env, { comment: publicComment({ id, nickname, avatar: draft.avatar, message, created_at }) }, 201);
}

async function isOwner(request, env) {
  const supplied = request.headers.get('authorization');
  if (!supplied?.startsWith('Bearer ') || supplied.length > 256) return false;
  const hashes = await Promise.all([supplied.slice(7), env.COMMENTS_ADMIN_KEY].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.SITE_ORIGIN || request.headers.get('origin') && request.headers.get('origin') !== env.SITE_ORIGIN) return reply(env, { error: '请求来源无效。' }, 403);
    if (request.method === 'OPTIONS') return reply(env, null, 204);
    if (!env.DB || (env.COMMENTS_ADMIN_KEY?.length || 0) < 32) return reply(env, { error: '评论服务尚未配置。' }, 503);
    try {
      if (url.pathname === '/comments' && request.method === 'GET') return await list(url, env);
      if (url.pathname === '/comments' && request.method === 'POST') return await add(request, env);
      const id = url.pathname.startsWith('/comments/') ? url.pathname.slice(10) : '';
      if (uuid.test(id) && request.method === 'DELETE') {
        if (!await isOwner(request, env)) return reply(env, { error: '只有站主可以删除评论。' }, 403);
        await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
        return reply(env, null, 204);
      }
      return reply(env, { error: '找不到这个接口。' }, 404);
    } catch { return reply(env, { error: '评论服务暂时不可用。' }, 503); }
  },
};
