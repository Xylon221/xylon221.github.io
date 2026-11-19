import { fetchPage, loadCatalog } from './article-catalog.js?v=20261119-shelves';
import { articleRows } from './catalog-view.js?v=20261119-shelves';
import { belongsToChapter, chapters } from './taxonomy.js?v=20261119-shelves';

function showStatus(id, message) {
  const status = document.getElementById(id);
  status.textContent = message;
  status.hidden = false;
}

async function loadArticles() {
  const articles = await loadCatalog();
  const list = document.getElementById('article-list');
  for (const chapter of chapters) {
    const section = document.createElement('section');
    section.className = 'chapter-section';
    section.setAttribute('aria-labelledby', `recent-${chapter.id}`);
    const heading = document.createElement('div');
    heading.className = 'chapter-section-head';
    const title = document.createElement('h2');
    title.id = `recent-${chapter.id}`;
    title.textContent = chapter.title;
    const link = document.createElement('a');
    link.href = chapter.href;
    link.textContent = '查看全部 ↗';
    heading.append(title, link);
    const posts = articles.filter(post => belongsToChapter(post, chapter)).slice(0, 3);
    section.append(heading, ...articleRows(posts));
    list.append(section);
  }
}

async function loadUpdates() {
  const response = await fetchPage('/reading-room/updates.json');
  const updates = await response.json();
  updates.sort((first, second) => second.date.localeCompare(first.date));

  if (!updates.length) showStatus('update-status', '暂时还没有动态。');
  const latest = document.getElementById('profile-latest');
  if (latest && updates.length) {
    latest.textContent = updates[0].title;
    latest.hidden = false;
  }
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

loadArticles().catch(() => showStatus('article-status', '暂时无法加载文章，可以从归档继续浏览。'));
loadUpdates().catch(() => showStatus('update-status', '暂时无法加载动态。'));
