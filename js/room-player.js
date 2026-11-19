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

const tracks = [
  { title: '雾林', source: '/audio/mist.mp3' },
  { title: '湖边', source: '/audio/lake.mp3' },
  { title: '微光', source: '/audio/dusk.mp3' },
];
const stateKey = 'reading-room:music:v2';
const playlistKey = 'reading-room:netease-playlist';

function readStorage(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The player can still run without storage. */ }
}

export function mountPlayer() {
  if (document.getElementById('music-dock')) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/css/music-dock.css?v=3';
  document.head.append(stylesheet);

  const dock = document.createElement('aside');
  dock.className = 'music-dock';
  dock.id = 'music-dock';
  dock.setAttribute('aria-label', '书房音乐');
  dock.hidden = true;
  stylesheet.addEventListener('load', () => { dock.hidden = false; }, { once: true });
  stylesheet.addEventListener('error', () => { dock.hidden = false; }, { once: true });
  dock.innerHTML = `
    <div class="music-compact">
      <button type="button" id="music-toggle" aria-label="播放">
        <img src="/images/journal-lake-small.webp" width="42" height="42" alt="" loading="lazy">
        <span aria-hidden="true">▶</span>
      </button>
      <button type="button" id="music-open" aria-expanded="false" aria-controls="music-sheet">
        <span id="music-current"></span><span class="music-open-icon" aria-hidden="true">≡</span>
      </button>
    </div>
    <section id="music-sheet" class="music-sheet" aria-label="播放列表" hidden>
      <header class="music-heading"><h2>书房音乐</h2><button id="music-close" type="button" aria-label="收起播放器">×</button></header>
      <div class="music-sources">
        <button id="music-local" type="button" aria-pressed="true">书房曲目</button>
        <button id="music-cloud" type="button" aria-pressed="false">网易云歌单</button>
      </div>
      <div id="music-local-panel">
        <audio id="music-audio" preload="none"></audio>
        <input id="music-seek" type="range" min="0" max="1" step=".1" value="0" aria-label="播放进度" disabled>
        <div class="music-controls">
          <div><button id="music-prev" type="button" aria-label="上一曲">‹</button>
          <button id="music-next" type="button" aria-label="下一曲">›</button></div>
          <output id="music-time">0:00</output>
          <label>音量 <input id="music-volume" type="range" min="0" max="1" step=".05" value=".65"></label>
        </div>
        <ol class="music-list" id="music-list"></ol>
        <p class="music-message" id="music-status" role="status" hidden></p>
      </div>
      <div id="music-cloud-panel" hidden>
        <form id="music-form">
          <label for="music-link">公开歌单链接或 ID</label>
          <div class="music-input"><input id="music-link" type="text" inputmode="url" maxlength="1000" required>
          <button type="submit">载入</button></div>
          <p class="music-message" id="music-error" role="status" hidden></p>
        </form>
        <div id="music-frame"></div>
        <a id="music-external" target="_blank" rel="noopener noreferrer" hidden>在网易云音乐打开</a>
      </div>
    </section>`;
  document.body.append(dock);

  const get = id => dock.querySelector('#' + id);
  const audio = get('music-audio');
  const opener = get('music-open');
  const toggle = get('music-toggle');
  const sheet = get('music-sheet');
  const seek = get('music-seek');
  const volume = get('music-volume');
  const status = get('music-status');
  const nowPlaying = get('music-current');
  const input = get('music-link');
  const embed = get('music-frame');
  const external = get('music-external');
  const error = get('music-error');
  let options = {};
  try { options = JSON.parse(readStorage(stateKey)) || {}; } catch { /* Use defaults. */ }
  let index = Number.isInteger(options.index) && tracks[options.index] ? options.index : 0;
  let pendingPosition = Number.isFinite(options.position) && options.position > 0 ? options.position : 0;
  let playlist = parsePlaylist(readStorage(playlistKey));
  let cloud = false;
  audio.volume = Number.isFinite(options.volume) && options.volume >= 0 && options.volume <= 1 ? options.volume : .65;
  volume.value = audio.volume;
  input.value = playlist;

  function preserve() {
    store(stateKey, JSON.stringify({ index, volume: audio.volume, position: pendingPosition || audio.currentTime }));
  }

  function showSheet(open, focus = false) {
    sheet.hidden = !open;
    opener.setAttribute('aria-expanded', String(open));
    if (focus) opener.focus();
  }

  function syncPlayback() {
    const label = cloud ? '打开网易云播放器' : (audio.paused ? '播放' : '暂停');
    toggle.setAttribute('aria-label', label);
    toggle.querySelector('span').textContent = audio.paused ? '▶' : 'Ⅱ';
  }

  function clock(seconds) {
    const integer = Math.floor(seconds || 0);
    return Math.floor(integer / 60) + ':' + String(integer % 60).padStart(2, '0');
  }

  function syncProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.disabled = !duration;
    seek.max = duration || 1;
    seek.value = audio.currentTime;
    get('music-time').textContent = clock(audio.currentTime) + (duration ? ' / ' + clock(duration) : '');
  }

  async function start() {
    status.hidden = true;
    try {
      await audio.play();
    } catch (failure) {
      if (failure.name === 'AbortError') return;
      status.textContent = '这首曲子暂时无法播放。';
      status.hidden = false;
    }
  }

  const queue = tracks.map((track, position) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = track.title;
    button.addEventListener('click', () => select(position, true));
    item.append(button);
    get('music-list').append(item);
    return button;
  });

  function select(position, play = false, restore = false) {
    if (!restore) pendingPosition = 0;
    index = (position + tracks.length) % tracks.length;
    nowPlaying.textContent = tracks[index].title;
    audio.src = tracks[index].source;
    queue.forEach((button, item) => button.setAttribute('aria-current', String(item === index)));
    status.hidden = true;
    syncProgress();
    if (play) void start();
    else preserve();
  }

  function mountPlaylist() {
    if (!playlist || embed.firstChild) return;
    const frame = document.createElement('iframe');
    frame.title = '网易云音乐公开歌单';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.src = netease + '/outchain/player?' + new URLSearchParams({ type: '0', id: playlist, auto: '0', height: '270' });
    embed.append(frame);
    external.href = netease + '/#/playlist?id=' + playlist;
    external.hidden = false;
  }

  function selectSource(useCloud) {
    if (cloud === useCloud) return;
    cloud = useCloud;
    get('music-local-panel').hidden = cloud;
    get('music-cloud-panel').hidden = !cloud;
    get('music-local').setAttribute('aria-pressed', String(!cloud));
    get('music-cloud').setAttribute('aria-pressed', String(cloud));
    if (cloud) {
      audio.pause();
      nowPlaying.textContent = '网易云歌单';
      mountPlaylist();
    } else {
      embed.replaceChildren();
      nowPlaying.textContent = tracks[index].title;
    }
    syncPlayback();
  }

  select(index, false, true);
  toggle.addEventListener('click', () => {
    if (cloud) showSheet(true);
    else if (audio.paused) void start();
    else audio.pause();
  });
  opener.addEventListener('click', () => showSheet(sheet.hidden));
  get('music-close').addEventListener('click', () => showSheet(false, true));
  dock.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !sheet.hidden) showSheet(false, true);
  });
  get('music-local').addEventListener('click', () => selectSource(false));
  get('music-cloud').addEventListener('click', () => selectSource(true));
  get('music-prev').addEventListener('click', () => select(index - 1, !audio.paused));
  get('music-next').addEventListener('click', () => select(index + 1, !audio.paused));
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); });
  volume.addEventListener('input', () => { audio.volume = Number(volume.value); preserve(); });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingPosition && pendingPosition < audio.duration - 1) audio.currentTime = pendingPosition;
    pendingPosition = 0;
    syncProgress();
  });
  for (const event of ['timeupdate', 'durationchange']) audio.addEventListener(event, syncProgress);
  for (const event of ['play', 'pause', 'emptied']) audio.addEventListener(event, syncPlayback);
  audio.addEventListener('pause', preserve);
  audio.addEventListener('ended', () => select(index + 1, true));
  window.addEventListener('pagehide', preserve);
  get('music-form').addEventListener('submit', event => {
    event.preventDefault();
    const id = parsePlaylist(input.value);
    error.hidden = Boolean(id);
    if (!id) {
      error.textContent = '请输入完整的网易云歌单链接或歌单 ID。';
      return;
    }
    playlist = id;
    store(playlistKey, playlist);
    embed.replaceChildren();
    mountPlaylist();
  });
}
