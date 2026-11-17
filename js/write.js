import { openDrafts, draftTransaction } from './write-drafts.js?v=1';
import { articleBody, publishArticle, PublishedDraftChanged } from './write-publish.js?v=3';
import { plainText } from './article-text.js?v=1';
import { createEditor } from './write-editor.js?v=1';

const form = document.getElementById('write-form');
const fields = document.getElementById('write-fields');
const blocks = document.getElementById('content-blocks');
const title = document.getElementById('post-title');
const category = document.getElementById('post-category');
const date = document.getElementById('post-date');
const tags = document.getElementById('post-tags');
const files = document.getElementById('image-files');
const tokenInput = document.getElementById('github-token');
const status = document.getElementById('write-status');
const draftStatus = document.getElementById('draft-status');
const preview = document.getElementById('write-preview');
const imageError = document.getElementById('image-error');
const modeButtons = [...document.querySelectorAll('button[data-mode]')];
const noteOptions = document.getElementById('note-options');
const properties = document.getElementById('write-properties');
const publishOptions = document.getElementById('publish-options');
const drafts = new Map();
const images = new Map();
const editors = new Map();
const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const categories = { technical: '技术笔记', privacy: '技术笔记 / 隐私计算', life: '生活随笔' };
let db;
let mode;
let draftId;
let saveTimer;
let saveRevision = 0;
let busy = false;

function today() {
  const now = new Date();
  const part = number => String(number).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
}

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('write-error', error);
}

function appendStatusLink(url, label) {
  const link = document.createElement('a');
  link.href = url;
  link.textContent = label;
  status.append(' ', link);
}

function addBlock(kind) {
  const block = document.getElementById(`${kind}-block`).content.firstElementChild.cloneNode(true);
  block.querySelector('.remove-block').addEventListener('click', () => {
    const image = images.get(block);
    if (image) URL.revokeObjectURL(image.preview);
    images.delete(block);
    editors.delete(block);
    block.remove();
    preview.hidden = true;
    imageError.textContent = '';
    if (!blocks.firstElementChild) addText(true);
    queueSave();
  });
  blocks.append(block);
  return block;
}

function addText(focus = false, draft) {
  const block = addBlock('text');
  const editor = createEditor(block, { note: mode === 'note', draft, onChange: () => {
    preview.hidden = true;
    queueSave();
  } });
  editors.set(block, editor);
  if (focus) editor.focus();
}

function addImage(file, caption = '') {
  const block = addBlock('image');
  const previewUrl = URL.createObjectURL(file);
  images.set(block, { file, preview: previewUrl });
  block.querySelector('img').src = previewUrl;
  block.querySelector('.image-name').textContent = file.name;
  block.querySelector('input').value = caption;
}

function resetBlocks() {
  for (const image of images.values()) URL.revokeObjectURL(image.preview);
  images.clear();
  editors.clear();
  blocks.replaceChildren();
}

function snapshot() {
  return {
    id: draftId, mode, title: title.value, date: date.value, category: category.value, tags: tags.value,
    blocks: [...blocks.children].map(block => block.dataset.kind === 'text'
      ? { kind: 'text', ops: editors.get(block).getContents().ops }
      : { kind: 'image', file: images.get(block).file, caption: block.querySelector('input').value }),
  };
}

function queueSave() {
  clearTimeout(saveTimer);
  saveRevision++;
  saveTimer = setTimeout(saveDraft, 220);
}

function saveDraft() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const revision = saveRevision;
  const draft = snapshot();
  drafts.set(mode, draft);
  if (!db) return;
  draftTransaction(db, 'readwrite', store => store.put(draft)).then(() => {
    if (mode === draft.mode && revision === saveRevision) draftStatus.textContent = '草稿已保存到当前浏览器';
  }).catch(() => {
    if (mode === draft.mode && revision === saveRevision) draftStatus.textContent = '草稿保存失败，请保留此页面';
  });
}

function showMode(nextMode) {
  mode = nextMode;
  saveRevision++;
  const note = mode === 'note';
  const draft = drafts.get(mode);
  form.dataset.mode = mode;
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  noteOptions.hidden = !note;
  if (note) noteOptions.append(properties);
  else fields.insertBefore(properties, document.getElementById('write-content'));
  document.getElementById('category-label').hidden = note;
  category.disabled = note;
  title.required = !note;
  date.required = !note;
  document.getElementById('title-label').textContent = note ? '标题（选填）' : '标题';
  document.getElementById('publish-button').textContent = note ? '发布随笔' : '发布文章';
  document.getElementById('publish-target').textContent = note ? '随笔发布后会出现在「生活随笔」和归档。' : '文章发布后会出现在书房和归档。';
  draftId = draft?.id ?? crypto.randomUUID().slice(0, 12);
  title.value = draft?.title ?? '';
  category.value = draft?.category || 'technical';
  date.value = draft?.date ?? today();
  tags.value = draft?.tags ?? '';
  tokenInput.value = '';
  noteOptions.open = note && Boolean(title.value || tags.value || date.value !== today());
  publishOptions.open = false;
  resetBlocks();
  for (const block of draft?.blocks ?? []) {
    if (block.kind === 'text') addText(false, block);
    else addImage(block.file, block.caption);
  }
  if (!blocks.firstElementChild) addText();
  preview.hidden = true;
  imageError.textContent = '';
  draftStatus.textContent = db
    ? (draft ? '已恢复草稿' : '草稿保存在当前浏览器')
    : '浏览器暂时无法保存草稿，请保留此页面';
}

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    if (busy || mode === button.dataset.mode) return;
    saveDraft();
    showMode(button.dataset.mode);
    const url = new URL(location.href);
    if (mode === 'note') url.searchParams.set('mode', 'note');
    else url.searchParams.delete('mode');
    history.replaceState(history.state, '', url);
    message('');
  });
}

form.addEventListener('input', event => {
  if (event.target === tokenInput || event.target === files || event.target.closest('.write-rich')) return;
  preview.hidden = true;
  queueSave();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); });
window.addEventListener('pagehide', saveDraft);

document.getElementById('add-text').addEventListener('click', () => {
  addText(true);
  queueSave();
});
document.getElementById('add-image').addEventListener('click', () => files.click());
files.addEventListener('change', () => {
  imageError.textContent = '';
  let added = false;
  for (const file of files.files) {
    if (images.size >= 12) {
      imageError.textContent = '每篇最多添加 12 张图片。';
      break;
    }
    if (!formats[file.type] || file.size === 0 || file.size > 8 * 1024 * 1024) {
      imageError.textContent = '请选用不超过 8 MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片。';
      continue;
    }
    addImage(file);
    added = true;
  }
  preview.hidden = true;
  files.value = '';
  if (added) queueSave();
});

function readDraft() {
  const heading = title.value.trim();
  const note = mode === 'note';
  const day = date.value || (note ? today() : '');
  if (!heading && !note) throw new Error('请填写文章标题。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('请选择有效的发布日期。');
  const labels = [...new Map(tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()];
  if (labels.length > 10 || labels.some(tag => !/^[\p{L}\p{N}_+-]+(?: [\p{L}\p{N}_+-]+)*$/u.test(tag)
      || tag.length > 36 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(tag))) {
    throw new Error('最多填 10 个标签，用逗号隔开。每个标签可使用文字、数字、空格、短横线、下划线和加号。');
  }
  const content = [];
  let number = 0;
  for (const block of blocks.children) {
    if (block.dataset.kind === 'text') {
      const ops = editors.get(block).getContents().ops;
      const text = plainText(ops);
      if (text) content.push({ kind: 'text', text, ops });
    } else {
      const image = images.get(block);
      const caption = block.querySelector('input').value.trim();
      content.push({ kind: 'image', ...image, caption, path: `assets/image-${++number}.${formats[image.file.type]}` });
    }
  }
  if (!content.length) throw new Error('请写一段文字或添加一张图片。');
  return { id: draftId, title: heading, date: day, category: note ? 'life' : category.value, tags: labels, blocks: content };
}

document.getElementById('show-preview').addEventListener('click', () => {
  try {
    const draft = readDraft();
    const heading = preview.querySelector('h2');
    heading.textContent = draft.title;
    heading.hidden = !draft.title;
    preview.querySelector('.preview-meta').textContent = [draft.date, categories[draft.category], ...draft.tags.map(tag => `#${tag}`)].join(' · ');
    preview.querySelector('.write-prose').innerHTML = articleBody(draft.blocks, image => image.preview);
    preview.hidden = false;
    message('');
    preview.focus({ preventScroll: true });
    preview.scrollIntoView({ block: 'start' });
  } catch (error) {
    message(error.message, true);
  }
});

document.getElementById('resume-writing').addEventListener('click', () => {
  preview.hidden = true;
  const editor = editors.values().next().value;
  if (editor) editor.focus();
  else document.getElementById('add-text').focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let draft;
  try { draft = readDraft(); } catch (error) { message(error.message, true); return; }
  const token = tokenInput.value.trim();
  if (!token.startsWith('github_pat_')) {
    message('请先填写 GitHub 细粒度发布令牌。', true);
    tokenInput.focus();
    return;
  }
  tokenInput.value = '';
  busy = true;
  fields.disabled = true;
  for (const editor of editors.values()) editor.disable();
  for (const button of modeButtons) button.disabled = true;
  saveDraft();
  try {
    const url = await publishArticle(draft, token, message);
    drafts.delete(mode);
    let cleared = true;
    if (db) {
      try { await draftTransaction(db, 'readwrite', store => store.delete(mode)); }
      catch { cleared = false; }
    }
    const item = mode === 'note' ? '随笔' : '文章';
    showMode(mode);
    if (!cleared) draftStatus.textContent = '已发布，浏览器中的旧草稿清除失败';
    message('已提交到 GitHub。等 Pages 部署完成即可打开。');
    appendStatusLink(url, `打开${item} ↗`);
  } catch (error) {
    if (error instanceof PublishedDraftChanged) {
      draftId = crypto.randomUUID().slice(0, 12);
      queueSave();
      saveDraft();
      message(error.message);
      appendStatusLink(error.url, '打开已发布版本 ↗');
    } else {
      message(error instanceof TypeError ? '无法连接 GitHub。草稿仍可编辑，请稍后重新发布。' : error.message, true);
    }
  } finally {
    fields.disabled = false;
    for (const editor of editors.values()) editor.enable();
    for (const button of modeButtons) button.disabled = false;
    busy = false;
  }
});

try {
  db = await openDrafts();
  for (const draft of await draftTransaction(db, 'readonly', store => store.getAll())) drafts.set(draft.mode, draft);
} catch {
  db?.close();
  db = undefined;
}
showMode(new URLSearchParams(location.search).get('mode') === 'note' ? 'note' : 'article');
fields.disabled = false;
for (const button of modeButtons) button.disabled = false;
