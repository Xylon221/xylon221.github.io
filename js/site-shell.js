const navigation = [
  ['首页', '/', path => path === '/'],
  ['文章', '/posts/', path => /^\/(?:posts|learning|life|notes|categories|\d{4})\//.test(path)],
  ['标签', '/tags/'], ['归档', '/archives/'], ['关于', '/about/'], ['Daily Todo', '/daily-todo/'],
];
const utilities = [['书房', '/reading-room/'], ['Daily Todo', '/daily-todo/'], ['生活随笔', '/notes/'],
  ['写作', '/write/'], ['GitHub', 'https://github.com/Xylon221']];

function link(label, path) {
  const item = document.createElement('a');
  item.href = path;
  item.textContent = label;
  return item;
}

function mountNavigation() {
  if (document.querySelector('[data-book-header]')) return;
  const header = document.createElement('header');
  header.className = 'book-masthead';
  header.dataset.bookHeader = '';
  const inner = document.createElement('div');
  inner.className = 'paper-shell book-masthead-inner';
  const title = link('且听风吟', '/');
  title.className = 'book-wordmark';
  const nav = document.createElement('nav');
  nav.className = 'book-nav';
  nav.setAttribute('aria-label', '全站导航');
  for (const [label, path, match = value => value.startsWith(path)] of navigation) {
    const item = link(label, path);
    if (match(location.pathname)) item.setAttribute('aria-current', 'page');
    nav.append(item);
  }
  const search = document.createElement('form');
  search.className = 'book-search';
  search.action = '/posts/';
  search.setAttribute('role', 'search');
  search.setAttribute('aria-label', '全站搜索');
  search.innerHTML = '<input type="search" name="q" aria-label="搜索全站文章" placeholder="搜索文章" required><button type="submit">搜索</button>';
  search.addEventListener('submit', event => {
    event.preventDefault();
    const query = search.elements.namedItem('q').value.trim();
    if (query) location.assign(`/posts/?${new URLSearchParams({ q: query })}`);
  });
  inner.append(title, nav, search);
  header.append(inner);
  document.body.prepend(header);
}

function mountFooter() {
  if (document.querySelector('[data-book-footer]') || document.body.classList.contains('room-home')) return;
  const nav = document.createElement('nav');
  nav.className = 'book-utilities';
  nav.setAttribute('aria-label', '书房链接');
  for (const [label, path] of utilities) nav.append(link(label, path));
  const existing = document.querySelector('body > footer.room-footer');
  if (existing) {
    existing.classList.add('book-colophon');
    existing.append(nav);
    return;
  }
  const themeFooter = document.querySelector('.footer .footer-inner');
  if (themeFooter) {
    themeFooter.append(nav);
    return;
  }
  const footer = document.createElement('footer');
  footer.className = 'paper-shell book-colophon';
  footer.innerHTML = '<div><p lang="la">Ad astra per aspera</p><p>循此苦旅，以达星辰。</p></div>';
  footer.append(nav);
  document.body.append(footer);
}

mountNavigation();
mountFooter();
document.body.classList.add('site-framed');
document.title = document.title.replace(/([·|]\s*)只想睡大觉$/, '$1且听风吟');

const body = document.querySelector('.published-body, .post-body[itemprop="articleBody"]');
if (body && /^\/\d{4}\/\d{2}\/[^/]+\/$/.test(location.pathname)) {
  document.body.classList.add('paper-reading');
  import('./paper-reading.js?v=1').then(({ mountReading }) => mountReading(body));
  import('./comments.js?v=4').then(({ mountComments }) => mountComments(body.closest('article') || body));
}
import('./room-player.js?v=4').then(({ mountPlayer }) => mountPlayer());
