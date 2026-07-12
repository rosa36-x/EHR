// In-browser session for the MedVault frontend. Holds role/name/org for
// display and routing; the real JWT lives separately in auth-token.ts.
// `id` holds the real backend patientID/doctorID/actorID once wired to
// the live API — optional so pages that haven't been wired yet still work.

export type Role = "patient" | "doctor" | "org-actor";
export type Org = "Pharmacy" | "Laboratory" | "Governance" | "Research";

export interface Session {
  role: Role;
  name: string;
  phone?: string;
  email?: string;
  org?: Org; // only for org-actor
  id?: string; // real backend ID (patientID / doctorID / actorID) — needed for API calls
}

const KEY = "medvault.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session) {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  window.localStorage.removeItem(KEY);
}

export function dashboardPath(s: Session): string {
  if (s.role === "patient") return "/patient";
  if (s.role === "doctor") return "/doctor";
  return "/org";
}
