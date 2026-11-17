import { articleCategory, articleText, fetchPage, loadCatalog } from './article-catalog.js?v=1';

function showStatus(id, message) {
  const status = document.getElementById(id);
  status.textContent = message;
  status.hidden = false;
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
  const excerpt = articleText(post).replace(/\s+/g, ' ');
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
  const articles = await loadCatalog();

  if (!articles.length) showStatus('article-status', '暂时还没有文章。');
  const list = document.getElementById('article-list');
  const navigation = document.getElementById('topic-nav');
  const template = document.getElementById('article-template');
  const privacy = [];
  const technical = [];
  const life = [];
  for (const post of articles) {
    const category = articleCategory(post);
    if (category === 'privacy') {
      privacy.push(post);
    } else if (category === 'life') {
      life.push(post);
    } else {
      technical.push(post);
    }
  }

  const topics = [
    { id: 'technical', title: '技术笔记', summary: '隐私计算、编程和学习记录', groups: [
      { id: 'privacy', title: '隐私计算', posts: privacy },
      { title: privacy.length ? '其他技术笔记' : '', posts: technical },
    ] },
    { id: 'life', href: '/notes/', title: '生活随笔', summary: '读书、日常和写下来的片段', groups: [{ posts: life }] },
  ];

  for (const [index, topic] of topics.entries()) {
    const count = topic.groups.reduce((total, group) => total + group.posts.length, 0);
    if (!count) continue;
    const shortcut = document.createElement('a');
    shortcut.href = topic.href || `#${topic.id}`;
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = `0${index + 1} · ${count} 篇`;
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
    section.append(heading);
    for (const group of topic.groups) {
      if (!group.posts.length) continue;
      const block = document.createElement('div');
      block.className = 'topic-group';
      if (group.id) block.id = group.id;
      if (group.title) {
        const subtitle = document.createElement('p');
        subtitle.className = 'topic-group-title';
        subtitle.textContent = group.title;
        block.append(subtitle);
      }
      const cards = document.createElement('div');
      cards.className = 'topic-cards';
      cards.append(...group.posts.map(post => renderArticle(post, template)));
      block.append(cards);
      section.append(block);
    }
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
