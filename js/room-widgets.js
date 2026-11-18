import { deskEndpoint } from './desk-config.js?v=2';
import { mountPlayer } from './room-player.js?v=1';

const get = id => document.getElementById(id);
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
  if (pane === 'today') get('today').open = true;
}

for (const link of [...paneLinks, document.querySelector('.skip-link')]) {
  link.addEventListener('click', () => showPane(link.hash));
}
window.addEventListener('hashchange', () => showPane(location.hash));
showPane(location.hash);
mountPlayer();

const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const toDate = key => new Date(key + 'T12:00:00');
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const longDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const monthDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });
const timeOnly = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function updateTodayLabel() {
  const now = new Date();
  get('today-label').dateTime = dateKey(now);
  get('today-label').textContent = shortDate.format(now);
  return dateKey(now);
}
updateTodayLabel();

class DeskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function mountDesk(endpoint) {
  const login = get('desk-login');
  const keyInput = get('desk-key');
  const work = get('desk-workspace');
  const calendar = get('calendar-days');
  const message = get('desk-message');
  const taskInput = get('task-input');
  const noteInput = get('note-input');
  const tokenKey = 'reading-room:desk-session:v1';
  const drafts = new Map();
  const attempts = new Map();
  let selected = updateTodayLabel();
  let month = selected.slice(0, 7);
  let token = '';
  let pendingRead;
  let busy = false;
  let editing = null;
  let entriesSignature = '';
  let calendarSignature = '';
  let marked = new Set();

  function showMessage(text = '') {
    delete message.dataset.connection;
    message.textContent = text;
    message.hidden = !text;
  }

  function getStoredToken() {
    try {
      return localStorage.getItem(tokenKey) || '';
    } catch {
      return '';
    }
  }

  function remember(value) {
    try {
      if (value) localStorage.setItem(tokenKey, value);
      else localStorage.removeItem(tokenKey);
    } catch {
      // A browser that blocks storage can still use the active login.
    }
  }

  async function request(path, { method = 'GET', data, signal, session = token } = {}) {
    const headers = {};
    if (session) headers.Authorization = 'Bearer ' + session;
    if (data) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(endpoint + '/v1' + path, {
        method, headers, signal: signal || AbortSignal.timeout(15000),
        body: data ? JSON.stringify(data) : undefined, credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new DeskError(0, '暂时连不上云端，请检查网络后重试。');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new DeskError(response.status, payload.message || '云同步暂时不可用。');
    return payload;
  }

  function setEditing(record) {
    editing = record;
    get('note-cancel').hidden = !record;
    get('note-save').textContent = record ? '保存修改' : '保存';
  }

  function resetSession(text = '', clearStored = true) {
    pendingRead?.abort();
    pendingRead = undefined;
    token = '';
    if (clearStored) remember('');
    drafts.clear();
    attempts.clear();
    marked.clear();
    entriesSignature = '';
    calendarSignature = '';
    selected = updateTodayLabel();
    month = selected.slice(0, 7);
    taskInput.value = '';
    noteInput.value = '';
    setEditing(null);
    calendar.replaceChildren();
    get('desk-tasks').replaceChildren();
    get('desk-notes').replaceChildren();
    get('task-count').textContent = '';
    get('desk-preview').hidden = false;
    work.hidden = true;
    showMessage(text);
  }

  function renderCalendar() {
    const today = updateTodayLabel();
    const signature = JSON.stringify([month, selected, today, ...marked]);
    if (signature === calendarSignature) return;
    calendarSignature = signature;
    const focused = calendar.contains(document.activeElement) ? document.activeElement.dataset.day : '';
    const first = toDate(month + '-01');
    const year = first.getFullYear();
    const monthIndex = first.getMonth();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const content = document.createDocumentFragment();
    get('month-label').textContent = monthDate.format(first);
    for (let empty = 0; empty < offset; empty++) {
      const blank = document.createElement('span');
      blank.setAttribute('aria-hidden', 'true');
      content.append(blank);
    }
    for (let number = 1; number <= days; number++) {
      const day = month + '-' + String(number).padStart(2, '0');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.day = day;
      button.textContent = number;
      button.setAttribute('aria-pressed', String(day === selected));
      if (day === today) button.setAttribute('aria-current', 'date');
      if (marked.has(day)) button.dataset.record = '';
      button.setAttribute('aria-label', longDate.format(toDate(day)) + (marked.has(day) ? '，有记录' : ''));
      content.append(button);
    }
    calendar.replaceChildren(content);
    if (focused) calendar.querySelector(`[data-day="${focused}"]`)?.focus({ preventScroll: true });
  }

  function action(label, onClick, id) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desk-text';
    button.textContent = label;
    if (id) button.id = id;
    button.addEventListener('click', onClick);
    return button;
  }

  function deleteRecord(record) {
    if (!confirm(record.kind === 'task' ? '删除这条待办？' : '删除这条随笔？')) return;
    void save('/entries/' + record.id, 'DELETE', { version: record.version }, () => {
      if (editing?.id === record.id) {
        setEditing(null);
        noteInput.value = '';
      }
    });
  }

  function taskRow(record) {
    const row = document.createElement('li');
    row.className = 'desk-task-row';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'task-' + record.id;
    box.checked = Boolean(record.done);
    box.addEventListener('change', () => {
      const done = box.checked;
      box.checked = Boolean(record.done);
      void save('/entries/' + record.id, 'PATCH', { version: record.version, done });
    });
    const body = document.createElement('span');
    body.textContent = record.body;
    label.append(box, body);
    const remove = action('删除', () => deleteRecord(record), 'remove-' + record.id);
    remove.setAttribute('aria-label', '删除待办：' + record.body);
    row.append(label, remove);
    return row;
  }

  function noteRow(record) {
    const row = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const time = document.createElement('time');
    const date = new Date(record.created_at);
    time.dateTime = date.toISOString();
    time.textContent = timeOnly.format(date);
    const edit = action('编辑', () => {
      if (editing?.id === record.id && editing.version === record.version) {
        noteInput.focus();
        return;
      }
      if (noteInput.value.trim() && !confirm('放弃当前未保存的随笔，打开这条记录？')) return;
      setEditing(record);
      noteInput.value = record.body;
      noteInput.focus();
    }, 'edit-' + record.id);
    meta.append(time, edit, action('删除', () => deleteRecord(record), 'remove-' + record.id));
    const body = document.createElement('p');
    body.textContent = record.body;
    row.append(meta, body);
    return row;
  }

  function renderEntries(entries) {
    const signature = JSON.stringify(entries);
    if (signature === entriesSignature) return;
    entriesSignature = signature;
    const tasks = entries.filter(record => record.kind === 'task');
    const notes = entries.filter(record => record.kind === 'note').reverse();
    const focusId = document.activeElement?.id;
    get('desk-tasks').replaceChildren(...tasks.map(taskRow));
    get('desk-notes').replaceChildren(...notes.map(noteRow));
    const count = tasks.filter(record => record.done).length;
    get('task-count').textContent = tasks.length ? `${count}/${tasks.length}` : '';
    if (focusId && document.activeElement === document.body) get(focusId)?.focus({ preventScroll: true });
  }

  async function refresh({ duringSave = false } = {}) {
    if (!token || (busy && !duringSave)) return;
    pendingRead?.abort();
    const controller = new AbortController();
    const session = token;
    pendingRead = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 12000);
    try {
      const { entries, marked: days } = await request('/day?' + new URLSearchParams({ day: selected, month }), {
        session, signal: controller.signal,
      });
      if (pendingRead !== controller || session !== token) return;
      marked = new Set(days);
      renderCalendar();
      renderEntries(entries);
      get('desk-preview').hidden = true;
      work.hidden = false;
      get('desk-sync').textContent = '已同步';
      if (message.dataset.connection) showMessage();
    } catch (error) {
      if (pendingRead !== controller || session !== token) return;
      if (error.status === 401) resetSession('登录已过期，请重新登录。');
      else if (!controller.signal.aborted || controller.signal.reason === 'timeout') {
        get('desk-sync').textContent = '同步暂不可用';
        if (work.hidden) {
          showMessage('暂时连不上云端，页面会自动重试。');
          message.dataset.connection = 'true';
        }
      }
    } finally {
      clearTimeout(timeout);
      if (pendingRead === controller) pendingRead = undefined;
    }
  }

  function select(day) {
    if (busy || day === selected) return;
    drafts.set(selected, { task: taskInput.value, note: noteInput.value, editing });
    selected = day;
    const nextMonth = day.slice(0, 7);
    if (nextMonth !== month) marked.clear();
    month = nextMonth;
    const draft = drafts.get(selected);
    taskInput.value = draft?.task || '';
    noteInput.value = draft?.note || '';
    setEditing(draft?.editing || null);
    get('desk-day-title').textContent = shortDate.format(toDate(day));
    get('desk-sync').textContent = '同步中…';
    renderCalendar();
    renderEntries([]);
    showMessage();
    void refresh();
  }

  function moveMonth(offset) {
    const [year, number] = month.split('-').map(Number);
    const first = new Date(year, number - 1 + offset, 1, 12);
    if (first.getFullYear() < 1000 || first.getFullYear() > 9999) return;
    const now = updateTodayLabel();
    const target = dateKey(first);
    select(now.startsWith(target.slice(0, 7)) ? now : target);
  }

  function setBusy(value) {
    busy = value;
    for (const field of [taskInput, noteInput]) field.readOnly = value;
    for (const control of work.querySelectorAll('button, input[type="checkbox"]')) control.disabled = value;
  }

  async function save(path, method, data, onSaved) {
    if (busy || !token) return;
    setBusy(true);
    pendingRead?.abort();
    pendingRead = undefined;
    showMessage();
    get('desk-sync').textContent = '正在保存…';
    const session = token;
    try {
      await request(path, { method, data, session });
      if (session !== token) return;
      onSaved?.();
      await refresh({ duringSave: true });
    } catch (error) {
      if (session !== token) return;
      if (error.status === 401) resetSession('登录已过期，请重新登录。');
      else {
        showMessage(error.message);
        if (error.status === 409) await refresh({ duringSave: true });
        else get('desk-sync').textContent = '同步待确认';
      }
    } finally {
      setBusy(false);
    }
  }

  function create(kind, text, input) {
    if (!text) return;
    const attemptKey = selected + ':' + kind;
    const previous = attempts.get(attemptKey);
    const id = previous?.text === text ? previous.id : crypto.randomUUID();
    attempts.set(attemptKey, { id, text });
    void save('/entries', 'POST', { id, day: selected, kind, body: text }, () => {
      input.value = '';
      attempts.delete(attemptKey);
    });
  }

  function beginSession(value) {
    token = value;
    get('desk-day-title').textContent = shortDate.format(toDate(selected));
    void refresh();
  }

  login.hidden = false;
  login.addEventListener('submit', async event => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
      showMessage('请粘贴完整的 43 位站主密钥。');
      keyInput.select();
      return;
    }
    const button = login.querySelector('button');
    button.disabled = true;
    showMessage();
    try {
      const { token: value } = await request('/session', { method: 'POST', data: { key }, session: '' });
      keyInput.value = '';
      remember(value);
      beginSession(value);
    } catch (error) {
      showMessage(error.message);
      if (error.status === 401) keyInput.select();
    } finally {
      button.disabled = false;
    }
  });
  get('desk-logout').addEventListener('click', async () => {
    setBusy(true);
    const session = token;
    try {
      await request('/session', { method: 'DELETE', session });
      if (session === token) resetSession();
    } catch (error) {
      if (session === token) {
        if (error.status === 401) resetSession();
        else showMessage('退出失败，请连接网络后重试。');
      }
    } finally {
      setBusy(false);
    }
  });
  calendar.addEventListener('click', event => {
    const day = event.target.closest('[data-day]')?.dataset.day;
    if (day) select(day);
  });
  get('previous-month').addEventListener('click', () => moveMonth(-1));
  get('next-month').addEventListener('click', () => moveMonth(1));
  get('go-today').addEventListener('click', () => select(updateTodayLabel()));
  get('task-form').addEventListener('submit', event => {
    event.preventDefault();
    create('task', taskInput.value.trim(), taskInput);
  });
  get('note-form').addEventListener('submit', event => {
    event.preventDefault();
    const body = noteInput.value.trim();
    if (!body) return;
    if (editing) {
      void save('/entries/' + editing.id, 'PATCH', { body, version: editing.version }, () => {
        noteInput.value = '';
        setEditing(null);
      });
    } else create('note', body, noteInput);
  });
  get('note-cancel').addEventListener('click', () => {
    setEditing(null);
    noteInput.value = '';
  });

  function checkVisible() {
    if (document.hidden) return;
    updateTodayLabel();
    if (!pendingRead) void refresh();
  }
  document.addEventListener('visibilitychange', checkVisible);
  window.addEventListener('online', checkVisible);
  window.addEventListener('pageshow', checkVisible);
  window.addEventListener('storage', event => {
    if (event.key !== tokenKey && event.key !== null) return;
    const stored = getStoredToken();
    if (stored === token) return;
    resetSession('', false);
    if (stored) beginSession(stored);
  });
  setInterval(checkVisible, 15000);
  const stored = getStoredToken();
  if (stored) beginSession(stored);
}

if (deskEndpoint) mountDesk(deskEndpoint.replace(/\/$/, ''));
else get('desk-intro').textContent = '私人待办与随笔 · 云同步待启用';
