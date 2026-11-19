import { commentsEndpoint } from './comments-config.js?v=2';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeZone: 'Asia/Shanghai' });
const safeImage = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const visitorKey = 'reading-room:comment-visitor';
const sessionKey = 'reading-room:desk-session:v1';
function stored(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function visitorId() {
  const value = stored(visitorKey);
  if (/^[a-f0-9-]{36}$/.test(value)) return value;
  const id = crypto.randomUUID();
  try { localStorage.setItem(visitorKey, id); } catch { /* This visit can still react. */ }
  return id;
}

async function prepareImage(file) {
  if (file.size > 6 * 1024 * 1024) throw new Error('请选择不超过 6 MB 的图片。');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('无法读取这张图片。');
  try {
    const canvas = document.createElement('canvas');
    const draw = canvas.getContext('2d', { alpha: false });
    for (const size of [460, 320, 235, 160]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      draw.fillStyle = '#fff';
      draw.fillRect(0, 0, canvas.width, canvas.height);
      draw.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', .69);
      if (image.length <= 16500) return image;
    }
    throw new Error('图片压缩后仍然过大。');
  } finally { bitmap.close(); }
}

export function mountComments(article) {
  if (document.getElementById('comments')) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/css/comments.css?v=3';
  document.head.append(stylesheet);
  const section = document.createElement('section');
  section.id = 'comments';
  section.className = 'site-comments';
  section.setAttribute('aria-labelledby', 'comments-title');
  section.innerHTML = `
    <header class="comments-heading">
      <h2 id="comments-title">评论</h2>
      <div class="comment-options">
        <label><input id="comment-anonymous" type="checkbox" form="comment-form"> 匿名评论</label>
        <details><summary>隐私说明</summary><p>提交的昵称、留言、网址和图片可公开查看。邮箱只保留摘要。点赞使用浏览器的随机标识。</p></details>
      </div>
    </header>
    <form id="comment-form">
      <div class="comment-reply" hidden><span></span><button type="button">取消回复</button></div>
      <div class="comment-compose">
        <textarea name="message" aria-label="评论内容" maxlength="500" rows="4" placeholder="写下你的想法"></textarea>
        <div class="comment-compose-tools">
          <details class="comment-emojis"><summary>表情</summary><div aria-label="插入表情"></div></details>
          <label class="comment-image-select">图片<input aria-label="添加评论图片" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
          <output id="comment-length">0 / 500</output>
        </div>
        <div class="comment-image-preview" hidden><img alt="待上传图片"><button type="button">移除图片</button></div>
      </div>
      <div class="comment-author">
        <label>昵称<input name="nickname" autocomplete="nickname" maxlength="30" required placeholder="必填"></label>
        <label>邮箱<input type="email" name="email" autocomplete="email" maxlength="254" required placeholder="必填"></label>
        <label>网址<input type="url" name="website" maxlength="300" placeholder="选填"></label>
        <label class="comment-trap" aria-hidden="true">网站<input name="trap" tabindex="-1" autocomplete="off"></label>
        <button type="submit" class="comment-submit">发送</button>
      </div>
    </form>
    <p class="comment-status" role="status"></p>
    <div class="comments-list-heading"><strong id="comment-count">评论记录</strong><button id="comment-refresh" type="button">刷新</button></div>
    <div class="comments-list" aria-labelledby="comment-count"></div>
    <button type="button" id="comment-more" hidden>加载更多</button>`;
  article.append(section);
  if (location.hash === '#comments') requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));

  const query = selector => section.querySelector(selector);
  const form = query('#comment-form');
  const message = form.elements.message;
  const anonymous = query('#comment-anonymous');
  const submit = query('.comment-submit');
  const status = query('.comment-status');
  const list = query('.comments-list');
  const more = query('#comment-more');
  const refresh = query('#comment-refresh');
  const replyLine = query('.comment-reply');
  const imageFile = query('.comment-image-select input');
  const imagePreview = query('.comment-image-preview');
  const visitor = visitorId();
  const articlePath = location.pathname;
  const admin = new URL(location.href).searchParams.get('moderate') === '1';
  const endpoint = commentsEndpoint.replace(/\/$/, '') + '/v1/comments';
  let parent = '';
  let image = '';
  let imageAttempt = 0;
  let imageBusy = false;
  let cursor = null;
  let loading = false;
  let posting = false;
  let pending = null;
  let items = [];

  function updateForm() {
    query('#comment-length').textContent = message.value.length + ' / 500';
    submit.disabled = !commentsEndpoint || loading || posting || imageBusy || (!message.value.trim() && !image);
  }

  async function request(path = '', options = {}) {
    const response = await fetch(endpoint + path, { ...options, cache: 'no-store', credentials: 'omit',
      redirect: 'error', signal: AbortSignal.timeout(14000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || '评论暂时不可用。');
    return data;
  }

  function clearReply() {
    parent = '';
    replyLine.hidden = true;
  }

  function setImage(value) {
    image = value;
    const preview = imagePreview.querySelector('img');
    if (value) preview.src = value;
    else preview.removeAttribute('src');
    imagePreview.hidden = !value;
    updateForm();
  }

  function button(label, perform) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', () => perform(control));
    return control;
  }

  function setLike(control, value) {
    control.setAttribute('aria-pressed', String(Boolean(value.liked)));
    control.textContent = value.likes ? '赞 ' + value.likes : '赞';
    control.setAttribute('aria-label', (value.liked ? '取消赞' : '点赞') + (value.likes ? '，' + value.likes + ' 个赞' : ''));
  }

  function row(comment) {
    const entry = document.createElement('article');
    entry.className = 'comment-entry';
    if (comment.deleted) {
      const deleted = document.createElement('p');
      deleted.className = 'comment-deleted';
      deleted.textContent = '这条评论已删除。';
      entry.append(deleted);
      return entry;
    }
    const avatar = document.createElement('span');
    avatar.className = 'comment-avatar';
    avatar.textContent = Array.from(comment.nickname)[0] || '访';
    avatar.dataset.tone = comment.avatar_tone || 0;
    avatar.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const header = document.createElement('header');
    const author = document.createElement(comment.website ? 'a' : 'strong');
    author.textContent = comment.nickname;
    if (comment.website) {
      const url = new URL(comment.website);
      if (['https:', 'http:'].includes(url.protocol)) author.href = url.href;
      author.rel = 'noopener noreferrer nofollow ugc';
      author.target = '_blank';
    }
    const time = document.createElement('time');
    const date = new Date(comment.created_at);
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    const tools = document.createElement('div');
    tools.className = 'comment-row-actions';
    const like = button('赞', async control => {
      control.disabled = true;
      try {
        const data = await request('/' + comment.id + '/like', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitor, liked: !comment.liked }),
        });
        Object.assign(comment, data);
        setLike(control, comment);
      } catch (error) { status.textContent = error.message; }
      finally { control.disabled = false; }
    });
    setLike(like, comment);
    tools.append(like, button('回复', () => {
      parent = comment.id;
      replyLine.querySelector('span').textContent = '回复 @' + comment.nickname;
      replyLine.hidden = false;
      message.focus();
    }));
    const token = admin && stored(sessionKey);
    if (token) tools.append(button('删除', async () => {
      if (!confirm('删除这条公开评论？')) return;
      try {
        await request('/' + comment.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        void load();
      } catch (error) { status.textContent = error.message; }
    }));
    header.append(author, time, tools);
    content.append(header);
    if (comment.parent_id) {
      const target = document.createElement('p');
      target.className = 'comment-target';
      target.textContent = comment.reply_to ? '回复 @' + comment.reply_to : '回复已删除的评论';
      content.append(target);
    }
    if (comment.message) {
      const text = document.createElement('p');
      text.className = 'comment-text';
      text.textContent = comment.message;
      content.append(text);
    }
    if (safeImage.test(comment.image)) {
      const attachment = document.createElement('img');
      attachment.className = 'comment-attachment';
      attachment.alt = '评论附图';
      attachment.loading = 'lazy';
      attachment.src = comment.image;
      content.append(attachment);
    }
    entry.append(avatar, content);
    return entry;
  }

  function render(count) {
    const content = document.createDocumentFragment();
    const threads = new Map();
    for (const comment of items) {
      if (!comment.root_id) {
        const thread = document.createElement('div');
        thread.className = 'comment-thread';
        thread.append(row(comment));
        threads.set(comment.id, thread);
        content.append(thread);
      } else {
        const reply = row(comment);
        reply.classList.add('comment-child');
        threads.get(comment.root_id)?.append(reply);
      }
    }
    query('#comment-count').textContent = count + ' 条评论';
    if (!count) {
      const empty = document.createElement('p');
      empty.className = 'comments-empty';
      empty.textContent = '还没有评论。';
      content.append(empty);
    }
    list.replaceChildren(content);
    more.hidden = !cursor;
  }

  async function load(append = false, success = '') {
    if (loading || !commentsEndpoint) return;
    loading = refresh.disabled = more.disabled = true;
    updateForm();
    status.textContent = '';
    try {
      const parameters = new URLSearchParams({ article: articlePath, visitor });
      if (append && cursor) parameters.set('before', cursor);
      const data = await request('?' + parameters);
      cursor = data.next;
      items = append ? [...items, ...data.comments] : data.comments;
      render(data.count);
      status.textContent = success;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      loading = refresh.disabled = more.disabled = false;
      updateForm();
    }
  }

  message.addEventListener('input', updateForm);
  replyLine.querySelector('button').addEventListener('click', clearReply);
  anonymous.addEventListener('change', () => {
    for (const name of ['nickname', 'email', 'website']) form.elements[name].disabled = anonymous.checked;
  });
  const emojis = query('.comment-emojis');
  for (const emoji of ['🙂', '👍', '✨', '🎉', '🤔', '🙏']) emojis.querySelector('div').append(button(emoji, () => {
    const start = message.selectionStart;
    const stop = message.selectionEnd;
    if (message.value.length - (stop - start) + emoji.length > 500) return;
    message.setRangeText(emoji, start, stop, 'end');
    emojis.open = false;
    message.focus();
    updateForm();
  }));
  imageFile.addEventListener('change', async () => {
    const file = imageFile.files[0];
    if (!file) return;
    const attempt = ++imageAttempt;
    status.textContent = '';
    imageBusy = true;
    updateForm();
    try {
      const value = await prepareImage(file);
      if (attempt === imageAttempt) setImage(value);
    } catch (error) {
      if (attempt === imageAttempt) status.textContent = error.message;
    } finally {
      if (attempt === imageAttempt) { imageBusy = false; updateForm(); }
    }
  });
  imagePreview.querySelector('button').addEventListener('click', () => {
    imageAttempt++;
    imageBusy = false;
    imageFile.value = '';
    setImage('');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = Object.fromEntries(new FormData(form));
    Object.assign(data, { anonymous: anonymous.checked, article: articlePath, parent, image, message: message.value.trim() });
    const signature = JSON.stringify(data);
    if (pending?.signature !== signature) pending = { signature, id: crypto.randomUUID() };
    posting = true;
    updateForm();
    try {
      await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: pending.id }) });
      if (message.value.trim() === data.message) message.value = '';
      if (parent === data.parent) clearReply();
      if (image === data.image) { imageFile.value = ''; setImage(''); }
      pending = null;
      await load(false, '评论已发送。');
    } catch (error) {
      status.textContent = error.message;
    } finally {
      posting = false;
      updateForm();
    }
  });
  refresh.addEventListener('click', () => void load());
  more.addEventListener('click', () => void load(true));
  updateForm();
  if (commentsEndpoint) void load();
  else status.textContent = '评论服务暂时不可用。';
}
