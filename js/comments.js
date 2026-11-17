import { commentsEndpoint } from './comments-config.js?v=1';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
const avatarPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

async function avatarData(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MB 的头像。');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('无法读取头像，请换一张图片。');
  try {
    const width = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const draw = canvas.getContext('2d');
    draw.fillStyle = '#fff';
    draw.fillRect(0, 0, 96, 96);
    draw.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - width) / 2, width, width, 0, 0, 96, 96);
    return canvas.toDataURL('image/jpeg', .78);
  } finally { bitmap.close(); }
}

async function request(api, path, options = {}) {
  const response = await fetch(new URL(path, api), { ...options, credentials: 'omit', cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '评论服务暂时不可用。');
  return data;
}

export function mountComments(article) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/css/comments.css?v=1';
  document.head.append(stylesheet);
  const section = document.createElement('section');
  section.className = 'site-comments';
  section.id = 'comments';
  section.setAttribute('aria-labelledby', 'comments-title');
  section.innerHTML = `
    <header class="comments-heading"><h2 id="comments-title">评论</h2><p id="comments-state" role="status"></p></header>
    <form class="comments-form">
      <fieldset disabled>
        <div class="comments-author">
          <label>昵称<input name="nickname" type="text" maxlength="30" required placeholder="给大家一个称呼"></label>
          <label>头像<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" required></label>
        </div>
        <label>留言<textarea name="message" maxlength="1200" rows="4" required placeholder="写下你想交流的内容"></textarea></label>
        <label class="comments-trap" aria-hidden="true">网站<input name="website" tabindex="-1" autocomplete="off"></label>
        <button type="submit">发表评论</button>
      </fieldset>
    </form>
    <details class="comments-moderation" hidden><summary>站主管理</summary><label>管理密钥<input type="password" autocomplete="off"></label></details>
    <div class="comments-list" aria-label="已发布的评论"></div>
    <button type="button" class="comments-more" hidden>加载更多评论</button>`;
  article.append(section);
  const status = section.querySelector('#comments-state');
  let api;
  try { if (commentsEndpoint) api = new URL('/', commentsEndpoint); } catch { /* missing configuration */ }
  if (!api) {
    status.textContent = '评论服务尚未连接。';
    return;
  }
  const articlePath = location.pathname;
  const form = section.querySelector('form');
  const fields = form.querySelector('fieldset');
  const list = section.querySelector('.comments-list');
  const more = section.querySelector('.comments-more');
  const moderation = section.querySelector('.comments-moderation');
  const secret = moderation.querySelector('input');
  const admin = new URL(location.href).searchParams.get('moderate') === '1';
  moderation.hidden = !admin;
  const ids = new Set();
  let cursor = '';
  let requestId = crypto.randomUUID();

  function addComment(comment, atStart = false) {
    if (ids.has(comment.id)) return;
    ids.add(comment.id);
    const row = document.createElement('article');
    row.className = 'comment-entry';
    const avatar = document.createElement('img');
    avatar.className = 'comment-avatar';
    avatar.alt = '';
    if (avatarPattern.test(comment.avatar)) avatar.src = comment.avatar;
    const copy = document.createElement('div');
    const header = document.createElement('header');
    const nickname = document.createElement('strong');
    nickname.textContent = comment.nickname;
    const time = document.createElement('time');
    const date = new Date(comment.createdAt);
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    time.title = '北京时间';
    header.append(nickname, time);
    if (admin) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', async () => {
        const key = secret.value.trim();
        if (!key) { moderation.open = true; secret.focus(); return; }
        if (!window.confirm('删除这条公开评论？')) return;
        remove.disabled = true;
        try {
          await request(api, `comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } });
          row.remove();
          ids.delete(comment.id);
          status.textContent = '评论已删除。';
        } catch (error) { status.textContent = error.message; }
        finally { remove.disabled = false; }
      });
      header.append(remove);
    }
    const message = document.createElement('p');
    message.textContent = comment.message;
    copy.append(header, message);
    row.append(avatar, copy);
    if (atStart) list.prepend(row);
    else list.append(row);
  }

  async function loadComments() {
    more.disabled = true;
    status.textContent = '正在读取评论…';
    try {
      const params = new URLSearchParams({ article: articlePath, ...(cursor ? { before: cursor } : {}) });
      const data = await request(api, `comments?${params}`);
      for (const comment of data.comments) addComment(comment);
      cursor = data.next || '';
      more.hidden = !cursor;
      status.textContent = ids.size ? '' : '还没有评论。';
    } catch { status.textContent = '暂时无法读取评论。'; }
    finally { more.disabled = false; }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    fields.disabled = true;
    status.textContent = '正在发表…';
    try {
      const avatar = await avatarData(data.get('avatar'));
      const payload = { article: articlePath, nickname: data.get('nickname'), message: data.get('message'), website: data.get('website'), avatar, requestId };
      const result = await request(api, 'comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      addComment(result.comment, true);
      form.reset();
      requestId = crypto.randomUUID();
      status.textContent = '评论已发表。';
    } catch (error) { status.textContent = error.message; }
    finally { fields.disabled = false; }
  });
  form.addEventListener('input', () => { requestId = crypto.randomUUID(); });
  more.addEventListener('click', loadComments);
  fields.disabled = false;
  loadComments();
}
