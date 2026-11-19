import { escapeHtml, hasInlineFormatting, legacyTextOps, textHtml } from './article-text.js?v=1';
import { articleDirectory, digest, publicImagePath, restoreOriginal, sourcePage, sourceRevision } from './write-source.js?v=2';
import { articleTopic, topicHref } from './taxonomy.js?v=20261119-shelves';

const repository = 'https://api.github.com/repos/Xylon221/xylon221.github.io';
const site = 'https://xylon221.github.io';
const branch = 'main';

const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const tagUrl = tag => `/tags/${encodeURIComponent(tag)}/`;
const parse = html => new DOMParser().parseFromString(html, 'text/html');
const serialize = doc => `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
const pathname = url => new URL(url, site).pathname;

export function articleBody(blocks, imageUrl, original) {
  return blocks.map(block => {
    if (block.kind === 'text') {
      return textHtml(block.ops ?? legacyTextOps(block.text));
    }
    if (block.kind === 'original') {
      if (original) return original(block).html;
      return `<p class="original-preview">${escapeHtml(block.text ?? (block.summary || '原文结构保留'))}</p>`;
    }
    const caption = escapeHtml(block.caption);
    return `<figure><img src="${escapeHtml(imageUrl(block))}" alt="${escapeHtml(block.alt ?? block.caption)}" loading="lazy" decoding="async">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }).join('\n');
}

function articlePage(room, post, body) {
  const doc = parse(room);
  const header = doc.querySelector('.room-header');
  header.querySelectorAll('[aria-current]').forEach(link => link.removeAttribute('aria-current'));
  const style = doc.querySelector('link[href^="/css/reading-room.css"]');
  const title = escapeHtml(post.title);
  const tags = post.tags.map(tag => `<a href="${tagUrl(tag)}">#${escapeHtml(tag)}</a>`).join(' ');
  const topic = articleTopic(post);
  const section = `<a class="published-topic" href="${topicHref(topic)}">${escapeHtml(topic.title)}</a>`;
  const date = `<time datetime="${post.date}">${post.date}</time>`;
  const heading = post.untitled ? `<h1>${date}</h1>` : `<h1>${title}</h1>${date}`;
  const back = post.category === 'life' ? '<a href="/notes/">返回生活随笔</a>' : '<a href="/reading-room/">返回书房</a>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fff">
  <title>${title} | ${escapeHtml(header.querySelector('.brand').textContent.trim())}</title>
  <link rel="canonical" href="${site}${post.url}">
  <link rel="icon" href="/images/favicon-32x32-next.png">
  ${style.outerHTML}
  <link rel="stylesheet" href="/css/published-article.css?v=2">
  <link rel="stylesheet" href="/css/site-shell.css?v=20261119-shelves">
  <script type="module" src="/js/site-shell.js?v=20261119-nav"></script>
</head>
<body>
  ${header.outerHTML}
  <main class="room-shell published-article">
    <article>
      <header class="published-heading">${section}${heading}</header>
      <div class="published-body">${body}</div>
      ${tags ? `<footer class="published-tags">${tags}</footer>` : ''}
    </article>
    <div class="room-footer">${back}<a href="/archives/">浏览归档</a></div>
  </main>
</body>
</html>`;
}

function updateLegacyPage(source, post, body) {
  source.body.innerHTML = body;
  const { doc } = source;
  const article = source.body.closest('article');
  const heading = article.querySelector('h1.post-title, .published-heading h1');
  if (heading) heading.textContent = post.untitled ? post.date : post.title;
  const time = article.querySelector('time[itemprop~="datePublished"], .published-heading time');
  if (time && time.dateTime.slice(0, 10) !== post.date) {
    time.dateTime = post.date;
    time.textContent = post.date;
    time.removeAttribute('title');
  }
  const brand = doc.title.split(' | ').at(-1).trim();
  doc.title = brand ? `${post.title} | ${brand}` : post.title;
  const meta = { 'meta[property="og:title"]': post.title, 'meta[property="og:description"]': post.content.slice(0, 200),
    'meta[name="description"]': post.content.slice(0, 200), 'meta[property="article:modified_time"]': new Date().toISOString() };
  for (const [selector, value] of Object.entries(meta)) doc.querySelector(selector)?.setAttribute('content', value);
  const published = doc.querySelector('meta[property="article:published_time"]');
  if (published && time && time.dateTime === post.date) published.content = `${post.date}T00:00:00+08:00`;
  for (const oldTag of doc.querySelectorAll('meta[property="article:tag"]')) oldTag.remove();
  for (const tag of post.tags) {
    const entry = doc.createElement('meta');
    entry.setAttribute('property', 'article:tag');
    entry.content = tag;
    doc.head.append(entry);
  }
  const footer = article.querySelector('.post-footer, .published-tags');
  let tags = article.querySelector('.post-tags, .published-tags');
  if (footer && !tags && post.tags.length) {
    tags = doc.createElement('div');
    tags.className = 'post-tags';
    footer.prepend(tags);
  }
  if (tags) tags.innerHTML = post.tags.map(tag => `<a href="${tagUrl(tag)}" rel="tag">#${escapeHtml(tag)}</a>`).join(' ');
  return serialize(doc);
}

function archiveEntry(post) {
  const { title, url, date } = post;
  const content = (post.content || '').replace(/\s+/g, ' ').trim();
  const excerpt = !post.web_draft_id && !post.web_edit_id && content.startsWith(title) ? content.slice(title.length).trim() : content;
  const tags = (post.tags || []).map(tag => `<a href="${tagUrl(tag)}">${escapeHtml(tag)}</a>`).join(' ');
  const image = post.image ? `<img class="archive-thumb" src="${escapeHtml(post.image)}" alt="" loading="lazy" decoding="async">` : '';
  return `<article class="archive-entry">${image}<h4><a class="post-title-link" href="${escapeHtml(url)}">${escapeHtml(title)}</a></h4>
    <p class="archive-meta"><time datetime="${date}">${date}</time>${tags}</p>
    <p class="archive-excerpt">${escapeHtml(excerpt.slice(0, 145))}${excerpt.length > 145 ? '…' : ''}</p></article>`;
}

function timeline(doc, posts) {
  const groups = new Map();
  for (const post of posts) {
    const year = post.date.slice(0, 4);
    const month = post.date.slice(0, 7);
    if (!groups.has(year)) groups.set(year, new Map());
    const months = groups.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(post);
  }
  const navigation = [], entries = [];
  for (const [year, months] of groups) {
    navigation.push(`<div><a href="#year-${year}">${year}</a><ul>`);
    entries.push(`<section class="archive-year" id="year-${year}"><h2>${year}</h2><div class="archive-months">`);
    for (const [month, articles] of months) {
      const label = `${month.slice(5)}月`;
      navigation.push(`<li><a href="#month-${month}">${label}</a></li>`);
      entries.push(`<section class="archive-month" id="month-${month}"><h3>${label}</h3>${articles.map(archiveEntry).join('\n')}</section>`);
    }
    navigation.push('</ul></div>');
    entries.push('</div></section>');
  }
  doc.querySelector('.archive-jump').innerHTML = navigation.join('\n');
  doc.querySelector('.archive-timeline').innerHTML = entries.join('\n');
  doc.querySelector('.room-intro > p:last-child').textContent = `共 ${posts.length} 篇文章`;
}

function tagPage(previous, archive, tag, posts, post) {
  const doc = parse(previous || archive);
  const legacy = doc.querySelector('.posts-collapse .post-block .post-content');
  if (legacy) {
    const header = legacy.querySelector('.collection-title');
    const entries = header ? [header.outerHTML] : [];
    let year;
    for (const record of posts) {
      const day = record.date;
      if (year !== day.slice(0, 4)) {
        year = day.slice(0, 4);
        entries.push(`<div class="collection-year"><span class="collection-header">${year}</span></div>`);
      }
      entries.push(`<article><header class="post-header"><div class="post-meta-container"><time datetime="${day}">${day.slice(5)}</time></div><div class="post-title"><a class="post-title-link" href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></div></header></article>`);
    }
    legacy.innerHTML = entries.join('\n');
    const countLabel = legacy.querySelector('.collection-header small');
    if (countLabel) countLabel.textContent = `${posts.length} 篇文章`;
    const series = doc.querySelector('.series-nav-list');
    if (series) series.innerHTML = [...posts].reverse().map(record => `<a class="series-nav-item" href="${escapeHtml(record.url)}"><span class="series-nav-dot"></span><span class="series-nav-post-title">${escapeHtml(record.title)}</span><span class="series-nav-date">${record.date.slice(5)}</span></a>`).join('');
    const count = doc.querySelector('.series-nav-count');
    if (count) count.textContent = `${posts.length} 篇文章`;
  } else {
    doc.title = `标签 · ${tag} | ${doc.querySelector('.brand').textContent.trim()}`;
    doc.querySelector('.room-intro h1').textContent = `标签 · ${tag}`;
    doc.querySelectorAll('[aria-current]').forEach(link => link.removeAttribute('aria-current'));
    doc.querySelector('.room-header a[href="/tags/"]').setAttribute('aria-current', 'page');
    timeline(doc, posts);
  }
  return serialize(doc);
}

function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result.split(',')[1]), { once: true });
    reader.addEventListener('error', () => reject(new Error('无法读取图片，请重新选择。')), { once: true });
    reader.readAsDataURL(file);
  });
}

async function draftFingerprint(draft) {
  const blocks = [];
  for (const block of draft.blocks) {
    if (block.kind === 'text') blocks.push(block.ops && hasInlineFormatting(block.ops) ? block.ops : block.text);
    else if (block.kind === 'original') blocks.push([block.index, block.text]);
    else blocks.push([block.src || block.path, block.caption, block.file ? await digest(await block.file.arrayBuffer()) : null]);
  }
  const data = JSON.stringify([draft.title, draft.date, draft.category, draft.tags, blocks, ...(draft.topic ? [draft.topic] : [])]);
  return digest(new TextEncoder().encode(data));
}

export class PublishedDraftChanged extends Error {
  constructor(url) {
    super('上一版已发布。当前草稿已保留，再次发布会生成一篇新内容。');
    this.url = url;
  }
}

export async function publishArticle(draft, token, progress, request = fetch) {
  async function github(path, { method = 'GET', body, raw = false, optional = false } = {}) {
    const response = await request(repository + path, {
      method, cache: 'no-store', redirect: 'error', credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (optional && response.status === 404) return null;
    if (response.status === 401) throw new Error('GitHub 令牌无效或已过期，请换一个有效令牌。');
    if (response.status === 403 || response.status === 404) throw new Error('GitHub 拒绝访问，请检查令牌是否选择了博客仓库，并为 Contents 开启读写权限。');
    if (method === 'PATCH' && (response.status === 409 || response.status === 422)) {
      throw new Error('博客在发布期间有新提交。请重新填写令牌，再点一次发布。');
    }
    if (!response.ok) throw new Error(`GitHub 请求失败（${response.status}），请稍后重试。`);
    return raw ? response.text() : response.json();
  }

  progress('正在读取当前博客…');
  const ref = await github(`/git/ref/heads/${branch}`);
  const head = ref.object.sha;
  const file = (path, optional = false) => github(`/contents/${encodePath(path)}?ref=${head}`, { raw: true, optional });
  const [base, catalogText, room, archive, tagsPage] = await Promise.all([
    github(`/git/commits/${head}`), file('search.json'), file('reading-room/index.html'),
    file('archives/index.html'), file('tags/index.html'),
  ]);
  const catalog = JSON.parse(catalogText);
  const fingerprint = await draftFingerprint(draft);
  const edit = draft.edit;
  const retry = catalog.find(post => (edit ? post.web_edit_id : post.web_draft_id) === draft.id);
  if (retry) {
    const previousUrl = site + retry.url;
    const hash = edit ? retry.web_edit_hash : retry.web_draft_hash;
    if (hash && hash !== fingerprint) {
      if (edit) throw new Error('这次修改的上一版已上线。当前草稿已保留，请先核对线上版本。');
      throw new PublishedDraftChanged(previousUrl);
    }
    return previousUrl;
  }

  const archiveDoc = parse(archive);
  const dates = new Map([...archiveDoc.querySelectorAll('.archive-entry')].map(entry => [
    pathname(entry.querySelector('.post-title-link').getAttribute('href')), entry.querySelector('time').dateTime,
  ]));
  const previous = edit && catalog.find(post => pathname(post.url) === edit.url);
  let original;
  if (edit) {
    if (!previous) throw new Error('这篇文章已不在发布列表里。');
    original = sourcePage(await file(`${articleDirectory(edit.url)}/index.html`));
    if (await sourceRevision(original, { ...previous, date: previous.date || dates.get(edit.url) }) !== edit.revision) {
      throw new Error('线上文章在载入后有更新。当前草稿已保留，请核对线上版本后重新载入。');
    }
  }
  const knownTags = new Map(catalog.flatMap(post => (post.tags || []).map(tag => [tag.toLowerCase(), tag])));
  const tags = [...new Set(draft.tags.map(tag => knownTags.get(tag.toLowerCase()) || tag))];
  const note = draft.category === 'life';
  const textBlocks = draft.blocks.filter(block => block.kind === 'text');
  const preserved = new Map(draft.blocks.filter(block => block.kind === 'original').map(block => [block, restoreOriginal(original, block)]));
  const content = draft.blocks.map(block => block.kind === 'text' ? block.text : preserved.get(block)?.text).filter(Boolean).join('\n\n');
  const noteText = note && !preserved.size ? textBlocks.flatMap(block => block.ops ?? legacyTextOps(block.text)) : [];
  const previewTitle = Array.from(content.replace(/\s+/g, ' '));
  const title = draft.title || (previewTitle.length ? previewTitle.slice(0, 30).join('') + (previewTitle.length > 30 ? '…' : '') : '照片随笔');
  const slug = Array.from(draft.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 24).join('') || (note ? 'note' : 'post');
  const directory = edit ? articleDirectory(edit.url) : `${draft.date.slice(0, 4)}/${draft.date.slice(5, 7)}/${slug}-${draft.id}`;
  const url = edit ? edit.url : `/${encodePath(directory)}/`;
  const body = articleBody(draft.blocks, image => image.src || image.path, block => preserved.get(block));
  const bodyDoc = parse(body);
  const images = [...bodyDoc.querySelectorAll('img[src], img[data-src]')].map(image => ({
    src: publicImagePath(image.getAttribute('data-src') || image.getAttribute('src'), url, site),
    caption: image.closest('figure')?.querySelector('figcaption')?.textContent || image.alt,
  })).filter(image => image.src);
  const uploads = draft.blocks.filter(block => block.kind === 'image' && block.file);
  const post = {
    ...(previous || {}),
    title, url, date: draft.date, tags, category: draft.category, topic: draft.topic, content,
    ...(edit ? { web_edit_id: draft.id, web_edit_hash: fingerprint } : { web_draft_id: draft.id, web_draft_hash: fingerprint }),
    untitled: note && !draft.title ? true : undefined,
    note_rich_text: hasInlineFormatting(noteText) ? noteText : undefined,
    image: images[0]?.src,
    note_images: note && images.length ? images : undefined,
  };
  const updated = previous ? catalog.map(entry => entry === previous ? post : entry) : [...catalog, post];
  const ordered = updated.map(entry => ({ ...entry, date: entry.date || dates.get(pathname(entry.url)) }));
  if (ordered.some(entry => !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))) throw new Error('文章索引缺少发布日期，请先修复归档。');
  ordered.sort((first, second) => second.date.localeCompare(first.date));
  timeline(archiveDoc, ordered);

  const directoryDoc = parse(tagsPage);
  const tagList = directoryDoc.querySelector('.tag-directory ul');
  const touched = new Set([...(previous?.tags || []), ...tags]);
  const usedTags = new Set(updated.flatMap(entry => entry.tags || []));
  for (const link of tagList.querySelectorAll('a')) {
    const tag = link.textContent.trim();
    if (touched.has(tag) && !usedTags.has(tag)) link.closest('li').remove();
  }
  const existingTags = new Set([...tagList.querySelectorAll('a')].map(a => a.textContent.trim()));
  for (const tag of tags) {
    if (!existingTags.has(tag)) tagList.insertAdjacentHTML('beforeend', `<li><a href="${tagUrl(tag)}">${escapeHtml(tag)}</a></li>`);
  }
  const archiveHtml = serialize(archiveDoc);
  const articleHtml = previous && !original.body.matches('.published-body') ? updateLegacyPage(original, post, body) : articlePage(room, post, body);
  const changed = [
    [directory + '/index.html', articleHtml],
    ['search.json', JSON.stringify(updated) + '\n'],
    ['archives/index.html', archiveHtml],
    ['tags/index.html', serialize(directoryDoc)],
  ];
  const tagChanges = await Promise.all([...touched].map(async tag => {
    const path = `tags/${tag}/index.html`;
    const tagged = ordered.filter(entry => (entry.tags || []).includes(tag));
    return [path, tagPage(await file(path, true), archiveHtml, tag, tagged)];
  }));
  const files = [...changed, ...tagChanges].map(([path, content]) => ({ path, content, mode: '100644', type: 'blob' }));
  if (uploads.length) progress(`正在上传 ${uploads.length} 张图片…`);
  for (const image of uploads) {
    const blob = await github('/git/blobs', { method: 'POST', body: { content: await base64(image.file), encoding: 'base64' } });
    files.push({ path: `${directory}/${image.path}`, sha: blob.sha, mode: '100644', type: 'blob' });
  }
  progress('正在提交正文、归档和标签…');
  const tree = await github('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: files } });
  const commit = await github('/git/commits', { method: 'POST', body: { message: `${edit ? 'Update' : 'Publish'} ${post.title}`, tree: tree.sha, parents: [head] } });
  await github(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return site + url;
}
