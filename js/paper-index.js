import { loadCatalog } from './article-catalog.js?v=4';
import { articleRows } from './catalog-view.js?v=3';
import { articleTopic, belongsToChapter, chapters } from './taxonomy.js?v=1';

const latest = document.getElementById('paper-latest');
const results = document.getElementById('paper-results');
const firstBatch = 24;
const fieldLabels = { technology: '技术', reading: '阅读', reflection: '思考', life: '生活' };

function articleField(post) {
  if (Object.hasOwn(fieldLabels, post.field)) return post.field;
  const metadata = [].concat(post.tags || [], post.categories || [], post.category).join(' ');
  if (/读书|阅读|书评|摘录|读后|书摘/.test(metadata) || /^(读书|阅读)笔记|书评|读后感/.test(post.title)) return 'reading';
  if (/思考|随想|反思|复盘/.test(metadata) || /^(如何|怎样)|习惯$/.test(post.title)) return 'reflection';
  return articleTopic(post).category === 'life' ? 'life' : 'technology';
}

function datedRows(posts) {
  const entries = articleRows(posts, post => fieldLabels[articleField(post)]);
  for (const entry of entries) {
    const date = entry.querySelector('time');
    if (date) date.textContent = date.dateTime.slice(0, 10).replaceAll('-', '.');
  }
  return entries;
}

function mountSearch(posts) {
  const controls = [...document.querySelectorAll('[data-paper-filter]')];
  const input = document.getElementById('paper-query');
  const count = document.getElementById('paper-count');
  const year = document.getElementById('paper-year');
  const more = document.getElementById('paper-more');
  const params = new URLSearchParams(location.search);
  const oldChapter = chapters.find(chapter => chapter.id === params.get('chapter'));
  let chapter = params.has('field') ? null : oldChapter;
  let filter = params.get('field') || '';
  let visible = firstBatch;
  input.value = params.get('q') || '';
  if (!Object.hasOwn(fieldLabels, filter)) filter = '';
  for (const value of new Set(posts.filter(post => post.date).map(post => post.date.slice(0, 4)))) {
    year.add(new Option(value, value));
  }
  year.value = params.get('year') || '';
  if (year.selectedIndex < 0) year.selectedIndex = 0;
  year.closest('.paper-search-filters').hidden = false;

  const indexed = posts.map(post => {
    const field = articleField(post);
    const text = [post.title, fieldLabels[field], articleTopic(post).title].concat(post.tags || [], post.categories || [], post.content)
      .filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
    return { post, field, text };
  });

  function render({ append = false } = {}) {
    const query = input.value.trim();
    const words = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    const matching = indexed.filter(({ post, field, text }) =>
      (!filter || filter === field) && (!chapter || belongsToChapter(post, chapter)) &&
      (!year.value || post.date.startsWith(year.value)) && words.every(word => text.includes(word)))
      .map(({ post }) => post);
    count.textContent = query ? `找到 ${matching.length} 篇文章` : `共 ${matching.length} 篇文章`;
    for (const control of controls) control.setAttribute('aria-pressed', String(!chapter && control.dataset.paperFilter === filter));
    more.hidden = matching.length <= visible;
    if (append) {
      const rows = datedRows(matching.slice(visible - firstBatch, visible));
      results.append(...rows);
      rows[0]?.querySelector('a')?.focus();
    } else if (matching.length) {
      results.replaceChildren(...datedRows(matching.slice(0, visible)));
    } else {
      const empty = document.createElement('p');
      empty.className = 'paper-index-status';
      empty.textContent = '这个范围里没有找到文章。';
      results.replaceChildren(empty);
    }
    const url = new URL(location.href);
    for (const [name, value] of [['q', query], ['field', filter], ['year', year.value], ['chapter', chapter?.id]]) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    history.replaceState(null, '', url);
  }

  function restart() {
    visible = firstBatch;
    render();
  }

  input.addEventListener('input', restart);
  year.addEventListener('change', restart);
  document.getElementById('paper-find').addEventListener('submit', event => {
    event.preventDefault();
    restart();
  });
  for (const control of controls) control.addEventListener('click', () => {
    chapter = null;
    filter = control.dataset.paperFilter;
    restart();
  });
  more.addEventListener('click', () => {
    visible += firstBatch;
    render({ append: true });
  });
  render();
}

loadCatalog().then(posts => {
  if (latest && posts.length) {
    latest.replaceChildren(...datedRows(posts.slice(0, 5)));
    const thoughts = posts.slice(5).filter(post => articleField(post) === 'reflection').slice(0, 3);
    if (thoughts.length) {
      const links = thoughts.map(post => {
        const item = document.createElement('li');
        const time = document.createElement('time');
        time.dateTime = post.date;
        time.textContent = post.date.slice(0, 10).replaceAll('-', '.');
        const link = document.createElement('a');
        link.href = post.url;
        link.textContent = post.title;
        item.append(time, link);
        return item;
      });
      document.getElementById('paper-thoughts').replaceChildren(...links);
      document.getElementById('home-thoughts').hidden = false;
    }
  }
  if (results) mountSearch(posts);
}).catch(() => {
  const status = document.getElementById('paper-count');
  if (status) status.textContent = '文章索引暂时无法加载。';
});
