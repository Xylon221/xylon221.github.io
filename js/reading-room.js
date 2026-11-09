async function fetchPage(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response;
}

function showStatus(id, message) {
  const status = document.getElementById(id);
  status.textContent = message;
  status.hidden = false;
}

async function loadArchiveDates() {
  const dates = new Map();
  const visited = new Set();
  let page = '/archives/';

  while (page && !visited.has(page)) {
    visited.add(page);
    const response = await fetchPage(page);
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');

    for (const link of html.querySelectorAll('a.post-title-link[href]')) {
      const date = link.closest('article')?.querySelector('time[datetime]')?.dateTime.slice(0, 10);
      if (date) dates.set(new URL(link.getAttribute('href'), location.origin).pathname, date);
    }

    const next = html.querySelector('.pagination a[rel="next"]')?.getAttribute('href');
    page = next?.startsWith('/archives/page/') ? next : null;
  }

  return dates;
}

function renderArticle(post, template) {
  const card = template.content.cloneNode(true);
  card.querySelector('a').href = post.url;
  card.querySelector('h3').textContent = post.title;
  card.querySelector('.article-meta').textContent = post.date;

  const summary = card.querySelector('.article-summary');
  const content = typeof post.content === 'string' ? post.content.replace(/\s+/g, ' ').trim() : '';
  const excerpt = content.startsWith(post.title) ? content.slice(post.title.length).trim() : content;
  summary.textContent = excerpt.length > 100 ? `${excerpt.slice(0, 100)}…` : excerpt;
  summary.hidden = !excerpt;

  const tags = card.querySelector('.article-tags');
  if (Array.isArray(post.tags)) {
    for (const tag of post.tags) {
      const item = document.createElement('li');
      item.textContent = tag;
      tags.append(item);
    }
  }

  return card;
}

async function loadArticles() {
  const [index, dates] = await Promise.all([
    fetchPage('/search.json').then(response => response.json()),
    loadArchiveDates().catch(() => new Map()),
  ]);
  const articles = index.flatMap(post => {
    if (!post || typeof post.title !== 'string' || typeof post.url !== 'string') return [];
    const url = new URL(post.url, location.origin);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return [];
    const month = url.pathname.match(/^\/(\d{4})\/(\d{2})\//);
    const date = dates.get(url.pathname) || (month ? `${month[1]}-${month[2]}` : '');
    return [{ ...post, url: url.pathname, date }];
  });
  articles.sort((first, second) => second.date.localeCompare(first.date));

  if (!articles.length) showStatus('article-status', '暂时还没有文章。');
  const list = document.getElementById('article-list');
  const template = document.getElementById('article-template');
  list.append(...articles.map(post => renderArticle(post, template)));
}

async function loadUpdates() {
  const response = await fetchPage('/reading-room/updates.json');
  const updates = await response.json();
  updates.sort((first, second) => second.date.localeCompare(first.date));

  if (!updates.length) showStatus('update-status', '暂时还没有动态。');
  const list = document.getElementById('update-list');
  const template = document.getElementById('update-template');

  for (const update of updates) {
    const card = template.content.cloneNode(true);
    const date = card.querySelector('time');
    date.dateTime = update.date;
    date.textContent = update.date;
    card.querySelector('h3').textContent = update.title;
    card.querySelector('p').textContent = update.body;
    list.append(card);
  }
}

loadArticles().catch(() => showStatus('article-status', '暂时无法加载文章，可以从上方的归档继续浏览。'));
loadUpdates().catch(() => showStatus('update-status', '暂时无法加载动态。'));
