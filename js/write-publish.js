const repository = 'https://api.github.com/repos/Xylon221/xylon221.github.io';
const site = 'https://xylon221.github.io';
const branch = 'main';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const tagUrl = tag => `/tags/${encodeURIComponent(tag)}/`;
const parse = html => new DOMParser().parseFromString(html, 'text/html');
const serialize = doc => `<!doctype html>\n${doc.documentElement.outerHTML}\n`;

export function articleBody(blocks, imageUrl) {
  return blocks.map(block => {
    if (block.kind === 'text') {
      return block.text.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`).join('\n');
    }
    const caption = escapeHtml(block.caption);
    return `<figure><img src="${escapeHtml(imageUrl(block))}" alt="${caption}" loading="lazy" decoding="async">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }).join('\n');
}

function articlePage(room, post, body) {
  const doc = parse(room);
  const header = doc.querySelector('.room-header');
  header.querySelectorAll('[aria-current]').forEach(link => link.removeAttribute('aria-current'));
  const style = doc.querySelector('link[href^="/css/reading-room.css"]');
  const title = escapeHtml(post.title);
  const tags = post.tags.map(tag => `<a href="${tagUrl(tag)}">#${escapeHtml(tag)}</a>`).join(' ');
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
  <link rel="stylesheet" href="/css/published-article.css">
</head>
<body>
  ${header.outerHTML}
  <main class="room-shell published-article">
    <article>
      <header class="published-heading"><h1>${title}</h1><time datetime="${post.date}">${post.date}</time></header>
      <div class="published-body">${body}</div>
      <footer class="published-tags">${tags}</footer>
    </article>
    <div class="room-footer"><a href="/reading-room/">返回书房</a><a href="/archives/">浏览归档</a></div>
  </main>
</body>
</html>`;
}

function archiveEntry(post) {
  const { title, url, date } = post;
  const content = (post.content || '').replace(/\s+/g, ' ').trim();
  const excerpt = content.startsWith(title) ? content.slice(title.length).trim() : content;
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
    const title = escapeHtml(post.title), href = escapeHtml(post.url);
    const older = [...legacy.querySelectorAll('article')].find(entry => entry.querySelector('time').dateTime.slice(0, 10) < post.date);
    const entry = `<article><header class="post-header"><div class="post-meta-container"><time datetime="${post.date}">${post.date}</time></div><div class="post-title"><a class="post-title-link" href="${href}">${title}</a></div></header></article>`;
    if (older) older.insertAdjacentHTML('beforebegin', entry);
    else legacy.insertAdjacentHTML('beforeend', entry);
    const series = doc.querySelector('.series-nav-list');
    if (series) series.insertAdjacentHTML('beforeend', `<a class="series-nav-item" href="${href}"><span class="series-nav-dot"></span><span class="series-nav-post-title">${title}</span><span class="series-nav-date">${post.date.slice(5)}</span></a>`);
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
  const retry = catalog.find(post => post.web_draft_id === draft.id);
  if (retry) return site + retry.url;

  const knownTags = new Map(catalog.flatMap(post => (post.tags || []).map(tag => [tag.toLowerCase(), tag])));
  const tags = [...new Set(draft.tags.map(tag => knownTags.get(tag.toLowerCase()) || tag))];
  const slug = Array.from(draft.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 24).join('') || 'post';
  const directory = `${draft.date.slice(0, 4)}/${draft.date.slice(5, 7)}/${slug}-${draft.id}`;
  const url = `/${encodePath(directory)}/`;
  const images = draft.blocks.filter(block => block.kind === 'image');
  const post = {
    title: draft.title, url, date: draft.date, tags, category: draft.category,
    content: draft.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n\n'),
    web_draft_id: draft.id,
    ...(images.length ? { image: `${url}${images[0].path}` } : {}),
  };
  const archiveDoc = parse(archive);
  const dates = new Map([...archiveDoc.querySelectorAll('.archive-entry')].map(entry => [
    entry.querySelector('.post-title-link').getAttribute('href'), entry.querySelector('time').dateTime,
  ]));
  const ordered = [...catalog, post].map(entry => ({ ...entry, date: entry.date || dates.get(entry.url) }));
  if (ordered.some(entry => !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))) throw new Error('文章索引缺少发布日期，请先修复归档。');
  ordered.sort((first, second) => second.date.localeCompare(first.date));
  timeline(archiveDoc, ordered);

  const directoryDoc = parse(tagsPage);
  const tagList = directoryDoc.querySelector('.tag-directory ul');
  const existingTags = new Set([...tagList.querySelectorAll('a')].map(a => a.textContent.trim()));
  for (const tag of tags) {
    if (!existingTags.has(tag)) tagList.insertAdjacentHTML('beforeend', `<li><a href="${tagUrl(tag)}">${escapeHtml(tag)}</a></li>`);
  }
  const archiveHtml = serialize(archiveDoc);
  const changed = [
    [directory + '/index.html', articlePage(room, post, articleBody(draft.blocks, image => image.path))],
    ['search.json', JSON.stringify([...catalog, post]) + '\n'],
    ['archives/index.html', archiveHtml],
    ['tags/index.html', serialize(directoryDoc)],
  ];
  const tagChanges = await Promise.all(tags.map(async tag => {
    const path = `tags/${tag}/index.html`;
    const tagged = ordered.filter(entry => (entry.tags || []).includes(tag));
    return [path, tagPage(await file(path, true), archiveHtml, tag, tagged, post)];
  }));
  const files = [...changed, ...tagChanges].map(([path, content]) => ({ path, content, mode: '100644', type: 'blob' }));
  if (images.length) progress(`正在上传 ${images.length} 张图片…`);
  for (const image of images) {
    const blob = await github('/git/blobs', { method: 'POST', body: { content: await base64(image.file), encoding: 'base64' } });
    files.push({ path: `${directory}/${image.path}`, sha: blob.sha, mode: '100644', type: 'blob' });
  }
  progress('正在提交文章、归档和标签…');
  const tree = await github('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: files } });
  const commit = await github('/git/commits', { method: 'POST', body: { message: `Publish ${draft.title}`, tree: tree.sha, parents: [head] } });
  await github(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return site + url;
}
