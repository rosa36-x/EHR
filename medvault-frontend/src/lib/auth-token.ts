// Real JWT storage for the live backend.
//
// This is intentionally separate from `src/lib/session.ts`, which is the
// existing mock/demo session used by the current UI (role + display name
// only, no real token). Keeping this in its own file means api.ts can be
// wired in without editing session.ts or anything that already imports it.
//
// Once the route files are wired to call the real API, `setSession(...)`
// calls in the auth forms should be paired with `setAuthToken(...)` here so
// subsequent api.ts calls are authenticated.

const TOKEN_KEY = "medvault_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}
