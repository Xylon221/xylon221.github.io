const contentsTitle = '文章目录';

export function mountArticleContents(body) {
  const headings = [...body.querySelectorAll('h2, h3, h4')].filter(heading => heading.textContent.trim());
  if (!headings.length) return;
  const toc = document.createElement('details');
  toc.className = 'study-toc';
  if (document.querySelector('.post-toc-wrap .post-toc')) toc.dataset.nativeToc = '';
  else toc.open = matchMedia('(min-width: 52rem)').matches;
  const label = document.createElement('summary');
  label.textContent = contentsTitle;
  const list = document.createElement('ul');
  for (const [index, heading] of headings.entries()) {
    if (!heading.id) {
      let id = 'article-section-' + (index + 1);
      while (document.getElementById(id)) id += '-heading';
      heading.id = id;
    }
    const item = document.createElement('li');
    item.dataset.level = heading.tagName.slice(1);
    const link = document.createElement('a');
    link.href = '#' + encodeURIComponent(heading.id);
    link.textContent = heading.textContent.trim();
    item.append(link);
    list.append(item);
  }
  toc.append(label, list);
  body.before(toc);
}
