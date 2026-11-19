import { deskEndpoint } from './desk-config.js?v=2';
import { dateKey, deskRequest, getStoredToken, remember, toDate, tokenKey } from './desk-client.js?v=1';

const byId = id => document.getElementById(id);
const calendar = byId('desk-mini-calendar');
const notes = byId('desk-mini-notes');
const noteDate = byId('desk-note-date');
const login = byId('desk-mini-login');
const key = byId('desk-mini-key');
const privateNotes = byId('desk-mini-private');
const status = byId('desk-mini-status');
const noteForm = byId('desk-mini-note-form');
const noteInput = byId('desk-mini-note');
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const localNotes = new Map();
const attempts = new Map();
let token = getStoredToken();
let selected = dateKey(new Date());
let month = selected.slice(0, 7);
let overview = {};
let reading;
let saving = false;

function request(path, options = {}) {
  return deskRequest(deskEndpoint, path, { session: token, ...options });
}

function renderCalendar(focusDay) {
  const first = toDate(month + '-01');
  const year = first.getFullYear();
  const index = first.getMonth();
  const pad = (first.getDay() + 6) % 7;
  const count = new Date(year, index + 1, 0, 12).getDate();
  const now = dateKey(new Date());
  const cells = [];
  for (let blank = 0; blank < pad; blank++) {
    const space = document.createElement('span');
    space.setAttribute('aria-hidden', 'true');
    cells.push(space);
  }
  for (let number = 1; number <= count; number++) {
    const day = month + '-' + String(number).padStart(2, '0');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.date = day;
    button.setAttribute('aria-label', dateFormat.format(toDate(day)));
    button.setAttribute('aria-pressed', String(selected === day));
    if (day === now) button.setAttribute('aria-current', 'date');
    if (overview[day]?.notes) button.dataset.hasNote = '';
    button.textContent = number;
    cells.push(button);
  }
  calendar.replaceChildren(...cells);
  if (focusDay) calendar.querySelector('[data-date="' + focusDay + '"]')?.focus();
  byId('desk-month').textContent = monthFormat.format(first);
  noteDate.dateTime = selected;
  noteDate.textContent = dateFormat.format(toDate(selected));
}

function renderNotes(entries) {
  notes.replaceChildren(...entries.filter(entry => entry.kind === 'note').reverse().map(entry => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = entry.created_at;
    time.textContent = clock.format(new Date(entry.created_at));
    const body = document.createElement('p');
    body.textContent = entry.body;
    item.append(time, body);
    return item;
  }));
}

function showSession() {
  login.hidden = Boolean(token);
  privateNotes.hidden = !token;
  if (!token) renderNotes([]);
}

function expire() {
  if (getStoredToken() === token) remember('');
  token = '';
  localNotes.clear();
  attempts.clear();
  overview = {};
  noteInput.value = '';
  showSession();
  renderCalendar();
  status.textContent = '登录已过期，请重新登录。';
}

async function refresh() {
  if (!token) return;
  reading?.abort();
  const controller = new AbortController();
  reading = controller;
  const session = token;
  const timeout = setTimeout(() => controller.abort('timeout'), 12000);
  status.textContent = '正在同步…';
  try {
    const day = await request('/day?' + new URLSearchParams({ day: selected, month, overview: '1' }), { signal: controller.signal });
    if (reading !== controller || token !== session) return;
    overview = day.days || {};
    renderNotes(day.entries || []);
    renderCalendar(calendar.contains(document.activeElement) ? document.activeElement.dataset.date : undefined);
    status.textContent = notes.childElementCount ? '已同步' : '当天还没有随手记。';
  } catch (error) {
    if (reading !== controller || token !== session) return;
    if (error.status === 401) expire();
    else if (!controller.signal.aborted || controller.signal.reason === 'timeout') status.textContent = error.message;
  } finally {
    clearTimeout(timeout);
    if (reading === controller) reading = undefined;
  }
}

function select(day, focus = false) {
  if (saving || selected === day) return;
  if (noteInput.value.trim()) localNotes.set(selected, noteInput.value);
  else localNotes.delete(selected);
  selected = day;
  if (!day.startsWith(month)) overview = {};
  month = day.slice(0, 7);
  noteInput.value = localNotes.get(day) || '';
  renderNotes([]);
  renderCalendar(focus ? day : undefined);
  void refresh();
}

function changeMonth(offset) {
  const first = toDate(month + '-01');
  first.setMonth(first.getMonth() + offset);
  if (first.getFullYear() < 1000 || first.getFullYear() > 9999) return;
  const firstKey = dateKey(first);
  const today = dateKey(new Date());
  select(today.startsWith(firstKey.slice(0, 7)) ? today : firstKey);
}

byId('desk-prev-month').addEventListener('click', () => changeMonth(-1));
byId('desk-next-month').addEventListener('click', () => changeMonth(1));
byId('desk-today').addEventListener('click', () => select(dateKey(new Date())));
calendar.addEventListener('click', event => {
  const day = event.target.closest('[data-date]')?.dataset.date;
  if (day) select(day, true);
});
login.addEventListener('submit', async event => {
  event.preventDefault();
  const password = key.value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(password)) {
    status.textContent = '请输入完整的站主密钥。';
    return;
  }
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    const result = await request('/session', { method: 'POST', data: { key: password }, session: '' });
    key.value = '';
    token = result.token;
    remember(token);
    showSession();
    await refresh();
    if (token) noteInput.focus();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
noteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = noteInput.value.trim();
  if (!token || saving || !body) return;
  const day = selected;
  const previous = attempts.get(day);
  const id = previous?.body === body ? previous.id : crypto.randomUUID();
  attempts.set(day, { body, id });
  saving = true;
  const button = noteForm.querySelector('button');
  button.disabled = noteInput.readOnly = true;
  status.textContent = '正在保存…';
  const session = token;
  try {
    await request('/entries', { method: 'POST', data: { id, day, kind: 'note', body } });
    if (session !== token) return;
    attempts.delete(day);
    localNotes.delete(day);
    noteInput.value = '';
    await refresh();
  } catch (error) {
    if (session !== token) return;
    if (error.status === 401) expire();
    else status.textContent = error.message;
  } finally {
    saving = false;
    button.disabled = noteInput.readOnly = false;
  }
});
window.addEventListener('storage', event => {
  if (event.key !== tokenKey) return;
  reading?.abort();
  reading = undefined;
  token = getStoredToken();
  overview = {};
  noteInput.value = '';
  localNotes.clear();
  attempts.clear();
  renderNotes([]);
  renderCalendar();
  showSession();
  if (token) void refresh();
  else status.textContent = '登录后可查看和记录。';
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !saving) void refresh();
});
showSession();
renderCalendar();
if (token) void refresh();
else status.textContent = '登录后可查看和记录。';
