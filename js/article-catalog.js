export async function fetchPage(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response;
}

async function loadArchiveDates() {
  const dates = new Map();
  const visited = new Set();
  let page = '/archives/';

  while (page && !visited.has(page)) {
    visited.add(page);
    const response = await fetchPage(page);
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');

    for (const link of html.querySelectorAll('a.post-title-link[href]')) {
      const date = link.closest('article')?.querySelector('time[datetime]')?.dateTime.slice(0, 10);
      if (date) dates.set(new URL(link.getAttribute('href'), location.origin).pathname, date);
    }

    const next = html.querySelector('.pagination a[rel="next"]')?.getAttribute('href');
    page = next?.startsWith('/archives/page/') ? next : null;
  }

  return dates;
}

export function articleCategory(post) {
  if (post.category) return post.category;
  const tags = Array.isArray(post.tags) ? post.tags : [];
  if (tags.some(tag => /CKKS|同态加密|隐私保护|差分隐私|安全多方计算/i.test(tag))) return 'privacy';
  if (tags.some(tag => /随想|随笔|生活|读书/.test(tag))) return 'life';
  return 'technical';
}

export function articleText(post) {
  const text = typeof post.content === 'string' ? post.content.trim() : '';
  return !post.web_draft_id && text.startsWith(post.title) ? text.slice(post.title.length).trim() : text;
}

export async function loadCatalog() {
  const [index, dates] = await Promise.all([
    fetchPage('/search.json').then(response => response.json()),
    loadArchiveDates().catch(() => new Map()),
  ]);
  const articles = index.flatMap(post => {
    if (!post || typeof post.title !== 'string' || typeof post.url !== 'string') return [];
    let url;
    try { url = new URL(post.url, location.origin); }
    catch { return []; }
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return [];
    const month = url.pathname.match(/^\/(\d{4})\/(\d{2})\//);
    const date = post.date || dates.get(url.pathname) || (month ? `${month[1]}-${month[2]}` : '');
    return [{ ...post, url: url.pathname, date }];
  });
  return articles.reverse().sort((first, second) => second.date.localeCompare(first.date));
}
