import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  FileText,
  KeyRound,
  ShieldCheck,
  Sparkles,
  User,
  UserRound,
  XCircle,
  Download,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/shared/dashboard-shell";
import { DocumentCard } from "@/components/shared/document-card";
import { StatusPill } from "@/components/shared/status-pill";
import { SensitivityBadge } from "@/components/shared/sensitivity-badge";
import { AuditTimeline } from "@/components/shared/audit-timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getSession } from "@/lib/session";
import { patientApi, consentApi, permissionRequestApi, ApiError, type PatientRecord,auditApi,consultationApi, prescriptionApi, labReportApi,treatmentRelationshipApi } from "@/lib/api";
import {
  mockAudit,
  mockConsents,
  mockPermissionRequests,
  mockRecords,
  mockRelationships,
  type RecordType,
  type PermissionRequest,
  type Consent,
} from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/patient")({
  head: () => ({
    meta: [{ title: "Patient portal — MedVault" }],
  }),
  component: PatientDashboard,
});

const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: <Sparkles className="h-4 w-4" /> },
  { id: "profile", label: "My profile", icon: <User className="h-4 w-4" /> },
  { id: "records", label: "My records", icon: <FileText className="h-4 w-4" /> },
  {
    id: "permissions",
    label: "Permission requests",
    icon: <KeyRound className="h-4 w-4" />,
  },
  {
    id: "consents",
    label: "Consents",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    id: "relationships",
    label: "Care team",
    icon: <UserRound className="h-4 w-4" />,
  },
  { id: "audit", label: "Audit history", icon: <Activity className="h-4 w-4" /> },
];

function PatientDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [session, setSess] = useState<ReturnType<typeof getSession>>(null);
  const [profile, setProfile] = useState<PatientRecord | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || s.role !== "patient") {
      navigate({ to: "/auth/patient" });
      return;
    }
    setSess(s);
    if (s.id) {
      patientApi
        .get(s.id)
        .then((res) => {
          if (res.status === "SUCCESS") setProfile(res.data);
        })
        .catch(() => {
          // profile fetch failing shouldn't block the rest of the dashboard;
          // header/profile sections just fall back to session values below
        });
    }
  }, [navigate]);

  const [permissions, setPermissions] = useState(mockPermissionRequests);
  const [consents, setConsents] = useState(mockConsents);

  if (!session) return null;

  const displayName = profile?.fullName ?? session.name;

  return (
    <DashboardShell
      roleLabel="Patient"
      userName={displayName}
      navItems={NAV}
      activeId={tab}
      onNavigate={setTab}
    >
      {tab === "overview" && (
        <Overview
          name={displayName}
          permissions={permissions}
          consents={consents}
          onGoto={setTab}
        />
      )}
      {tab === "profile" && <Profile session={session} profile={profile} />}
      {tab === "records" && <Records patientID={session.id!} />}
      {tab === "permissions" && (
        <Permissions items={permissions} setItems={setPermissions} />
      )}
      {tab === "consents" && (
        <Consents items={consents} setItems={setConsents} patientID={session.id!} />
      )}
      {tab === "relationships" && <Relationships />}
      {tab === "audit" && <AuditView />}
    </DashboardShell>
  );
}

function Overview({
  name,
  permissions,
  consents,
  onGoto,
}: {
  name: string;
  permissions: PermissionRequest[];
  consents: Consent[];
  onGoto: (id: string) => void;
}) {
  const pending = permissions.filter((p) => p.status === "PENDING").length;
  const activeConsents = consents.filter((c) => c.status === "ACTIVE").length;
  return (
    <div className="space-y-6">
      <header className="rounded-xl border bg-gradient-to-br from-primary/10 via-surface to-surface p-6">
        <div className="text-sm text-muted-foreground">Welcome back,</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {name}
        </h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Your records are private by default. You control who can see them and
          for how long.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <QuickStat
          label="Active care relationships"
          value="2"
          onClick={() => onGoto("relationships")}
        />
        <QuickStat
          label="Pending permission requests"
          value={String(pending)}
          tone="warn"
          onClick={() => onGoto("permissions")}
        />
        <QuickStat
          label="Active consents granted"
          value={String(activeConsents)}
          onClick={() => onGoto("consents")}
        />
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "warn";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border bg-card p-5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-semibold ${
          tone === "warn" ? "text-warn-foreground" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </button>
  );
}

function Profile({
  session,
  profile,
}: {
  session: NonNullable<ReturnType<typeof getSession>>;
  profile: PatientRecord | null;
}) {
  const fields = [
    { label: "Name", value: profile?.fullName ?? "Loading…" },
    { label: "Date of birth", value: profile?.dob ?? "Loading…" },
    { label: "Gender", value: profile?.gender ?? "Loading…" },
    { label: "Phone", value: profile?.phone ?? session.phone ?? "Loading…" },
    { label: "Email", value: profile?.email ?? "Loading…" },
  ];
  return (
    <div className="space-y-4">
      <SectionHeader
        title="My profile"
        subtitle="Read-only view of your ledger identity."
      />
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {f.label}
              </div>
              <div className="mt-1 text-sm text-foreground">{f.value}</div>
            </div>
          ))}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Identity
            </div>
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-success/15 px-2 py-1 text-xs text-success-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aadhaar verified
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Records({ patientID }: { patientID: string }) {
  const [filter, setFilter] = useState<"ALL" | "CONSULTATION" | "PRESCRIPTION" | "LAB_REPORT">("ALL");
  const [consultations, setConsultations] = useState<any[]>([]);
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [labReports, setLabReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      consultationApi.list(patientID),
      prescriptionApi.list(patientID),
      labReportApi.list(patientID),
    ]).then(([c, p, l]) => {
      if (c.status === "fulfilled") setConsultations((c.value as any).data ?? []);
      if (p.status === "fulfilled") setPrescriptions((p.value as any).data ?? []);
      if (l.status === "fulfilled") setLabReports((l.value as any).data ?? []);
      setLoading(false);
    });
  }, [patientID]);

  const tabs = [
    { id: "ALL", label: "All" },
    { id: "CONSULTATION", label: "Consultations" },
    { id: "PRESCRIPTION", label: "Prescriptions" },
    { id: "LAB_REPORT", label: "Lab reports" },
  ] as const;

  const rows: { id: string; kind: string; title: string; sensitive: boolean; date: string; download: () => Promise<void> }[] = [
    ...consultations.map((c) => ({
      id: c.consultationID, kind: "CONSULTATION", title: c.recordType, sensitive: c.sensitivityLevel === "SENSITIVE",
      date: c.createdAt, download: () => consultationApi.document(c.consultationID),
    })),
    ...prescriptions.map((p) => ({
      id: p.prescriptionID, kind: "PRESCRIPTION", title: p.recordType, sensitive: p.sensitivityLevel === "SENSITIVE",
      date: p.createdAt, download: () => prescriptionApi.document(p.prescriptionID),
    })),
    ...labReports.map((l) => ({
      id: l.reportID, kind: "LAB_REPORT", title: l.reportType, sensitive: l.sensitivityLevel === "SENSITIVE",
      date: l.createdAt, download: () => labReportApi.document(l.reportID),
    })),
  ].filter((r) => filter === "ALL" || r.kind === filter);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="My records"
        subtitle="All documents created about you across the network."
      />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {!loading && rows.length === 0 && <EmptyState label="No records found." />}
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{r.title}</div>
                  {r.sensitive && <SensitivityBadge />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.kind.replace("_", " ")} · {new Date(r.date).toLocaleDateString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => r.download().catch((err) =>
                  toast.error(err instanceof ApiError ? err.message : "Couldn't download document")
                )}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Permissions({
  items,
  setItems,
}: {
  items: PermissionRequest[];
  setItems: (i: PermissionRequest[]) => void;
}) {
  const update = (id: string, patch: Partial<PermissionRequest>) => {
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const [lookupID, setLookupID] = useState("");
  const [realIDs, setRealIDs] = useState<Set<string>>(new Set());

  const lookup = async () => {
    if (!lookupID) return;
    try {
      const res: any = await permissionRequestApi.get(lookupID);
      const d = res.data;
      setItems([
        {
          id: d.requestID,
          doctorName: d.doctorID,
          hospital: "",
          resourceType: d.resourceType,
          resourceTitle: d.resourceID,
          reason: d.reason,
          status: d.status,
          expiresInHours: 24,
          requestedAt: d.createdAt,
        },
        ...items.filter((i) => i.id !== d.requestID),
      ]);
      setRealIDs((s) => new Set(s).add(d.requestID));
      toast.success("Request loaded");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Request not found");
    }
  };
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Permission requests"
        subtitle="Doctors requesting access to your sensitive records. Approvals grant a 48-hour window."
      />
      <div className="flex gap-2">
        <Input
          placeholder="Look up request by ID (e.g. PREQ0003)"
          value={lookupID}
          onChange={(e) => setLookupID(e.target.value)}
        />
        <Button onClick={lookup}>Load</Button>
      </div>
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {p.doctorName}
                  </div>
                  <SensitivityBadge />
                  <StatusPill status={p.status} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.hospital} · asking for {p.resourceType.replace("_", " ").toLowerCase()}
                </div>
                <div className="mt-3 text-sm text-foreground">
                  <span className="font-medium">Resource:</span> {p.resourceTitle}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Reason:</span>{" "}
                  {p.reason}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Expires in {p.expiresInHours}h
                </div>
                {p.status === "APPROVED" && p.windowHoursRemaining != null && (
                  <div className="mt-1 text-success-foreground">
                    Access window: {p.windowHoursRemaining}h left
                  </div>
                )}
              </div>
            </div>
            {p.status === "PENDING" && (
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (realIDs.has(p.id)) {
                      try {
                        await permissionRequestApi.reject(p.id);
                        update(p.id, { status: "REJECTED" });
                        toast.info("Request rejected");
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : "Couldn't reject");
                      }
                    } else {
                      update(p.id, { status: "REJECTED" });
                      toast.info("Request rejected");
                    }
                  }}
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (realIDs.has(p.id)) {
                      try {
                        await permissionRequestApi.approve(p.id);
                        update(p.id, { status: "APPROVED", windowHoursRemaining: 48 });
                        toast.success("Access granted for 48 hours");
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : "Couldn't approve");
                      }
                    } else {
                      update(p.id, {
                        status: "APPROVED",
                        windowHoursRemaining: 48,
                      });
                      toast.success("Access granted for 48 hours");
                    }
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </Button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <EmptyState label="No permission requests." />}
      </div>
    </div>
  );
}

function Consents({
  items,
  setItems,
  patientID,
}: {
  items: Consent[];
  setItems: (i: Consent[]) => void;
  patientID: string;
}) {
  const [open, setOpen] = useState(false);
  const [newOrg, setNewOrg] = useState<"Pharmacy" | "Laboratory">("Pharmacy");
  const [newType, setNewType] = useState<RecordType>("PRESCRIPTION");
  const [expiry, setExpiry] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Consents"
          subtitle="Give a partner org time-bound access to a resource type."
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Grant new consent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Grant consent</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!expiry) {
                  toast.error("Choose an expiry date");
                  return;
                }
                setLoading(true);
                try {
                  const res: any = await consentApi.grant({
                    patientID,
                    granteeOrg: newOrg === "Pharmacy" ? "PharmacyMSP" : "LaboratoryMSP",
                    resourceType: newType,
                    permission: "READ",
                    expiryDate: expiry,
                  });
                  setItems([
                    {
                      id: res.consentID ?? res.data?.consentID,
                      org: newOrg,
                      resourceType: newType,
                      resourceTitle: `${newType.replace("_", " ")} access`,
                      status: "ACTIVE",
                      expiresOn: expiry,
                    },
                    ...items,
                  ]);
                  setOpen(false);
                  toast.success("Consent granted");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Couldn't grant consent");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select
                  value={newOrg}
                  onValueChange={(v) => setNewOrg(v as "Pharmacy" | "Laboratory")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pharmacy">Pharmacy</SelectItem>
                    <SelectItem value="Laboratory">Laboratory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Resource type</Label>
                <Select value={newType} onValueChange={(v) => setNewType(v as RecordType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRESCRIPTION">Prescription</SelectItem>
                    <SelectItem value="LAB_REPORT">Lab report</SelectItem>
                    <SelectItem value="CONSULTATION">Consultation</SelectItem>
                    <SelectItem value="REFERRAL">Referral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Expires on</Label>
                <Input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Granting…" : "Grant consent"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-3">
        {items.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {c.org}
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {c.resourceType.replace("_", " ").toLowerCase()} · {c.resourceTitle}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Expires {c.expiresOn}
              </div>
            </div>
            {c.status === "ACTIVE" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke consent?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {c.org} will lose access to this resource immediately.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        try {
                          await consentApi.revoke(c.id);
                          setItems(
                            items.map((i) =>
                              i.id === c.id ? { ...i, status: "REVOKED" } : i,
                            ),
                          );
                          toast.success("Consent revoked");
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : "Couldn't revoke consent");
                        }
                      }}
                    >
                      Revoke
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Relationships() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    treatmentRelationshipApi.list().then((res: any) => {
      setItems(res.data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Care team"
        subtitle="Clinicians currently authorized in a treatment relationship with you."
      />
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="space-y-3">
        {!loading && items.length === 0 && <EmptyState label="No care team members yet." />}
        {items.map((r) => (
          <div
            key={r.relationshipID}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {r.doctorID}
                </div>
                <StatusPill status={r.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.relationshipType.replace(/_/g, " ")} · since {new Date(r.createdAt).toLocaleDateString()}
              </div>
              {r.notes && <div className="mt-1 text-xs text-muted-foreground">{r.notes}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditView() {
  const [lookupID, setLookupID] = useState("");
  const [entries, setEntries] = useState(mockAudit);

  const lookup = async () => {
    if (!lookupID) return;
    try {
      const res: any = await auditApi.history(lookupID);
      const d = res.data;
      setEntries([
        {
          id: d.auditID,
          actor: d.actorID,
          actorRole: d.actorRole,
          actorOrg: d.actorOrg || "—",
          action: d.action,
          resourceType: d.resourceType,
          resourceId: d.resourceID,
          timestamp: d.timestamp,
        },
        ...entries,
      ]);
      toast.success("Audit entry loaded");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't load that audit entry");
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Audit history"
        subtitle="Every access to your records — by you, and by clinicians and partner orgs."
      />
      <div className="flex gap-2">
        <Input
          placeholder="Look up entry by audit ID (e.g. AUD0012)"
          value={lookupID}
          onChange={(e) => setLookupID(e.target.value)}
        />
        <Button onClick={lookup}>Load</Button>
      </div>
      <AuditTimeline entries={entries} />
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-surface-muted p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}