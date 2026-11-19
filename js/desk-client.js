export const tokenKey = 'reading-room:desk-session:v1';
export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const toDate = key => new Date(key + 'T12:00:00');

class DeskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getStoredToken() {
  try {
    return localStorage.getItem(tokenKey) || '';
  } catch {
    return '';
  }
}

export function remember(value) {
  try {
    if (value) localStorage.setItem(tokenKey, value);
    else localStorage.removeItem(tokenKey);
  } catch {
    // A browser that blocks storage can still use the active login.
  }
}

export async function deskRequest(endpoint, path, { method = 'GET', data, signal, session = '' } = {}) {
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
