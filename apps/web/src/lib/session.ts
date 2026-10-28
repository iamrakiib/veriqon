export type Account = { id: string; email: string; name: string; role: string };
let refreshing: Promise<boolean> | null = null;
export async function sessionFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-Veriqon-Request', '1');
  const send = () => fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const response = await send();
  if (response.status !== 401 || ['/login', '/register', '/refresh', '/logout'].some(path => url.endsWith(path))) return response;
  if (!refreshing) {
    const renew = () => fetch('/api/auth/refresh', { method: 'POST', headers: { 'X-Veriqon-Request': '1' }, credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(r => r.ok);
    // Cookies are shared across tabs. Serialize rotation so a second tab uses the renewed cookie.
    const rotate = async () => navigator.locks ? await navigator.locks.request('veriqon-refresh', { signal: AbortSignal.timeout(20000) }, renew) : await renew();
    refreshing = rotate().catch(() => false).finally(() => { refreshing = null; });
  }
  if (await refreshing) {
    const retried = await send();
    if (retried.status === 401) window.dispatchEvent(new Event('veriqon:session-expired'));
    return retried;
  }
  window.dispatchEvent(new Event('veriqon:session-expired'));
  return response;
}
export async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await sessionFetch(`/api/auth/${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join('. ') : data?.message || 'Could not connect. Please try again.');
  return data as T;
}
