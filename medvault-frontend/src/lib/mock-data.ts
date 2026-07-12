export type Sensitivity = "NORMAL" | "SENSITIVE";
export type RecordType =
  | "CONSULTATION"
  | "PRESCRIPTION"
  | "LAB_REPORT"
  | "REFERRAL";

export interface HealthRecord {
  id: string;
  type: RecordType;
  title: string;
  date: string;
  authorName: string;
  authorRole: "Doctor" | "Lab-tech";
  sensitivity: Sensitivity;
  category: string; // e.g. "Cardiology", "Psychiatry"
  summary: string;
}

export const mockRecords: HealthRecord[] = [
  {
    id: "REC-1001",
    type: "CONSULTATION",
    title: "Cardiology follow-up",
    date: "2026-06-14",
    authorName: "Dr. Anjali Rao",
    authorRole: "Doctor",
    sensitivity: "NORMAL",
    category: "Cardiology",
    summary: "Stable BP, continue current regimen.",
  },
  {
    id: "REC-1002",
    type: "PRESCRIPTION",
    title: "Amlodipine 5mg",
    date: "2026-06-14",
    authorName: "Dr. Anjali Rao",
    authorRole: "Doctor",
    sensitivity: "NORMAL",
    category: "Cardiology",
    summary: "Once daily, 30-day supply.",
  },
  {
    id: "REC-1003",
    type: "LAB_REPORT",
    title: "Lipid panel",
    date: "2026-06-10",
    authorName: "Ravi Kumar",
    authorRole: "Lab-tech",
    sensitivity: "NORMAL",
    category: "Pathology",
    summary: "LDL 118 mg/dL, HDL 52 mg/dL.",
  },
  {
    id: "REC-1004",
    type: "CONSULTATION",
    title: "Psychiatry review",
    date: "2026-05-28",
    authorName: "Dr. Meera Iyer",
    authorRole: "Doctor",
    sensitivity: "SENSITIVE",
    category: "Psychiatry",
    summary: "Sensitive record — access is patient-gated.",
  },
  {
    id: "REC-1005",
    type: "LAB_REPORT",
    title: "HIV screening",
    date: "2026-04-11",
    authorName: "Sana Qureshi",
    authorRole: "Lab-tech",
    sensitivity: "SENSITIVE",
    category: "Serology",
    summary: "Sensitive record — access is patient-gated.",
  },
  {
    id: "REC-1006",
    type: "REFERRAL",
    title: "Referral to Endocrinology",
    date: "2026-06-01",
    authorName: "Dr. Anjali Rao",
    authorRole: "Doctor",
    sensitivity: "NORMAL",
    category: "Referral",
    summary: "For evaluation of thyroid nodule.",
  },
];

export interface PermissionRequest {
  id: string;
  doctorName: string;
  hospital: string;
  resourceType: RecordType;
  resourceTitle: string;
  reason: string;
  requestedAt: string;
  expiresInHours: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  windowHoursRemaining?: number;
}

export const mockPermissionRequests: PermissionRequest[] = [
  {
    id: "PR-201",
    doctorName: "Dr. Vikram Shah",
    hospital: "Apollo Bengaluru",
    resourceType: "CONSULTATION",
    resourceTitle: "Psychiatry review — 2026-05-28",
    reason: "Continuity of care for anxiety follow-up.",
    requestedAt: "2026-07-09T14:20:00Z",
    expiresInHours: 18,
    status: "PENDING",
  },
  {
    id: "PR-202",
    doctorName: "Dr. Priya Menon",
    hospital: "Fortis Chennai",
    resourceType: "LAB_REPORT",
    resourceTitle: "HIV screening — 2026-04-11",
    reason: "Pre-surgical workup.",
    requestedAt: "2026-07-08T09:00:00Z",
    expiresInHours: 5,
    status: "PENDING",
  },
];

export interface Consent {
  id: string;
  org: "Pharmacy" | "Laboratory";
  resourceType: RecordType;
  resourceTitle: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresOn: string;
}

export const mockConsents: Consent[] = [
  {
    id: "CN-301",
    org: "Pharmacy",
    resourceType: "PRESCRIPTION",
    resourceTitle: "Amlodipine 5mg",
    status: "ACTIVE",
    expiresOn: "2026-07-14",
  },
  {
    id: "CN-302",
    org: "Laboratory",
    resourceType: "LAB_REPORT",
    resourceTitle: "Lipid panel",
    status: "ACTIVE",
    expiresOn: "2026-08-01",
  },
  {
    id: "CN-303",
    org: "Pharmacy",
    resourceType: "PRESCRIPTION",
    resourceTitle: "Metformin 500mg",
    status: "REVOKED",
    expiresOn: "2026-05-20",
  },
];

export interface TreatmentRelationship {
  id: string;
  doctorName: string;
  specialization: string;
  hospital: string;
  relationshipType:
    | "Ongoing Treatment"
    | "Follow-up"
    | "Referred By"
    | "Consultation";
  status: "Active" | "Dormant" | "Discharged";
  since: string;
}

export const mockRelationships: TreatmentRelationship[] = [
  {
    id: "TR-401",
    doctorName: "Dr. Anjali Rao",
    specialization: "Cardiology",
    hospital: "AIIMS Delhi",
    relationshipType: "Ongoing Treatment",
    status: "Active",
    since: "2025-11-02",
  },
  {
    id: "TR-402",
    doctorName: "Dr. Meera Iyer",
    specialization: "Psychiatry",
    hospital: "NIMHANS",
    relationshipType: "Follow-up",
    status: "Active",
    since: "2026-01-15",
  },
  {
    id: "TR-403",
    doctorName: "Dr. Rakesh Verma",
    specialization: "General Medicine",
    hospital: "Fortis Gurgaon",
    relationshipType: "Consultation",
    status: "Dormant",
    since: "2025-08-20",
  },
];

export interface AuditEntry {
  id: string;
  actor: string;
  actorRole: string;
  actorOrg: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
}

export const mockAudit: AuditEntry[] = [
  {
    id: "A-1",
    actor: "Priya Sharma",
    actorRole: "Patient",
    actorOrg: "Hospital",
    action: "APPROVED_PERMISSION",
    resourceType: "PermissionRequest",
    resourceId: "PR-198",
    timestamp: "2026-07-09T18:04:00Z",
  },
  {
    id: "A-2",
    actor: "Dr. Anjali Rao",
    actorRole: "Doctor",
    actorOrg: "Hospital",
    action: "READ_RECORD",
    resourceType: "CONSULTATION",
    resourceId: "REC-1001",
    timestamp: "2026-07-09T11:22:00Z",
  },
  {
    id: "A-3",
    actor: "Pharmacy Staff",
    actorRole: "Pharmacist",
    actorOrg: "Pharmacy",
    action: "DISPENSED_PRESCRIPTION",
    resourceType: "PRESCRIPTION",
    resourceId: "REC-1002",
    timestamp: "2026-07-08T16:12:00Z",
  },
  {
    id: "A-4",
    actor: "Sana Qureshi",
    actorRole: "Lab-tech",
    actorOrg: "Laboratory",
    action: "CREATED_LAB_REPORT",
    resourceType: "LAB_REPORT",
    resourceId: "REC-1005",
    timestamp: "2026-04-11T10:03:00Z",
  },
];

export interface PatientListItem {
  id: string;
  name: string;
  age: number;
  gender: "F" | "M" | "O";
  relationshipType: string;
  status: "Active" | "Dormant" | "Discharged";
}

export const mockPatients: PatientListItem[] = [
  {
    id: "PT-9001",
    name: "Priya Sharma",
    age: 42,
    gender: "F",
    relationshipType: "Ongoing Treatment",
    status: "Active",
  },
  {
    id: "PT-9002",
    name: "Rohan Gupta",
    age: 56,
    gender: "M",
    relationshipType: "Follow-up",
    status: "Active",
  },
  {
    id: "PT-9003",
    name: "Ananya Nair",
    age: 29,
    gender: "F",
    relationshipType: "Consultation",
    status: "Dormant",
  },
];

export const sensitiveCategories = [
  "Psychiatry",
  "HIV/STI",
  "Genetic",
  "Controlled substances",
  "Reproductive health",
  "Oncology",
  "Terminal illness",
  "Pediatric",
  "Disability",
];

export const normalRecordCategories = [
  "General Medicine",
  "Cardiology",
  "Orthopedics",
  "Dermatology",
  "ENT",
  "Ophthalmology",
];
