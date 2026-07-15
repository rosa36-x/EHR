// Real backend API client for MedVault.
//
// New, additive file — nothing in the existing route files imports this yet.
// Once you're ready to wire a screen up for real, replace its mock
// `setSession(...)` / `mockRecords` usage with calls from here.
//
// Set VITE_API_BASE_URL in a .env file at the project root, e.g.:
//   VITE_API_BASE_URL=http://localhost:5000
// Defaults to http://localhost:5000 if unset (the backend's default PORT).

import { getAuthToken } from "./auth-token";

const BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:5000";

// ── Core request helpers ────────────────────────────────────────────────────

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

function post<T = any>(path: string, body?: unknown) {
  return request<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

function get<T = any>(path: string) {
  return request<T>(path, { method: "GET" });
}

function patch<T = any>(path: string, body?: unknown) {
  return request<T>(path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Multipart helper for the file-upload endpoints (consultations,
// prescriptions, lab reports, referrals all take `file` + form fields).
function postForm<T = any>(
  path: string,
  fields: Record<string, string>,
  file: File,
  method: "POST" | "PUT" = "POST",
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file);
  return request<T>(path, { method, body: form });
}

// Simple client-side ID generator matching the backend's prefix convention
// (see chaincode/models + backend/services/idService.js). The backend does
// not currently re-derive these server-side for the multipart/consent
// routes — it trusts the ID the client sends — so this is a real generator,
// not a placeholder. Collisions are astronomically unlikely but if you later
// see DUPLICATE-style errors, this is the first place to look.
function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now().toString(36).toUpperCase()}${rand}`;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export const authApi = {
  doctorLoginPassword: (phone: string, password: string) =>
    post<{ status: string; token: string; doctorID: string }>(
      "/auth/doctor/login",
      { phone, password },
    ),

  doctorOtpInitiate: (phone: string) =>
    post<{ status: string }>("/auth/doctor/otp/initiate", { phone }),

  doctorOtpVerify: (phone: string, otp: string) =>
    post<{ status: string; token: string; doctorID: string }>(
      "/auth/doctor/otp/verify",
      { phone, otp },
    ),

  patientOtpInitiate: (phone: string) =>
    post<{ status: string }>("/auth/patient/otp/initiate", { phone }),

  patientOtpVerify: (phone: string, otp: string) =>
    post<{ status: string; token: string; patientID: string }>(
      "/auth/patient/otp/verify",
      { phone, otp },
    ),

  // Two-step Aadhaar registration flow — separate from login, uses /patients.
  patientInitiateRegistration: (aadhaarNumber: string, dob: string) =>
    post<{ status: string; transactionID: string }>(
      "/patients/initiate-registration",
      { aadhaarNumber, dob },
    ),

  patientCompleteRegistration: (data: {
    transactionID: string;
    otp: string;
    fullName: string;
    dob: string;
    gender: string;
    phone: string;
    email: string;
  }) =>
    post<{ status: string; token: string; patient: { patientID: string; fullName: string } }>(
      "/patients/complete-registration",
      data,
    ),

  orgActorRegister: (data: {
    fullName: string;
    org: "PharmacyMSP" | "LaboratoryMSP" | "GovernanceMSP";
    phone: string;
    email: string;
    password: string;
  }) => post<{ status: string; actorID: string }>("/auth/org-actor/register", data),

  orgActorLogin: (phone: string, password: string) =>
    post<{ status: string; token: string; actorID: string; org: string }>(
      "/auth/org-actor/login",
      { phone, password },
    ),

  doctorRegister: (data: Record<string, string>) =>
    post<{ status: string; doctorID: string }>("/doctors/register", data),
};

// ── Patients / Doctors ──────────────────────────────────────────────────

export interface PatientRecord {
  patientID: string;
  fullName: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
}

export interface PatientRecord {
  patientID: string; fullName: string; dob: string; gender: string; phone: string; email: string;
}
export const patientApi = {
  get: (patientID: string) => get<{ status: string; data: PatientRecord }>(`/patients/${patientID}`),
};


export const doctorApi = {
  get: (doctorID: string) => get(`/doctors/${doctorID}`),
  byHospital: (hospitalID: string) => get(`/doctors/hospital/${hospitalID}`),
};

// ── Consultations / Prescriptions / Lab Reports / Referrals ────────────────
// All four share the same shape: multipart create, GET metadata, GET document.

export const consultationApi = {
  create: (
    fields: {
      patientID: string;
      doctorID: string;
      diagnosis: string;
      recordType: string;
    },
    file: File,
  ) =>
    postForm(
      "/consultations",
      { consultationID: genId("CONS"), ...fields },
      file,
    ),
  get: (id: string) => get(`/consultations/${id}`),
  document: (id: string) => get(`/consultations/${id}/document`),
  update: (id: string, fields: Record<string, string>, file: File) =>
    postForm(`/consultations/${id}`, fields, file, "PUT"),
};

export const prescriptionApi = {
  create: (
    fields: { patientID: string; doctorID: string; recordType: string },
    file: File,
  ) =>
    postForm(
      "/prescriptions",
      { prescriptionID: genId("PRE"), ...fields },
      file,
    ),
  get: (id: string, org: "hospital" | "pharmacy" = "hospital") =>
    get(`/prescriptions/${id}?org=${org}`),
  document: (id: string, org: "hospital" | "pharmacy" = "hospital") =>
    get(`/prescriptions/${id}/document?org=${org}`),
  updateStatus: (
    id: string,
    status: "ISSUED" | "DISPENSED" | "CANCELLED",
    org: "hospital" | "pharmacy" = "pharmacy",
  ) => patch(`/prescriptions/${id}/status?org=${org}`, { status }),
};

export const labReportApi = {
  create: (
    fields: { patientID: string; labTechID: string; reportType: string },
    file: File,
  ) =>
    postForm("/labreports", { reportID: genId("LAB"), ...fields }, file),
  get: (id: string, org: "laboratory" | "hospital" = "laboratory") =>
    get(`/labreports/${id}?org=${org}`),
  document: (id: string, org: "laboratory" | "hospital" = "laboratory") =>
    get(`/labreports/${id}/document?org=${org}`),
};

export const referralApi = {
  create: (
    fields: {
      patientID: string;
      fromDoctorID: string;
      toDoctorID: string;
      referralReason: string;
      referralType?: string;
    },
    file: File,
  ) =>
    postForm("/referrals", { referralID: genId("REF"), ...fields }, file),
  get: (id: string) => get(`/referrals/${id}`),
  document: (id: string) => get(`/referrals/${id}/document`),
};

// ── Consent ──────────────────────────────────────────────────────────────

export const consentApi = {
  grant: (data: {
    patientID: string;
    granteeOrg: string; // e.g. "PharmacyMSP"
    resourceType: string;
    permission: string;
    expiryDate?: string;
  }) => post("/consents", { consentID: genId("CON"), ...data }),
  get: (id: string) => get(`/consents/${id}`),
  check: (id: string) => get(`/consents/${id}/check`),
  revoke: (id: string) => patch(`/consents/${id}/revoke`),
};

// ── Permission Requests (sensitive-record access) ───────────────────────

export const permissionRequestApi = {
  create: (data: {
    patientID: string;
    resourceType: string;
    resourceID: string;
    reason: string;
  }) => post("/permission-requests", data),
  get: (id: string) => get(`/permission-requests/${id}`),
  approve: (id: string) => patch(`/permission-requests/${id}/approve`),
  reject: (id: string) => patch(`/permission-requests/${id}/reject`),
};

// ── Treatment Relationships ─────────────────────────────────────────────

export const treatmentRelationshipApi = {
  create: (data: {
    patientID: string;
    relationshipType: string;
    notes?: string;
  }) => post("/treatment-relationships", data),
  get: (id: string) => get(`/treatment-relationships/${id}`),
  discharge: (id: string) => patch(`/treatment-relationships/${id}/discharge`),
  markDormant: (id: string) => patch(`/treatment-relationships/${id}/dormant`),
  reactivate: (id: string) => patch(`/treatment-relationships/${id}/reactivate`),
};

// ── Emergency Access ─────────────────────────────────────────────────────

export const emergencyApi = {
  create: (data: { patientID: string; reason: string; doctorID: string }) =>
    post("/emergency-access", { emergencyAccessID: genId("EA"), ...data }),
  get: (id: string) => get(`/emergency-access/${id}`),
  close: (id: string) => patch(`/emergency-access/${id}/close`),
};
export const biometricApi = {
  resolve: (fingerprintTemplate: string) =>
    post<{ status: string; patientID: string; fullName: string }>(
      "/patients/resolve-biometric",
      { fingerprintTemplate },
    ),
};
// ── Audit ────────────────────────────────────────────────────────────────

export const auditApi = {
  get: (id: string) => get(`/audits/${id}`),
  history: (auditID: string) => get(`/audit-history/${auditID}`),
};

// ── IPFS documents ───────────────────────────────────────────────────────

export const ipfsApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request("/ipfs/upload", { method: "POST", body: form });
  },
  download: (cid: string) => get(`/ipfs/download/${cid}`),
};

export { ApiError };
