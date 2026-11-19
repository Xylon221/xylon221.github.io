import { loadCatalog } from './article-catalog.js?v=20261119-shelves';
import { belongsToChapter, chapters, lifeSections, matchesTopic, photoSections, selectedTopic } from './taxonomy.js?v=20261119-shelves';

const byId = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let chapter = chapters.find(item => item.id === params.get('chapter')) || chapters[0];
let topic = selectedTopic(chapter, params.get('topic'));
let posts = [];
let loaded = false;
let openedDraft;
let refreshTimer;
let remainingRefreshes = 16;
const gallery = byId('gallery-posts');
const status = byId('gallery-status');
const filters = byId('gallery-filters');
const drawer = byId('gallery-editor');
const frame = byId('gallery-editor-frame');
const open = byId('new-gallery-draft');
const resume = byId('resume-gallery-draft');
const expand = byId('expand-gallery-editor');
const close = byId('close-gallery-editor');
const editorStatus = byId('gallery-editor-status');
const draftTopics = { learning: 'technical-notes', reflection: 'reflections', life: 'life-records' };
const tabs = [...document.querySelectorAll('[data-gallery-chapter]')];
const fallback = '/images/journal-lake-small.webp';
const draftKey = (id = draftTopic()) => 'reading-room:draft:' + id;

function draftTopic() {
  return topic && !topic.legacy ? topic.id : draftTopics[chapter.id];
}

function rememberedDraft() {
  try {
    const id = localStorage.getItem(draftKey());
    return /^[0-9a-f]{12}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function select(nextChapter, nextTopic) {
  chapter = nextChapter;
  topic = nextTopic;
  const url = new URL(location.href);
  url.searchParams.set('chapter', chapter.id);
  if (topic) url.searchParams.set('topic', topic.id);
  else url.searchParams.delete('topic');
  history.replaceState(null, '', url);
  render();
}

function filterLink(label, item) {
  const link = document.createElement('a');
  const url = new URL(location.href);
  url.searchParams.set('chapter', 'life');
  if (item) url.searchParams.set('topic', item.id);
  else url.searchParams.delete('topic');
  link.href = url.pathname + url.search;
  link.textContent = label;
  if (item?.id === topic?.id) link.setAttribute('aria-current', 'true');
  if (item?.id === 'photography' && topic?.parent === 'photography') link.dataset.parentSection = '';
  link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(chapter, item);
    filters.querySelector('[aria-current="true"]')?.focus();
  });
  return link;
}

function thumbnail(post) {
  const image = post.cover || post.image || post.note_images?.[0]?.src;
  if (typeof image !== 'string' || !image) return fallback;
  try {
    const url = new URL(image, new URL(post.url, location.origin));
    return ['http:', 'https:'].includes(url.protocol) && url.origin === location.origin ? url.href : fallback;
  } catch { return fallback; }
}

function card(post) {
  const link = document.createElement('a');
  link.className = 'study-card';
  link.href = post.url;
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = thumbnail(post);
  image.addEventListener('error', () => { image.src = fallback; }, { once: true });
  const title = document.createElement('h3');
  title.textContent = post.title;
  link.append(image, title);
  return link;
}

function render() {
  for (const tab of tabs) {
    if (tab.dataset.galleryChapter === chapter.id) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  }
  filters.hidden = chapter.id !== 'life';
  if (!filters.hidden) {
    const photos = topic?.id === 'photography' || topic?.parent === 'photography';
    const primary = document.createElement('div');
    primary.append(filterLink('全部', null), ...lifeSections.map(item => filterLink(item.title, item)));
    filters.replaceChildren(primary);
    if (photos) {
      const secondary = document.createElement('div');
      secondary.className = 'study-subfilters';
      secondary.append(...photoSections.map(item => filterLink(item.title, item)));
      filters.append(secondary);
    }
  }
  byId('gallery-heading').textContent = topic?.title || chapter.title;
  resume.hidden = !rememberedDraft();
  if (!loaded) return;
  const selected = posts.filter(post => topic ? matchesTopic(post, topic) : belongsToChapter(post, chapter));
  gallery.replaceChildren(...selected.map(card));
  status.hidden = selected.length > 0;
  status.textContent = '这一栏还没有文章。';
}

async function refreshGallery() {
  clearTimeout(refreshTimer);
  try {
    posts = await loadCatalog();
    loaded = true;
    render();
  } catch {
    status.hidden = false;
    status.textContent = '暂时无法读取文章，可从归档浏览。';
  }
  try {
    const published = sessionStorage.getItem('reading-room:last-published');
    if (published && posts.some(post => post.url === published)) sessionStorage.removeItem('reading-room:last-published');
    else if (published && remainingRefreshes > 0) {
      remainingRefreshes--;
      refreshTimer = setTimeout(refreshGallery, 6000);
    }
  } catch { /* The current catalog remains available. */ }
}

function editorUrl(draft, embed) {
  const url = new URL('/write/', location.origin);
  url.searchParams.set('draft', draft.id);
  url.searchParams.set('topic', draft.topic);
  url.searchParams.set('back', location.pathname + location.search);
  if (embed) url.searchParams.set('embed', '1');
  return url;
}

function showEditor(id = crypto.randomUUID().replaceAll('-', '').slice(0, 12)) {
  const route = draftTopic();
  const same = openedDraft?.id === id;
  openedDraft = { id, topic: route };
  try { localStorage.setItem(draftKey(route), id); } catch { /* Editing still works in the current view. */ }
  byId('gallery-editor-title').textContent = '写作 · ' + (topic?.title || chapter.title);
  editorStatus.hidden = true;
  if (!same) frame.src = editorUrl(openedDraft, true);
  drawer.showModal();
  if (same) frame.contentWindow?.studyWriter?.focusTitle();
}

async function leaveEditor(fullPage) {
  const writer = frame.contentWindow?.studyWriter;
  if (!writer) {
    if (!fullPage) drawer.close();
    else location.assign(editorUrl(openedDraft, false));
    return;
  }
  expand.disabled = close.disabled = true;
  try {
    await writer.flush();
    if (fullPage) location.assign(editorUrl(openedDraft, false));
    else drawer.close();
  } catch (error) {
    editorStatus.textContent = error.message || '草稿尚未保存，请保留编辑区。';
    editorStatus.hidden = false;
  } finally {
    expand.disabled = close.disabled = false;
  }
}

for (const tab of tabs) tab.addEventListener('click', event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  select(chapters.find(item => item.id === tab.dataset.galleryChapter), null);
});
open.addEventListener('click', () => showEditor());
resume.addEventListener('click', () => {
  const id = rememberedDraft();
  if (id) showEditor(id);
});
expand.addEventListener('click', () => void leaveEditor(true));
close.addEventListener('click', () => void leaveEditor(false));
drawer.addEventListener('cancel', event => {
  event.preventDefault();
  void leaveEditor(false);
});
drawer.addEventListener('close', () => { render(); open.focus(); });
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'study-writer-ready') frame.contentWindow.studyWriter?.focusTitle();
  if (event.data?.type === 'study-writer-published') {
    openedDraft = null;
    remainingRefreshes = 16;
    void refreshGallery();
  }
  if (event.data?.type === 'study-writer-close') void leaveEditor(false);
});
window.addEventListener('pageshow', event => { if (event.persisted) void refreshGallery(); });
render();
void refreshGallery();
