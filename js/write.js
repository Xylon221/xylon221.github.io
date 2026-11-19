import { openDrafts, draftTransaction } from './write-drafts.js?v=1';
import { articleBody, publishArticle, PublishedDraftChanged } from './write-publish.js?v=5';
import { plainText } from './article-text.js?v=1';
import { createEditor } from './write-editor.js?v=1';
import { fetchPage, loadCatalog } from './article-catalog.js?v=3';
import { articleDirectory, sourceBlocks, sourcePage, sourceRevision } from './write-source.js?v=2';
import { articleTopic, groups, topics } from './taxonomy.js?v=1';

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
const picker = document.getElementById('edit-picker');
const pickerSelect = document.getElementById('edit-article');
const pickerLoad = document.getElementById('edit-load');
const pickerRefresh = document.getElementById('edit-refresh');
const pickerView = document.getElementById('edit-view');
const drafts = new Map();
const images = new Map();
const editors = new Map();
const originals = new Map();
const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
let db;
let mode;
let edit;
let articles = new Map();
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
    if (image?.file) URL.revokeObjectURL(image.preview);
    images.delete(block);
    editors.delete(block);
    originals.delete(block);
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

function addImage({ file, src, alt, caption = '' }) {
  const block = addBlock('image');
  const previewUrl = file ? URL.createObjectURL(file) : src;
  images.set(block, { file, src, alt, preview: previewUrl });
  block.querySelector('img').src = previewUrl;
  block.querySelector('.image-name').textContent = file ? file.name : '已发布的图片';
  block.querySelector('input').value = caption;
}

function addOriginal(original) {
  const block = addBlock('original');
  const editable = typeof original.text === 'string';
  originals.set(block, original);
  const input = block.querySelector('textarea');
  input.closest('label').hidden = !editable;
  input.value = original.text ?? '';
  const summary = block.querySelector('.original-preview');
  summary.hidden = editable;
  summary.textContent = original.summary ? `保留原有排版 · ${original.summary}` : '保留原有图片或排版';
}

function resetBlocks() {
  for (const image of images.values()) if (image.file) URL.revokeObjectURL(image.preview);
  images.clear();
  editors.clear();
  originals.clear();
  blocks.replaceChildren();
}

const editKey = url => `edit:${url}`;
const currentKey = () => edit ? editKey(edit.url) : mode;

function snapshotBlocks(includePreview = false) {
  return [...blocks.children].map(block => {
    if (editors.has(block)) return { kind: 'text', ops: editors.get(block).getContents().ops };
    if (originals.has(block)) {
      const original = originals.get(block);
      return { ...original, ...(typeof original.text === 'string' ? { text: block.querySelector('textarea').value } : {}) };
    }
    const { file, src, alt, preview } = images.get(block);
    return { kind: 'image', file, src, alt, caption: block.querySelector('input').value, ...(includePreview ? { preview } : {}) };
  });
}

function snapshot() {
  const topic = topics.get(category.value);
  return {
    id: draftId, mode: currentKey(), edit, title: title.value, date: date.value, category: topic?.category, topic: topic?.id, tags: tags.value,
    blocks: snapshotBlocks(),
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
  drafts.set(draft.mode, draft);
  if (!db) return;
  draftTransaction(db, 'readwrite', store => store.put(draft)).then(() => {
    if (currentKey() === draft.mode && revision === saveRevision) draftStatus.textContent = '草稿已保存到当前浏览器';
  }).catch(() => {
    if (currentKey() === draft.mode && revision === saveRevision) draftStatus.textContent = '草稿保存失败，请保留此页面';
  });
}

function setBusy(value) {
  busy = value;
  fields.disabled = value;
  for (const editor of editors.values()) editor.enable(!value);
  for (const control of [...modeButtons, pickerSelect, pickerLoad, pickerRefresh]) control.disabled = value;
  pickerLoad.disabled = value || !pickerSelect.value;
}

function showCategories(draft) {
  const available = groups.filter(group => mode === 'edit' || (group.id === 'life') === (mode === 'note'));
  category.replaceChildren(...available.map(group => {
    const options = document.createElement('optgroup');
    options.label = group.title;
    options.append(...group.topics.map(topic => new Option(topic.title, topic.id)));
    return options;
  }));
  const fallback = mode === 'note' ? 'daily' : 'development';
  const inferred = draft ? articleTopic(mode === 'note' ? { ...draft, category: 'life' } : draft).id : fallback;
  const possible = [...category.options].some(option => option.value === inferred);
  category.value = possible ? inferred : fallback;
}

function showMode(nextMode, draft = drafts.get(nextMode)) {
  mode = nextMode;
  edit = draft?.edit;
  saveRevision++;
  const note = mode === 'note';
  const editing = mode === 'edit';
  picker.hidden = !editing;
  pickerView.hidden = pickerRefresh.hidden = !edit;
  if (edit) pickerView.href = edit.url;
  form.hidden = editing && !edit;
  form.dataset.mode = mode;
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  noteOptions.hidden = !note;
  if (note) noteOptions.append(properties);
  else fields.insertBefore(properties, document.getElementById('write-content'));
  showCategories(draft);
  title.required = !note && !editing;
  date.required = !note;
  document.getElementById('title-label').textContent = note || editing ? '标题（随笔可选填）' : '标题';
  document.getElementById('publish-summary').textContent = editing ? '准备保存' : '准备发布';
  document.getElementById('publish-button').textContent = editing ? '保存修改' : note ? '发布随笔' : '发布文章';
  document.getElementById('publish-target').textContent = editing ? '保存后更新原文章及相关列表。' : note ? '随笔发布后会出现在「生活随笔」和归档。' : '文章发布后会出现在书房和归档。';
  draftId = draft?.id ?? crypto.randomUUID().slice(0, 12);
  title.value = draft?.title ?? '';
  date.value = draft?.date ?? today();
  tags.value = draft?.tags ?? '';
  tokenInput.value = '';
  noteOptions.open = note && Boolean(title.value || tags.value || date.value !== today());
  publishOptions.open = false;
  resetBlocks();
  for (const block of draft?.blocks ?? []) {
    if (block.kind === 'text') addText(false, block);
    else if (block.kind === 'original') addOriginal(block);
    else addImage(block);
  }
  if (!form.hidden && !blocks.firstElementChild) addText();
  preview.hidden = true;
  imageError.textContent = '';
  draftStatus.textContent = db
    ? (draft && drafts.has(currentKey()) ? '已恢复草稿' : '草稿保存在当前浏览器')
    : '浏览器暂时无法保存草稿，请保留此页面';
}

function updateAddress() {
  const url = new URL(location.href);
  url.searchParams.delete('edit');
  if (mode === 'article') url.searchParams.delete('mode');
  else url.searchParams.set('mode', mode);
  if (edit) url.searchParams.set('edit', edit.url);
  history.replaceState(history.state, '', url);
}

async function loadArticles(selected = '') {
  articles = new Map((await loadCatalog()).map(post => [post.url, post]));
  pickerSelect.length = 1;
  for (const post of articles.values()) pickerSelect.add(new Option(`${post.date} · ${post.title}`, post.url));
  pickerSelect.value = articles.has(selected) ? selected : '';
}

async function forgetDraft(key) {
  if (db) await draftTransaction(db, 'readwrite', store => store.delete(key));
  drafts.delete(key);
}

async function loadArticle(url, fresh = false) {
  articleDirectory(url);
  if (fresh) await loadArticles(url);
  const post = articles.get(url);
  if (!post) throw new Error('找不到这篇已发布文章。');
  const key = editKey(url);
  let draft = fresh ? undefined : drafts.get(key);
  if (!draft) {
    const source = sourcePage(await (await fetchPage(url)).text());
    draft = {
      id: crypto.randomUUID().slice(0, 12), mode: key,
      edit: { url, revision: await sourceRevision(source, post) },
      title: post.untitled ? '' : post.title, date: post.date, tags: (post.tags || []).join('，'),
      category: post.category, topic: articleTopic(post).id, blocks: sourceBlocks(source, url),
    };
    if (fresh) await forgetDraft(key);
  }
  showMode('edit', draft);
  updateAddress();
  message(drafts.has(key) ? '' : '已载入原文。');
}

async function openEditor(url = '', { refresh = false, catalog = false } = {}) {
  if (busy) return;
  saveDraft();
  if (catalog) { showMode('edit'); updateAddress(); }
  setBusy(true);
  message(url ? '正在载入文章…' : '正在读取已发布的文章…');
  try {
    if (catalog) await loadArticles(url);
    if (url) await loadArticle(url, refresh);
    else message(articles.size ? '' : '还没有可编辑的文章。');
  } catch (error) {
    message(error instanceof TypeError ? '暂时无法读取线上文章，请稍后重试。' : error.message, true);
  } finally {
    setBusy(false);
  }
}

pickerSelect.addEventListener('change', () => { pickerLoad.disabled = !pickerSelect.value; });
pickerLoad.addEventListener('click', () => openEditor(pickerSelect.value));
pickerRefresh.addEventListener('click', () => {
  if (!edit) return;
  if ((saveTimer || drafts.has(currentKey())) && !window.confirm('重新载入会放弃这篇文章在当前浏览器里的修改草稿。继续吗？')) return;
  openEditor(edit.url, { refresh: true });
});

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    if (busy || (mode === button.dataset.mode && (mode !== 'edit' || articles.size))) return;
    if (button.dataset.mode === 'edit') { openEditor('', { catalog: true }); return; }
    saveDraft();
    showMode(button.dataset.mode);
    updateAddress();
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
    addImage({ file });
    added = true;
  }
  preview.hidden = true;
  files.value = '';
  if (added) queueSave();
});

function readDraft() {
  const heading = title.value.trim();
  const topic = topics.get(category.value);
  if (!topic) throw new Error('请选择文章分类。');
  const note = topic.category === 'life';
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
  for (const block of snapshotBlocks(true)) {
    if (block.kind === 'text') {
      const text = plainText(block.ops);
      if (text) content.push({ ...block, text });
    } else if (block.kind === 'original') {
      content.push(block);
    } else {
      const name = edit ? `edit-${draftId}` : 'image';
      const path = block.file ? `assets/${name}-${++number}.${formats[block.file.type]}` : undefined;
      content.push({ ...block, caption: block.caption.trim(), path });
    }
  }
  if (!content.length) throw new Error('请写一段文字或添加一张图片。');
  return { id: draftId, edit, title: heading, date: day, category: topic.category, topic: topic.id, tags: labels, blocks: content };
}

document.getElementById('show-preview').addEventListener('click', () => {
  try {
    const draft = readDraft();
    const heading = preview.querySelector('h2');
    heading.textContent = draft.title;
    heading.hidden = !draft.title;
    preview.querySelector('.preview-meta').textContent = [draft.date, topics.get(draft.topic).title, ...draft.tags.map(tag => `#${tag}`)].join(' · ');
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
  setBusy(true);
  saveDraft();
  try {
    const url = await publishArticle(draft, token, message);
    let cleared = true;
    const key = currentKey();
    try { await forgetDraft(key); }
    catch { cleared = false; drafts.delete(key); }
    const editing = Boolean(edit);
    const item = mode === 'note' ? '随笔' : '文章';
    showMode(mode);
    if (editing) updateAddress();
    if (!cleared) draftStatus.textContent = '已发布，浏览器中的旧草稿清除失败';
    message(editing ? '修改已提交。GitHub Pages 部署完成后，同一个链接会显示新版。' : '已提交到 GitHub。等 Pages 部署完成即可打开。');
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
    setBusy(false);
  }
});

try {
  db = await openDrafts();
  for (const draft of await draftTransaction(db, 'readonly', store => store.getAll())) drafts.set(draft.mode, draft);
} catch {
  db?.close();
  db = undefined;
}
const query = new URLSearchParams(location.search);
const requestedEdit = query.get('edit');
if (requestedEdit || query.get('mode') === 'edit') await openEditor(requestedEdit || '', { catalog: true });
else { showMode(query.get('mode') === 'note' ? 'note' : 'article'); setBusy(false); }
