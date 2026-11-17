import { articleCategory, articleText, loadCatalog } from './article-catalog.js?v=1';
import { legacyTextOps, textHtml } from './article-text.js?v=1';

const template = document.getElementById('note-template');
const list = document.getElementById('notes-list');
const status = document.getElementById('notes-status');
const excerptLimit = 160;

function renderNote(post) {
  const card = template.content.cloneNode(true);
  const date = card.querySelector('.note-date');
  date.href = post.url;
  const time = date.querySelector('time');
  time.dateTime = post.date;
  time.textContent = post.date || '查看随笔';

  const title = card.querySelector('.note-title');
  title.href = post.url;
  title.textContent = post.title;
  title.closest('h2').hidden = Boolean(post.untitled);

  const characters = Array.from(articleText(post));
  const long = characters.length > excerptLimit;
  const body = card.querySelector('.note-text');
  const excerpt = characters.slice(0, excerptLimit).join('').trimEnd();
  const ops = long ? legacyTextOps(`${excerpt}…`) : post.note_rich_text ?? legacyTextOps(characters.join(''));
  if (characters.length) body.innerHTML = textHtml(ops);
  body.hidden = !characters.length;

  const gallery = card.querySelector('.note-images');
  const images = Array.isArray(post.note_images) ? post.note_images : (post.image ? [{ src: post.image }] : []);
  for (const image of long ? images.slice(0, 1) : images) {
    let url;
    try { url = new URL(image.src, new URL(post.url, location.origin)); }
    catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const figure = document.createElement('figure');
    const photo = document.createElement('img');
    photo.src = url.href;
    photo.alt = image.caption || '';
    photo.loading = 'lazy';
    photo.decoding = 'async';
    figure.append(photo);
    if (image.caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = image.caption;
      figure.append(caption);
    }
    gallery.append(figure);
  }
  gallery.hidden = !gallery.childElementCount;

  const tags = card.querySelector('.note-tags');
  for (const tag of Array.isArray(post.tags) ? post.tags : []) {
    const link = document.createElement('a');
    link.href = `/tags/${encodeURIComponent(tag)}/`;
    link.textContent = `#${tag}`;
    tags.append(link);
  }
  const link = card.querySelector('.note-permalink');
  link.href = post.url;
  link.textContent = long ? '阅读全文 ↗' : '打开随笔 ↗';
  link.setAttribute('aria-label', `${link.textContent} ${post.title}`);
  return card;
}

try {
  const notes = (await loadCatalog()).filter(post => articleCategory(post) === 'life');
  if (notes.length) list.replaceChildren(...notes.map(renderNote));
  else {
    status.textContent = '还没有发布随笔。';
    status.hidden = false;
  }
} catch {
  status.textContent = '暂时无法加载随笔，可以从归档继续浏览。';
  status.hidden = false;
}
