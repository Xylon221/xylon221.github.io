import { loadCatalog } from './article-catalog.js?v=20261119-shelves';
import { articleRows } from './catalog-view.js?v=20261119-shelves';
import { belongsToChapter, chapters, lifeSections, matchesTopic, photoSections, selectedTopic, topicHref } from './taxonomy.js?v=20261119-shelves';

const chapter = chapters.find(item => item.id === document.body.dataset.chapter);
const active = selectedTopic(chapter, new URLSearchParams(location.search).get('topic'));
const index = document.getElementById('chapter-index');
const list = document.getElementById('chapter-posts');
const status = document.getElementById('chapter-status');

function filterLink(label, href, current) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  if (current) link.setAttribute('aria-current', 'page');
  return link;
}

function filterRow(...links) {
  const row = document.createElement('div');
  row.className = 'topic-links';
  row.append(...links);
  return row;
}

if (chapter.id === 'life') {
  const inPhotoSection = active?.id === 'photography' || active?.parent === 'photography';
  index.append(filterRow(
    filterLink('全部记录', chapter.href, !active),
    ...lifeSections.map(topic => {
      const link = filterLink(topic.title, topicHref(topic), active?.id === topic.id);
      if (topic.id === 'photography' && inPhotoSection && active.id !== topic.id) link.dataset.parentSection = '';
      return link;
    }),
  ));
  if (inPhotoSection) {
    const photos = filterRow(...photoSections.map(topic => filterLink(topic.title, topicHref(topic), active?.id === topic.id)));
    photos.classList.add('photo-topics');
    index.append(photos);
  }
  index.hidden = false;
} else if (active) {
  index.append(filterRow(filterLink('查看全部文章', chapter.href, false)));
  index.hidden = false;
}
document.getElementById('chapter-list-title').textContent = active?.title || (chapter.id === 'life' ? '全部记录' : '全部文章');

try {
  const posts = (await loadCatalog()).filter(post => active ? matchesTopic(post, active) : belongsToChapter(post, chapter));
  list.append(...articleRows(posts));
  status.hidden = true;
} catch { status.textContent = '暂时无法读取文章，可以从归档浏览。'; }
