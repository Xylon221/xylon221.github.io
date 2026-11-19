import { articleText } from './article-catalog.js?v=20261119-shelves';
import { articleTopic } from './taxonomy.js?v=20261119-shelves';

export function articleRows(posts, { titleOnly = false } = {}) {
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'chapter-empty';
    empty.textContent = '这个栏目还没有文章。';
    return [empty];
  }
  return posts.map(post => {
    const row = document.createElement('article');
    row.className = 'catalog-row';
    row.innerHTML = titleOnly ? '<a><h3></h3></a>' : '<a><div><p class="catalog-meta"></p><h3></h3><p class="catalog-summary"></p></div><span class="catalog-arrow" aria-hidden="true">↗</span></a>';
    row.querySelector('a').href = post.url;
    row.querySelector('h3').textContent = post.title;
    if (titleOnly) return row;
    const topic = articleTopic(post);
    const tags = Array.isArray(post.tags) ? post.tags.slice(0, 3).map(tag => '#' + tag) : [];
    row.querySelector('.catalog-meta').textContent = [post.date, topic.title !== topic.chapter.title ? topic.title : '', ...tags].filter(Boolean).join(' · ');
    const excerpt = Array.from(articleText(post).replace(/\s+/g, ' '));
    const summary = row.querySelector('.catalog-summary');
    summary.textContent = excerpt.slice(0, 115).join('') + (excerpt.length > 115 ? '…' : '');
    if (!excerpt.length) summary.remove();
    return row;
  });
}
