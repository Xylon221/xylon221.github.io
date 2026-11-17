import { loadCatalog } from './article-catalog.js?v=3';
import { articleRows } from './catalog-view.js?v=1';
import { articleTopic, belongsToChapter, chapters } from './taxonomy.js?v=1';

const chapter = chapters.find(item => item.id === document.body.dataset.chapter);
const requested = new URLSearchParams(location.search).get('topic');
const groups = chapter.groups;
const active = groups.flatMap(group => group.topics).find(topic => topic.id === requested);
const index = document.getElementById('chapter-index');
const list = document.getElementById('chapter-posts');
const status = document.getElementById('chapter-status');

function topicLink(label, topic) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = topic ? `${chapter.href}?topic=${encodeURIComponent(topic.id)}` : chapter.href;
  if (topic === active) link.setAttribute('aria-current', 'page');
  return link;
}

const all = document.createElement('div');
all.className = 'topic-links';
all.append(topicLink('全部文章'));
index.append(all);
for (const group of groups) {
  const title = document.createElement('h2');
  title.textContent = group.title;
  const links = document.createElement('div');
  links.className = 'topic-links';
  links.append(...group.topics.map(topic => topicLink(topic.title, topic)));
  index.append(title, links);
}
document.getElementById('chapter-list-title').textContent = active?.title || '全部文章';

try {
  const posts = (await loadCatalog()).filter(post => active ? articleTopic(post) === active : belongsToChapter(post, chapter));
  list.append(...articleRows(posts));
  status.hidden = true;
} catch { status.textContent = '暂时无法读取文章，可以从归档浏览。'; }
