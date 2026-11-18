const netease = 'https://music.163.com';
const playlistId = /^[1-9]\d{0,19}$/;

export function parsePlaylist(value) {
  const text = value.trim();
  if (playlistId.test(text)) return text;
  const shareLink = text.match(/https?:\/\/[^\s<>"，。]+/i)?.[0];
  try {
    const url = new URL(shareLink || text);
    if (!['music.163.com', 'y.music.163.com'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return '';
    const route = new URL(url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname + url.search, netease);
    const [, embedded] = /^\/(?:m\/)?playlist\/(\d+)\/?$/.exec(route.pathname) || [];
    const isPlaylist = /^\/(?:m\/)?playlist\/?$/.test(route.pathname);
    const isPlayer = route.pathname === '/outchain/player' && route.searchParams.get('type') === '0';
    const id = embedded || ((isPlaylist || isPlayer) && route.searchParams.get('id')) || '';
    return playlistId.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function mountPlayer() {
  const get = id => document.getElementById(id);
  const dock = get('room-player');
  const tracks = [
    { title: '雾林', source: '/audio/mist.mp3' },
    { title: '湖边', source: '/audio/lake.mp3' },
    { title: '微光', source: '/audio/dusk.mp3' },
  ];
  const audio = get('room-audio');
  const play = get('player-play');
  const seek = get('player-seek');
  const status = get('player-status');
  const nowPlaying = get('player-current');
  const local = get('player-local');
  const cloud = get('player-cloud');
  const form = get('playlist-form');
  const linkInput = get('playlist-link');
  const error = get('playlist-status');
  const playerFrame = get('playlist-embed');
  const openOnNetease = get('playlist-open');
  const storageKey = 'reading-room:netease-playlist';
  let index = 0;
  let savedPlaylist = '';
  try {
    const stored = localStorage.getItem(storageKey) || '';
    if (playlistId.test(stored)) savedPlaylist = stored;
  } catch {
    // The current page still works with storage disabled.
  }
  linkInput.value = savedPlaylist;

  function clock(seconds) {
    const whole = Math.floor(seconds || 0);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  function updateProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.disabled = !duration;
    seek.max = duration || 1;
    seek.value = audio.currentTime;
    get('player-position').textContent = clock(audio.currentTime);
    get('player-duration').textContent = clock(duration || 24);
  }

  async function start() {
    status.hidden = true;
    try {
      await audio.play();
    } catch (failure) {
      if (failure.name === 'AbortError') return;
      status.textContent = '现在无法播放这首曲子。';
      status.hidden = false;
    }
  }

  function change(offset, resume) {
    index = (index + offset + tracks.length) % tracks.length;
    const track = tracks[index];
    nowPlaying.textContent = track.title;
    status.hidden = true;
    audio.src = track.source;
    updateProgress();
    if (resume) void start();
  }

  function updateButton() {
    play.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    play.firstElementChild.textContent = audio.paused ? '▶' : 'Ⅱ';
  }

  function loadPlaylist(id) {
    const iframe = document.createElement('iframe');
    iframe.title = '网易云音乐公开歌单播放器';
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox');
    iframe.src = netease + '/outchain/player?' + new URLSearchParams({ type: '0', id, auto: '0', height: '270' });
    playerFrame.replaceChildren(iframe);
    playerFrame.hidden = false;
    openOnNetease.href = netease + '/#/playlist?id=' + id;
    openOnNetease.hidden = false;
  }

  function selectSource(useCloud) {
    if ((cloud.getAttribute('aria-pressed') === 'true') === useCloud) return;
    local.setAttribute('aria-pressed', String(!useCloud));
    cloud.setAttribute('aria-pressed', String(useCloud));
    get('local-player').hidden = useCloud;
    get('cloud-player').hidden = !useCloud;
    nowPlaying.textContent = useCloud ? '网易云歌单' : tracks[index].title;
    if (useCloud) {
      audio.pause();
      if (savedPlaylist) loadPlaylist(savedPlaylist);
    } else {
      playerFrame.replaceChildren();
      playerFrame.hidden = true;
    }
  }

  local.addEventListener('click', () => selectSource(false));
  cloud.addEventListener('click', () => selectSource(true));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = parsePlaylist(linkInput.value);
    error.hidden = Boolean(id);
    if (!id) {
      error.textContent = '请粘贴完整的网易云音乐歌单链接，或填写歌单 ID。';
      return;
    }
    savedPlaylist = id;
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // The playlist remains available in this page.
    }
    loadPlaylist(id);
  });
  dock.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dock.open) {
      dock.open = false;
      dock.querySelector('summary').focus();
    }
  });

  play.addEventListener('click', () => audio.paused ? void start() : audio.pause());
  get('player-prev').addEventListener('click', () => change(-1, !audio.paused));
  get('player-next').addEventListener('click', () => change(1, !audio.paused));
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); });
  for (const event of ['timeupdate', 'loadedmetadata', 'durationchange']) audio.addEventListener(event, updateProgress);
  for (const event of ['play', 'pause', 'emptied']) audio.addEventListener(event, updateButton);
  audio.addEventListener('ended', () => change(1, true));
}
