const TOKEN_KEY = 'easyme.token';
const USER_KEY = 'easyme.user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function canPerform(action) {
  const role = getUser()?.role;
  const permissions = {
    ap_clerk: ['approve', 'query'],
    ap_manager: ['approve', 'approve_override', 'reject', 'hold'],
    finance_approver: ['approve', 'approve_override', 'post', 'reject', 'hold'],
    admin: ['approve', 'approve_override', 'post', 'reject', 'hold', 'query']
  };
  return Boolean(role && (permissions[role] || []).includes(action));
}

export async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent('easyme:unauthorized'));
  }
  return response;
}
