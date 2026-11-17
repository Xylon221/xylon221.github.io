import { articleText } from './article-catalog.js?v=3';
import { articleTopic } from './taxonomy.js?v=1';

export function articleRows(posts) {
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'chapter-empty';
    empty.textContent = '这个栏目还没有文章。';
    return [empty];
  }
  return posts.map(post => {
    const row = document.createElement('article');
    row.className = 'catalog-row';
    row.innerHTML = '<a><div><p class="catalog-meta"></p><h3></h3><p class="catalog-summary"></p></div><span class="catalog-arrow" aria-hidden="true">↗</span></a>';
    row.querySelector('a').href = post.url;
    row.querySelector('h3').textContent = post.title;
    row.querySelector('.catalog-meta').textContent = `${post.date} · ${articleTopic(post).title}`;
    const excerpt = Array.from(articleText(post).replace(/\s+/g, ' '));
    const summary = row.querySelector('.catalog-summary');
    summary.textContent = excerpt.slice(0, 115).join('') + (excerpt.length > 115 ? '…' : '');
    if (!excerpt.length) summary.remove();
    return row;
  });
}
