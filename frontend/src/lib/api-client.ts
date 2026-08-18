// Thin fetch wrapper shared by every TanStack Query hook. Keeps the
// access token in module scope (not React state) so plain functions
// (query hooks, the SSE hook) can read/attach it without needing to be
// inside a component; AuthProvider is the only thing that mutates it.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let logoutHandler: (() => void) | null = null;

// The access token expires roughly every JWT_ACCESS_TTL, so every request
// in flight at that moment (sites/alerts/summary/health all poll on their
// own timers) gets a 401 at once. Without this, each one called
// refreshHandler() independently, firing N concurrent POST /auth/refresh
// with the same cookie; the backend rotates on the first and revokes the
// token, so every other concurrent refresh failed and logged the user out
// — a spurious logout roughly every 15 minutes. Sharing one in-flight
// promise means concurrent 401s all await the same refresh instead of
// racing it.
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function registerAuthHandlers(handlers: {
  refresh: () => Promise<string | null>;
  logout: () => void;
}) {
  refreshHandler = handlers.refresh;
  logoutHandler = handlers.logout;
}

// Exported so the SSE hook can force a fresh token before reconnecting
// instead of retrying with the same expired one.
export function refreshOnce(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null);
  if (!refreshPromise) {
    refreshPromise = refreshHandler().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, allowRetry = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  // credentials: "include" so the HttpOnly refresh cookie is sent on the
  // auth routes. Authenticated API routes still rely on the Authorization
  // header, which is what keeps them immune to CSRF — a cross-site request
  // can carry the cookie but cannot set that header.
  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (res.status === 401 && allowRetry && refreshHandler) {
    const newToken = await refreshOnce();
    if (newToken) {
      return request<T>(path, options, false);
    }
    logoutHandler?.();
    throw new ApiError(401, "Session expired — please log in again");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204 || res.headers.get("Content-Length") === "0") {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export { API_URL };
