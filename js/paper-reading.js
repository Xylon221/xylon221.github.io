import { loadCatalog } from './article-catalog.js?v=3';

function addReadingIndex(body) {
  const headings = [...body.querySelectorAll('h2, h3, h4')].filter(heading => heading.textContent.trim());
  if (headings.length < 2) return;
  const legacy = document.querySelector('.post-toc .nav a, .post-toc a[href^="#"]');
  const details = document.createElement('details');
  details.className = 'paper-toc-inline';
  if (legacy) details.dataset.themeToc = '';
  const summary = document.createElement('summary');
  summary.textContent = '文章目录';
  const list = document.createElement('ul');
  let id = 0;
  for (const heading of headings) {
    if (!heading.id) {
      let anchor;
      do { anchor = 'section-' + ++id; } while (document.getElementById(anchor));
      heading.id = anchor;
    }
    const row = document.createElement('li');
    row.dataset.level = heading.tagName.slice(1);
    const link = document.createElement('a');
    link.href = '#' + encodeURIComponent(heading.id);
    link.textContent = heading.textContent.trim();
    row.append(link);
    list.append(row);
  }
  details.append(summary, list);
  body.before(details);
}

async function addAdjacentArticles(body) {
  const posts = await loadCatalog();
  const index = posts.findIndex(post => post.url === location.pathname);
  if (index < 0) return;
  const pages = [['上一篇', posts[index + 1]], ['下一篇', posts[index - 1]]];
  const nav = document.createElement('nav');
  nav.className = 'paper-adjacent';
  nav.setAttribute('aria-label', '上一篇和下一篇');
  for (const [label, post] of pages) {
    if (!post) continue;
    const link = document.createElement('a');
    link.href = post.url;
    const caption = document.createElement('small');
    caption.textContent = label;
    const title = document.createElement('span');
    title.textContent = post.title;
    link.append(caption, title);
    nav.append(link);
  }
  if (nav.childElementCount) body.after(nav);
}

export function mountReading(body) {
  const pageTitle = document.querySelector('.post-header .post-title, .published-heading h1');
  const opening = body.firstElementChild;
  if (opening?.matches('h1, h2') && opening.textContent.trim() === pageTitle?.textContent.trim()) {
    opening.classList.add('paper-repeat-heading');
    opening.setAttribute('aria-hidden', 'true');
  }
  for (const table of body.querySelectorAll('table')) {
    if (table.closest('.highlight, figure[class*="code"]')) continue;
    if (table.parentElement.classList.contains('table-container')) {
      table.parentElement.classList.add('paper-table');
      continue;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'paper-table';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('aria-label', '文章表格');
    table.before(wrapper);
    wrapper.append(table);
  }
  addReadingIndex(body);
  if (body.classList.contains('published-body') && !document.querySelector('.post-nav, .paper-adjacent')) {
    void addAdjacentArticles(body).catch(() => {});
  }
}
