export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { 'x-aether': '1', 'x-tz-offset': String(new Date().getTimezoneOffset()) } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? (typeof data === 'string' && data ? data : res.statusText);
    if (res.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new CustomEvent('aether:signed-out'));
    if (res.status === 412 && path.startsWith('/api/github')) window.dispatchEvent(new CustomEvent('aether:github-reconnect'));
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  /** GitHub pass-through using the signed-in member's own token. */
  gh: <T>(path: string, method = 'GET', b?: unknown) => request<T>(method, `/api/github/api${path}`, b),
  async ghRaw(path: string): Promise<string> {
    const res = await fetch(`/api/github/api${path}`, { headers: { 'x-gh-accept': 'application/vnd.github.raw+json', 'x-aether': '1' } });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.text();
  },
  async upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ id: string; name: string; mime: string; size: number }>('POST', '/api/files', fd);
  },
};
