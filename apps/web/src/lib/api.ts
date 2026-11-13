/** Thin fetch wrapper for the Delegate API with typed errors. */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null> | string | null;
let userTokenGetter: TokenGetter = () => null;
let onUnauthorized: (error: ApiError) => void = () => {};

export function configureApi(opts: { getToken: TokenGetter; onUnauthorized: (error: ApiError) => void }) {
  userTokenGetter = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Explicit token (admin console). Defaults to the signed-in user's session. */
  token?: string | null;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : await userTokenGetter();
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(isForm || opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let code = 'error';
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
    } catch {
      /* non-JSON error */
    }
    const error = new ApiError(res.status, code, message);
    if (res.status === 401 && opts.token === undefined) onUnauthorized(error);
    throw error;
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T>(path: string, token?: string | null) => request<T>(path, { token }),
  post: <T>(path: string, body?: unknown, token?: string | null) => request<T>(path, { method: 'POST', body, token }),
  patch: <T>(path: string, body?: unknown, token?: string | null) => request<T>(path, { method: 'PATCH', body, token }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
