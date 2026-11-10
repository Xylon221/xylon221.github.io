async function fetchPage(path) {
  const response = await fetch(path, { cache: 'no-cache' });
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
  const thumbnail = card.querySelector('.article-art');
  if (post.image) {
    const image = new URL(post.image, new URL(post.url, location.origin));
    if (image.protocol === 'https:' || image.protocol === 'http:') {
      thumbnail.addEventListener('error', () => { thumbnail.hidden = true; }, { once: true });
      thumbnail.src = image.href;
      thumbnail.hidden = false;
    }
  }
  card.querySelector('h4').textContent = post.title;
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
    fetchPage('/search.json?v=20261110-grid').then(response => response.json()),
    loadArchiveDates().catch(() => new Map()),
  ]);
  const articles = index.flatMap(post => {
    if (!post || typeof post.title !== 'string' || typeof post.url !== 'string') return [];
    const url = new URL(post.url, location.origin);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return [];
    const month = url.pathname.match(/^\/(\d{4})\/(\d{2})\//);
    const date = post.date || dates.get(url.pathname) || (month ? `${month[1]}-${month[2]}` : '');
    return [{ ...post, url: url.pathname, date }];
  });
  articles.sort((first, second) => second.date.localeCompare(first.date));

  if (!articles.length) showStatus('article-status', '暂时还没有文章。');
  const list = document.getElementById('article-list');
  const navigation = document.getElementById('topic-nav');
  const template = document.getElementById('article-template');
  const topics = [
    { id: 'privacy', title: '隐私计算', summary: '同态加密、CKKS 与隐私保护数据科学', posts: [] },
    { id: 'technical', title: '技术笔记', summary: '编程、工具和学习记录', posts: [] },
    { id: 'life', title: '生活随笔', summary: '读书、日常和写下来的片段', posts: [] },
  ];
  for (const post of articles) {
    const labels = Array.isArray(post.tags) ? post.tags : [];
    const topic = labels.some(label => /CKKS|同态加密|隐私保护|差分隐私|安全多方计算/i.test(label))
      ? topics[0]
      : labels.some(label => /随想|随笔|生活|读书/.test(label)) ? topics[2] : topics[1];
    topic.posts.push(post);
  }

  for (const [index, topic] of topics.entries()) {
    if (!topic.posts.length) continue;
    const shortcut = document.createElement('a');
    shortcut.href = `#${topic.id}`;
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = `0${index + 1} · ${topic.posts.length} 篇`;
    const name = document.createElement('strong');
    name.textContent = topic.title;
    const summary = document.createElement('span');
    summary.textContent = topic.summary;
    shortcut.append(label, name, summary);
    navigation.append(shortcut);

    const section = document.createElement('section');
    section.className = 'topic-section';
    section.id = topic.id;
    const heading = document.createElement('h3');
    heading.textContent = topic.title;
    const cards = document.createElement('div');
    cards.className = 'topic-cards';
    cards.append(...topic.posts.map(post => renderArticle(post, template)));
    section.append(heading, cards);
    list.append(section);
  }
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
