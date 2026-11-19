import { deskEndpoint } from './desk-config.js?v=2';
import { dateKey, toDate, getStoredToken, remember, deskRequest } from './desk-client.js?v=1';

const get = id => document.getElementById(id);

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

function mountDesk(endpoint) {
  const login = get('desk-login');
  const keyInput = get('desk-key');
  const work = get('desk-workspace');
  const account = get('desk-account');
  const sheet = get('day-sheet');
  const calendar = get('calendar-days');
  const taskInput = get('task-input');
  const noteInput = get('note-input');
  const journalForm = get('journal-form');
  const journalKeys = ['title', 'weather', 'mood', 'events', 'reflection', 'goal_status', 'goal', 'exercise'];
  const records = get('daily-records');
  const drafts = new Map();
  const attempts = new Map();
  let selected = updateTodayLabel();
  let month = selected.slice(0, 7);
  let token = '';
  let pendingRead;
  let busy = false;
  let editing = null;
  let taskEditing = null;
  let journalDirty = false;
  let journalVersion = 0;
  let cloudJournal = null;
  let view = 'calendar';
  let entriesSignature = '';
  let calendarSignature = '';
  let days = {};

  function showMessage(text = '', message = get(sheet.open ? 'sheet-message' : 'desk-message')) {
    message.textContent = text;
    message.hidden = !text;
  }

  function request(path, options = {}) {
    return deskRequest(endpoint, path, { session: token, ...options });
  }

  function setEditing(record) {
    editing = record;
    get('note-cancel').hidden = !record;
    get('note-save').textContent = record ? '保存修改' : '保存';
  }

  function setTaskEditing(record) {
    taskEditing = record;
    get('task-cancel').hidden = !record;
    get('task-save').textContent = record ? '保存修改' : '添加';
  }

  function journalValues() {
    return Object.fromEntries(journalKeys.map(key => [key, journalForm.elements[key].value.trim()]));
  }

  function renderJournal(value) {
    cloudJournal = value;
    const version = value?.version || 0;
    get('use-cloud').hidden = !(journalDirty && version !== journalVersion);
    if (journalDirty) return;
    journalVersion = version;
    for (const name of journalKeys) journalForm.elements[name].value = value?.[name] || '';
  }

  function resetSession(text = '', clearStored = true) {
    pendingRead?.abort();
    pendingRead = undefined;
    token = '';
    if (clearStored) remember('');
    drafts.clear();
    attempts.clear();
    days = {};
    entriesSignature = '';
    calendarSignature = '';
    selected = updateTodayLabel();
    month = selected.slice(0, 7);
    taskInput.value = '';
    noteInput.value = '';
    setEditing(null);
    setTaskEditing(null);
    journalDirty = false;
    renderJournal(null);
    if (sheet.open) sheet.close();
    get('desk-tasks').replaceChildren();
    get('desk-notes').replaceChildren();
    get('task-count').textContent = '';
    get('desk-preview').hidden = false;
    account.hidden = true;
    work.hidden = true;
    showMessage(text);
    renderCalendar();
  }

  function renderCalendar() {
    const today = updateTodayLabel();
    const signature = JSON.stringify([month, selected, today, view, Boolean(token), days]);
    if (signature === calendarSignature) return;
    calendarSignature = signature;
    const focused = calendar.contains(document.activeElement) ? document.activeElement.dataset.day : '';
    const first = toDate(month + '-01');
    const year = first.getFullYear();
    const monthIndex = first.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const content = document.createDocumentFragment();
    get('month-label').textContent = monthDate.format(first);
    for (let empty = 0; empty < offset; empty++) {
      const blank = document.createElement('span');
      blank.setAttribute('aria-hidden', 'true');
      content.append(blank);
    }
    for (let number = 1; number <= daysInMonth; number++) {
      const day = month + '-' + String(number).padStart(2, '0');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.day = day;
      const dateLabel = document.createElement('span');
      dateLabel.className = 'calendar-number';
      dateLabel.textContent = number;
      button.append(dateLabel);
      button.setAttribute('aria-pressed', String(day === selected));
      if (day === today) button.setAttribute('aria-current', 'date');
      const record = days[day];
      if (record) {
        button.dataset.record = '';
        const items = record.title ? [{ body: record.title }, ...(record.preview || []).slice(0, 1)] : record.preview || [];
        if (!items.length) items.push({ body: record.reflection ? '反思' : '日常记录' });
        for (const item of items) {
          const preview = document.createElement('span');
          preview.className = 'calendar-preview';
          preview.textContent = item.body;
          if (item.done) preview.dataset.done = '';
          button.append(preview);
        }
      }
      button.setAttribute('aria-label', [longDate.format(toDate(day)), record?.title,
        record && `${record.tasks || 0} 件待办`].filter(Boolean).join('，'));
      content.append(button);
    }
    const trailing = (7 - (offset + daysInMonth) % 7) % 7;
    for (let blank = 0; blank < trailing; blank++) {
      const cell = document.createElement('span');
      cell.setAttribute('aria-hidden', 'true');
      content.append(cell);
    }
    calendar.replaceChildren(content);
    if (focused) calendar.querySelector(`[data-day="${focused}"]`)?.focus({ preventScroll: true });
    get('calendar-view').hidden = view !== 'calendar';
    records.hidden = view === 'calendar';
    records.dataset.view = view;
    if (!records.hidden) renderRecords();
  }

  function renderRecords() {
    const list = Object.entries(days).sort(([a], [b]) => b.localeCompare(a))
      .filter(([, record]) => view !== 'gallery' || record.reflection);
    const content = list.map(([day, record]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'daily-record';
      button.dataset.day = day;
      const time = document.createElement('time');
      time.dateTime = day;
      time.textContent = shortDate.format(toDate(day));
      const title = document.createElement('strong');
      title.textContent = record.title || (view === 'gallery' ? '反思' : '日常记录');
      const meta = document.createElement(view === 'gallery' ? 'span' : 'small');
      if (view === 'gallery') {
        meta.className = 'reflection-excerpt';
        meta.textContent = record.reflection;
      } else {
        meta.textContent = [record.mood, record.goal_status, record.tasks && `待办 ${record.done || 0}/${record.tasks}`,
          record.notes && `随手记 ${record.notes}`].filter(Boolean).join(' · ');
      }
      button.append(time, title, meta);
      return button;
    });
    if (!content.length) {
      const empty = document.createElement('p');
      empty.textContent = token ? (view === 'gallery' ? '这个月还没有反思。' : '这个月还没有记录。') : '登录后查看本月记录。';
      content.push(empty);
    }
    const focused = records.contains(document.activeElement) ? document.activeElement.dataset.day : '';
    records.replaceChildren(...content);
    if (focused) records.querySelector(`[data-day="${focused}"]`)?.focus({ preventScroll: true });
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
      if (taskEditing?.id === record.id) {
        setTaskEditing(null);
        taskInput.value = '';
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
    const edit = action('编辑', () => {
      setTaskEditing(record);
      taskInput.value = record.body;
      taskInput.focus();
    }, 'edit-' + record.id);
    const remove = action('删除', () => deleteRecord(record), 'remove-' + record.id);
    remove.setAttribute('aria-label', '删除待办：' + record.body);
    row.append(label, edit, remove);
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
      const result = await request('/day?' + new URLSearchParams({ day: selected, month, overview: '1' }), {
        session, signal: controller.signal,
      });
      if (pendingRead !== controller || session !== token) return;
      days = result.days || {};
      renderCalendar();
      renderEntries(result.entries);
      renderJournal(result.journal);
      get('desk-preview').hidden = true;
      work.hidden = false;
      account.hidden = false;
      get('desk-sync').textContent = '已同步';
    } catch (error) {
      if (pendingRead !== controller || session !== token) return;
      if (error.status === 401) resetSession('登录已过期，请重新登录。');
      else if (!controller.signal.aborted || controller.signal.reason === 'timeout') {
        get('desk-sync').textContent = '同步暂不可用';
        if (work.hidden) {
          showMessage('暂时连不上云端，页面会自动重试。');
        }
      }
    } finally {
      clearTimeout(timeout);
      if (pendingRead === controller) pendingRead = undefined;
    }
  }

  function select(day) {
    if (busy || day === selected) return;
    if (taskInput.value || noteInput.value || journalDirty) {
      drafts.set(selected, { task: taskInput.value, note: noteInput.value, editing, taskEditing,
        journal: journalDirty ? journalValues() : null, version: journalVersion });
    } else drafts.delete(selected);
    selected = day;
    const nextMonth = day.slice(0, 7);
    if (nextMonth !== month) days = {};
    month = nextMonth;
    const draft = drafts.get(selected);
    taskInput.value = draft?.task || '';
    noteInput.value = draft?.note || '';
    setEditing(draft?.editing || null);
    setTaskEditing(draft?.taskEditing || null);
    journalDirty = false;
    renderJournal(draft?.journal ? { ...draft.journal, version: draft.version } : null);
    journalDirty = Boolean(draft?.journal);
    get('desk-day-title').textContent = shortDate.format(toDate(day));
    get('desk-sync').textContent = '同步中…';
    renderCalendar();
    renderEntries([]);
    showMessage();
    if (token) work.hidden = true;
    void refresh();
  }

  function openDay(day) {
    if (busy) return;
    select(day);
    if (!token) {
      get('desk-preview').scrollIntoView({ block: 'nearest' });
      keyInput.focus();
      return;
    }
    get('desk-day-title').textContent = longDate.format(toDate(day));
    showMessage('', get('sheet-message'));
    if (!sheet.open) sheet.showModal();
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
    for (const control of journalForm.elements) control.disabled = value;
    get('desk-logout').disabled = value;
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
        showMessage(error.message, sheet.open ? get('sheet-message') : get('desk-message'));
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
  for (const root of [calendar, records]) root.addEventListener('click', event => {
    const day = event.target.closest('[data-day]')?.dataset.day;
    if (day) openDay(day);
  });
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const target of document.querySelectorAll('.daily-views button')) {
      target.setAttribute('aria-pressed', String(target === button));
    }
    renderCalendar();
  });
  get('previous-month').addEventListener('click', () => moveMonth(-1));
  get('next-month').addEventListener('click', () => moveMonth(1));
  get('go-today').addEventListener('click', () => select(updateTodayLabel()));
  get('new-day').addEventListener('click', () => openDay(selected));
  get('close-day').addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    if (token) (view === 'calendar' ? calendar : records)
      .querySelector(`[data-day="${selected}"]`)?.focus({ preventScroll: true });
  });
  sheet.addEventListener('click', event => {
    if (event.target === sheet && event.clientX < sheet.getBoundingClientRect().left) sheet.close();
  });
  get('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const body = taskInput.value.trim();
    if (!body) return;
    if (!taskEditing) create('task', body, taskInput);
    else void save('/entries/' + taskEditing.id, 'PATCH', { body, version: taskEditing.version }, () => {
      setTaskEditing(null);
      taskInput.value = '';
    });
  });
  get('task-cancel').addEventListener('click', () => {
    setTaskEditing(null);
    taskInput.value = '';
  });
  journalForm.addEventListener('input', () => { journalDirty = true; });
  journalForm.addEventListener('submit', event => {
    event.preventDefault();
    void save('/journal', 'PATCH', { day: selected, version: journalVersion, ...journalValues() }, () => {
      journalDirty = false;
      showMessage('日常记录已保存。');
    });
  });
  get('use-cloud').addEventListener('click', () => {
    if (!confirm('载入云端记录并放弃本次未保存的修改？')) return;
    journalDirty = false;
    renderJournal(cloudJournal);
    showMessage();
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
  renderCalendar();
}

if (deskEndpoint) mountDesk(deskEndpoint.replace(/\/$/, ''));
else get('desk-intro').textContent = '私人待办与随笔 · 云同步待启用';
