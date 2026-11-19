import { loadCatalog } from './article-catalog.js?v=3';
import { articleRows } from './catalog-view.js?v=2';
import { articleTopic, belongsToChapter, chapters } from './taxonomy.js?v=1';

const latest = document.getElementById('paper-latest');
const results = document.getElementById('paper-results');

function datedRows(posts) {
  const entries = articleRows(posts);
  for (const entry of entries) {
    const date = entry.querySelector('time');
    if (date) date.textContent = date.dateTime.replaceAll('-', '.');
  }
  return entries;
}

function mountSearch(posts) {
  const controls = [...document.querySelectorAll('[data-paper-filter]')];
  const input = document.getElementById('paper-query');
  const count = document.getElementById('paper-count');
  const params = new URLSearchParams(location.search);
  let filter = params.get('chapter') || '';
  input.value = params.get('q') || '';
  if (!chapters.some(chapter => chapter.id === filter)) filter = '';

  const indexed = posts.map(post => ({
    post,
    text: [post.title, articleTopic(post).title, ...(Array.isArray(post.tags) ? post.tags : []), post.content]
      .filter(Boolean).join(' ').normalize('NFKC').toLowerCase(),
  }));

  function render() {
    const query = input.value.trim();
    const words = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    const chapter = chapters.find(item => item.id === filter);
    const matching = indexed.filter(({ post, text }) =>
      (!chapter || belongsToChapter(post, chapter)) && words.every(word => text.includes(word)))
      .map(({ post }) => post);
    count.textContent = query ? `找到 ${matching.length} 篇文章` : `共 ${matching.length} 篇文章`;
    for (const control of controls) control.setAttribute('aria-pressed', String(control.dataset.paperFilter === filter));
    if (matching.length) results.replaceChildren(...datedRows(matching));
    else {
      const empty = document.createElement('p');
      empty.className = 'paper-index-status';
      empty.textContent = '这个范围里没有找到文章。';
      results.replaceChildren(empty);
    }
    const url = new URL(location.href);
    for (const [name, value] of [['q', query], ['chapter', filter]]) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    history.replaceState(null, '', url);
  }

  input.addEventListener('input', render);
  document.getElementById('paper-find').addEventListener('submit', event => {
    event.preventDefault();
    render();
  });
  for (const control of controls) control.addEventListener('click', () => {
    filter = control.dataset.paperFilter;
    render();
  });
  render();
}

loadCatalog().then(posts => {
  if (latest && posts.length) latest.replaceChildren(...datedRows(posts.slice(0, 5)));
  if (results) mountSearch(posts);
}).catch(() => {
  const status = document.getElementById('paper-count');
  if (status) status.textContent = '文章索引暂时无法加载。';
});
