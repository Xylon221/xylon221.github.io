import { escapeHtml, highlightColors, softBreak, textColors } from './article-text.js?v=1';

export function articleDirectory(path) {
  const parts = path.split('/').slice(1, -1).map(part => decodeURIComponent(part));
  if (!/^\/\d{4}\/\d{2}\/[^/]+\/$/.test(path) || parts.some(part => !part || /[/\\\x00-\x1f]/.test(part) || part === '.' || part === '..')) {
    throw new Error('这个链接不属于可编辑的博客文章。');
  }
  return parts.join('/');
}

export function sourcePage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.querySelector('.published-body, .post-body[itemprop="articleBody"]');
  if (!body) throw new Error('找不到已发布的正文。');
  const nodes = [...body.childNodes].filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
  return { doc, body, nodes };
}

export async function digest(data) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sourceRevision(source, post) {
  const data = JSON.stringify([source.body.innerHTML, post.title, post.date, post.category || null, post.tags || [], Boolean(post.untitled), ...(post.topic ? [post.topic] : [])]);
  return digest(new TextEncoder().encode(data));
}

function readInline(element, ops, formats = {}) {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/[\t\n\r]+/g, ' ');
      if (text) ops.push({ insert: text, ...(Object.keys(formats).length ? { attributes: formats } : {}) });
      continue;
    }
    const attrs = { ...formats };
    if (node.nodeName === 'BR' && !node.attributes.length) {
      ops.push({ insert: '\n', attributes: { [softBreak]: 'yes' } });
      continue;
    }
    const styles = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline' };
    if (styles[node.nodeName] && !node.attributes.length) attrs[styles[node.nodeName]] = true;
    else if (node.nodeName === 'SPAN' && node.attributes.length === 1) {
      const color = textColors.find(item => node.className === `ql-color-${item}`);
      if (!color) return false;
      attrs.color = color;
    } else if (node.nodeName === 'MARK' && node.attributes.length === 1) {
      const color = highlightColors.find(item => node.className === `ql-bg-${item}`);
      if (!color) return false;
      attrs.background = color;
    } else return false;
    if (!readInline(node, ops, attrs)) return false;
  }
  return true;
}

function figureImage(node, url) {
  if (node.nodeName !== 'FIGURE' || node.attributes.length || !node.firstElementChild?.matches('img[src]')) return null;
  const image = node.firstElementChild;
  const caption = image.nextElementSibling;
  if ([...image.attributes].some(attr => !['src', 'alt', 'loading', 'decoding'].includes(attr.name)) ||
      (caption && (!caption.matches('figcaption') || caption.attributes.length || caption.children.length || caption.nextElementSibling))) return null;
  const src = new URL(image.getAttribute('src'), new URL(url, location.origin));
  if (src.origin !== location.origin) return null;
  return { kind: 'image', src: src.pathname, caption: caption?.textContent || '', alt: image.getAttribute('alt') || '' };
}

function singleTextNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node;
  if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script, style') || node.querySelector('script, style')) return null;
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let match;
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    if (match) return null;
    match = walker.currentNode;
  }
  return match;
}

export function sourceBlocks(source, url) {
  const blocks = [];
  for (const [index, node] of source.nodes.entries()) {
    const ops = [];
    if (node.nodeName === 'P' && !node.attributes.length && readInline(node, ops)) {
      const previous = blocks.at(-1);
      if (previous?.kind !== 'text') blocks.push({ kind: 'text', ops: [] });
      if (!node.matches('p:has(> br:only-child)') || node.textContent) blocks.at(-1).ops.push(...ops);
      blocks.at(-1).ops.push({ insert: '\n' });
      continue;
    }
    const image = figureImage(node, url);
    if (image) {
      blocks.push(image);
      continue;
    }
    const text = singleTextNode(node);
    const summary = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 100);
    blocks.push({ kind: 'original', index, summary, ...(text ? { text: text.textContent } : {}) });
  }
  return blocks;
}

export function restoreOriginal(source, block) {
  const original = source.nodes[block.index];
  if (!original) throw new Error('原文段落已变化，请重新载入文章。');
  const node = original.cloneNode(true);
  if (typeof block.text === 'string') {
    const text = singleTextNode(node);
    if (!text) throw new Error('找不到原段落的文字。');
    text.textContent = block.text;
  }
  const html = node.outerHTML ?? (node.nodeType === Node.COMMENT_NODE ? `<!--${node.data}-->` : escapeHtml(node.textContent));
  return { html, text: node.textContent.trim() };
}

export function publicImagePath(src, articleUrl, origin) {
  if (!src) return '';
  try {
    const url = new URL(src, new URL(articleUrl, origin));
    return /^https?:$/.test(url.protocol) ? (url.origin === origin ? url.pathname + url.search : url.href) : '';
  } catch { return ''; }
}
