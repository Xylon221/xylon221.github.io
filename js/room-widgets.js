const main = document.querySelector('.home-grid');
const roomPanes = { '#articles': 'editorial', '#about': 'personal', '#today': 'today' };
const paneLinks = document.querySelectorAll('[data-room-pane]');

function showPane(hash) {
  const pane = roomPanes[hash] || 'editorial';
  main.dataset.pane = pane;
  for (const link of paneLinks) {
    if (link.dataset.roomPane === pane) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

for (const link of [...paneLinks, document.querySelector('.skip-link')]) {
  link.addEventListener('click', () => showPane(link.hash));
}
window.addEventListener('hashchange', () => showPane(location.hash));
showPane(location.hash);
