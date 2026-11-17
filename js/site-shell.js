const links = [
  ['书房', '/reading-room/'], ['学习篇', '/learning/'], ['生活篇', '/life/'], ['生活随笔', '/notes/'],
  ['归档', '/archives/'], ['标签', '/tags/'], ['关于', '/about/'], ['写作', '/write/'],
];

function mountNavigation() {
  const rail = document.createElement('aside');
  rail.className = 'site-rail';
  rail.innerHTML = `
    <div class="site-rail-toggle"><a href="/" aria-label="只想睡大觉，返回首页">只想睡大觉</a><button type="button" aria-expanded="false" aria-controls="site-rail-inner">菜单</button></div>
    <div class="site-rail-inner" id="site-rail-inner">
      <a class="site-rail-brand" href="/" aria-label="只想睡大觉，返回首页"><span class="site-rail-name">只想睡大觉</span><span class="site-rail-motto">循此苦旅，以达星辰</span></a>
      <nav class="site-rail-nav" aria-label="全站导航"></nav>
      <div class="site-rail-footer"><span>© 只想睡大觉</span><a href="https://github.com/Xylon221">GitHub ↗</a></div>
    </div>`;
  const nav = rail.querySelector('nav');
  for (const [title, path] of links) {
    const link = document.createElement('a');
    link.href = path;
    link.textContent = title;
    if (location.pathname.startsWith(path)) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  const toggle = rail.querySelector('button');
  function openMenu(open) {
    rail.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起' : '菜单';
  }
  toggle.addEventListener('click', () => openMenu(rail.dataset.open !== 'true'));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || rail.dataset.open !== 'true') return;
    openMenu(false);
    toggle.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (rail.dataset.open === 'true' && !rail.contains(event.target)) openMenu(false);
  });
  document.body.prepend(rail);
  document.body.classList.add('site-framed');
}

mountNavigation();

const body = document.querySelector('.published-body, .post-body[itemprop="articleBody"]');
if (body && /^\/\d{4}\/\d{2}\/[^/]+\/$/.test(location.pathname)) {
  import('./comments.js?v=1').then(({ mountComments }) => mountComments(body.closest('article') || body));
}
