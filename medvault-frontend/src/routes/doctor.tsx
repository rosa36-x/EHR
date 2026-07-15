import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { permissionRequestApi, ApiError,consultationApi, prescriptionApi,treatmentRelationshipApi,referralApi,emergencyApi  } from "@/lib/api";
import { getSession } from "@/lib/session";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ClipboardList,
  FileText,
  FlaskConical,
  KeyRound,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import {
  DashboardShell,
  type NavItem,
} from "@/components/shared/dashboard-shell";
import { DocumentCard } from "@/components/shared/document-card";
import { AuditTimeline } from "@/components/shared/audit-timeline";
import { StatusPill } from "@/components/shared/status-pill";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  mockAudit,
  mockPatients,
  mockRecords,
  normalRecordCategories,
  sensitiveCategories,
  type PatientListItem,
} from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/doctor")({
  head: () => ({
    meta: [{ title: "Clinician workspace — MedVault" }],
  }),
  component: DoctorDashboard,
});

const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: <Sparkles className="h-4 w-4" /> },
  { id: "search", label: "Patient search", icon: <Search className="h-4 w-4" /> },
  { id: "patients", label: "My patients", icon: <Users className="h-4 w-4" /> },
  {
    id: "consults",
    label: "Consultations",
    icon: <Stethoscope className="h-4 w-4" />,
  },
  {
    id: "rx",
    label: "Prescriptions",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  { id: "labs", label: "Lab reports", icon: <FlaskConical className="h-4 w-4" /> },
  {
    id: "referrals",
    label: "Referrals",
    icon: <ArrowRightLeft className="h-4 w-4" />,
  },
  {
    id: "permissions",
    label: "Permission requests",
    icon: <KeyRound className="h-4 w-4" />,
  },
  {
    id: "emergency",
    label: "Emergency access",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  { id: "audit", label: "Audit history", icon: <Activity className="h-4 w-4" /> },
];

function DoctorDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [session, setSess] = useState<ReturnType<typeof getSession>>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || s.role !== "doctor") {
      navigate({ to: "/auth/doctor" });
      return;
    }
    setSess(s);
  }, [navigate]);

  if (!session) return null;

  return (
    <DashboardShell
      roleLabel="Doctor"
      userName={session.name}
      navItems={NAV}
      activeId={tab}
      onNavigate={setTab}
      badgeTone="accent"
    >
      {tab === "overview" && <Overview name={session.name} onGoto={setTab} />}
      {tab === "search" && <PatientSearch />}
      {tab === "patients" && <MyPatients />}
      {tab === "consults" && <Consultations doctorID={session.id!} />}
      {tab === "rx" && <Prescriptions doctorID={session.id!} />}
      {tab === "labs" && <LabReports />}
      {tab === "referrals" && <Referrals doctorID={session.id!} />}
      {tab === "permissions" && <PermissionsSent />}
      {tab === "emergency" && <EmergencyAccess doctorID={session.id!} />}
      {tab === "audit" && (
        <div className="space-y-4">
          <SectionHeader
            title="Audit history"
            subtitle="Records you have accessed."
          />
          <AuditTimeline entries={mockAudit.filter((a) => a.actorRole === "Doctor")} />
        </div>
      )}
    </DashboardShell>
  );
}

function Overview({
  name,
  onGoto,
}: {
  name: string;
  onGoto: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <header className="rounded-xl border bg-gradient-to-br from-accent via-surface to-surface p-6">
        <div className="text-sm text-muted-foreground">Good day,</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You have 3 active patients and 1 permission request pending.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active patients" value="3" onClick={() => onGoto("patients")} />
        <Stat
          label="Pending permission requests"
          value="1"
          tone="warn"
          onClick={() => onGoto("permissions")}
        />
        <Stat label="Consultations today" value="4" onClick={() => onGoto("consults")} />
      </div>
    </div>
  );
}

function Stat({
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

function PatientSearch() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PatientListItem | null>(null);
  const results = q
    ? mockPatients.filter(
        (p) =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.id.toLowerCase().includes(q.toLowerCase()),
      )
    : [];
  return (
    <div className="space-y-4">
      <SectionHeader title="Patient search" subtitle="Search by patient ID or name." />
      <div className="flex gap-2">
        <Input
          placeholder="e.g. PT-9001 or Priya"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="outline">
          <Search className="h-4 w-4" />
          Search
        </Button>
      </div>
      {q && results.length === 0 && (
        <AccessDenied
          title="No patient found"
          message="Check the ID or spelling and try again."
        />
      )}
      <div className="grid gap-3">
        {results.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm"
          >
            <div>
              <div className="text-sm font-semibold text-foreground">
                {p.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.id} · {p.age}y · {p.gender}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(p)}>
                View records
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  toast.success(`Treatment relationship started with ${p.name}`)
                }
              >
                Create relationship
              </Button>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <div className="mt-6 space-y-3">
          <SectionHeader title={`Records for ${selected.name}`} />
          <div className="grid gap-3 md:grid-cols-2">
            {mockRecords.map((r) => (
              <DocumentCard
                key={r.id}
                record={r}
                locked={r.sensitivity === "SENSITIVE"}
                onRequestAccess={() =>
                  toast.success("Permission request sent to patient")
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MyPatients() {
  const [patients, setPatients] = useState(mockPatients);
  const [realItems, setRealItemsState] = useState<{ id: string; patientID: string; relationshipType: string; status: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_relationships") ?? "[]");
    } catch {
      return [];
    }
  });
  const setRealItems = (items: typeof realItems) => {
    setRealItemsState(items);
    localStorage.setItem("medvault_relationships", JSON.stringify(items));
  };
  const [open, setOpen] = useState(false);
  const [patientID, setPatientID] = useState("");
  const [relationshipType, setRelationshipType] = useState("ONGOING_TREATMENT");
  const [loading, setLoading] = useState(false);

  const TYPES = [
    "RECENT_APPOINTMENT",
    "FOLLOW_UP_CHECKUP",
    "ONGOING_TREATMENT",
    "REFERRED_BY_DOCTOR",
  ];

  const act = async (id: string, action: "discharge" | "dormant" | "reactivate") => {
    try {
      if (action === "discharge") await treatmentRelationshipApi.discharge(id);
      if (action === "dormant") await treatmentRelationshipApi.markDormant(id);
      if (action === "reactivate") await treatmentRelationshipApi.reactivate(id);
      setRealItems(
        realItems.map((x) =>
          x.id === id
            ? { ...x, status: action === "dormant" ? "Dormant" : action === "reactivate" ? "Active" : "Discharged" }
            : x,
        ),
      );
      toast.success(`Relationship ${action === "dormant" ? "marked dormant" : action === "reactivate" ? "reactivated" : "discharged"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Couldn't ${action}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="My patients"
          subtitle="Patients currently under a treatment relationship."
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New treatment relationship</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create treatment relationship</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!patientID) { toast.error("Enter a patient ID"); return; }
                setLoading(true);
                try {
                  const res: any = await treatmentRelationshipApi.create({ patientID, relationshipType });
                  setRealItems([
                    { id: res.relationshipID ?? res.data?.relationshipID, patientID, relationshipType, status: "Active" },
                    ...realItems,
                  ]);
                  setOpen(false);
                  setPatientID("");
                  toast.success("Treatment relationship created");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Couldn't create relationship");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Input placeholder="Patient ID (e.g. PAT0049)" value={patientID} onChange={(e) => setPatientID(e.target.value)} />
              <Select value={relationshipType} onValueChange={setRelationshipType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {realItems.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-foreground">{p.patientID}</div>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{p.relationshipType.replace(/_/g, " ")}</div>
            </div>
            <div className="flex gap-2">
              {p.id && p.status === "Active" && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => act(p.id, "dormant")}>Mark dormant</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(p.id, "discharge")}>Discharge</Button>
                </>
              )}
              {p.status === "Dormant" && (
                <Button size="sm" onClick={() => act(p.id, "reactivate")}>Reactivate</Button>
              )}
            </div>
          </div>
        ))}
        {patients.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm opacity-60">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-foreground">{p.name}</div>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {p.id} · {p.age}y · {p.gender} · {p.relationshipType} (demo data)
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Consultations({ doctorID }: { doctorID: string }) {
  const [created, setCreatedState] = useState<{ id: string; patientID: string; recordType: string; diagnosis: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_consultations") ?? "[]");
    } catch {
      return [];
    }
  });
  const setCreated = (items: typeof created) => {
    setCreatedState(items);
    localStorage.setItem("medvault_consultations", JSON.stringify(items));
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Consultations"
          subtitle="Create a new consultation or review recent ones."
        />
        <CreateRecordDialog
          kind="Consultation"
          doctorID={doctorID}
          onCreated={(r) => setCreated([r, ...created])}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {created.length === 0 && (
          <EmptyState label="No consultations created yet this session." />
        )}
        {created.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">{r.id}</div>
            <div className="text-xs text-muted-foreground">Patient: {r.patientID} · {r.recordType}</div>
            <div className="mt-2 text-sm">{r.diagnosis}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Prescriptions({ doctorID }: { doctorID: string }) {
  const [created, setCreatedState] = useState<{ id: string; patientID: string; recordType: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_prescriptions") ?? "[]");
    } catch {
      return [];
    }
  });
  const setCreated = (items: typeof created) => {
    setCreatedState(items);
    localStorage.setItem("medvault_prescriptions", JSON.stringify(items));
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Prescriptions"
          subtitle="Issue prescriptions. Status is updated by pharmacy on dispense."
        />
        <CreateRecordDialog
          kind="Prescription"
          doctorID={doctorID}
          onCreated={(r) => setCreated([r, ...created])}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {created.length === 0 && (
          <EmptyState label="No prescriptions created yet this session." />
        )}
        {created.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">{r.id}</div>
            <div className="text-xs text-muted-foreground">Patient: {r.patientID} · {r.recordType}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function LabReports() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Lab reports"
        subtitle="Read-only view of lab reports for patients you treat."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {mockRecords
          .filter((r) => r.type === "LAB_REPORT")
          .map((r) => (
            <DocumentCard
              key={r.id}
              record={r}
              locked={r.sensitivity === "SENSITIVE"}
              onRequestAccess={() =>
                toast.success("Permission request sent to patient")
              }
            />
          ))}
      </div>
    </div>
  );
}

function Referrals({ doctorID }: { doctorID: string }) {
  const [open, setOpen] = useState(false);
  const [toDoctorID, setToDoctorID] = useState("");
  const [patientID, setPatientID] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [referralType, setReferralType] = useState("GENERAL");
  const [items, setItemsState] = useState<{ id: string; patientID: string; toDoctorID: string; reason: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_referrals") ?? "[]");
    } catch {
      return [];
    }
  });
  const setItems = (i: typeof items) => {
    setItemsState(i);
    localStorage.setItem("medvault_referrals", JSON.stringify(i));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Referrals"
          subtitle="Send a patient to a colleague, or review incoming referrals."
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Send className="h-4 w-4" />
              New referral
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create referral</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!toDoctorID || !patientID || !reason || !file) {
                  toast.error("Fill in every field and attach a document");
                  return;
                }
                setLoading(true);
                try {
                  const res: any = await referralApi.create(
                    { patientID, fromDoctorID: doctorID, toDoctorID, referralReason: reason, referralType },
                    file,
                  );
                  setItems([{ id: res.referralID, patientID, toDoctorID, reason }, ...items]);
                  setOpen(false);
                  setToDoctorID("");
                  setPatientID("");
                  setReason("");
                  setFile(null);
                  toast.success("Referral sent");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Couldn't send referral");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <FormField
                label="To doctor ID"
                placeholder="e.g. DOC0002"
                value={toDoctorID}
                onChange={(e) => setToDoctorID(e.target.value)}
              />
              <FormField
                label="Patient ID"
                placeholder="e.g. PAT0049"
                value={patientID}
                onChange={(e) => setPatientID(e.target.value)}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">Referral type</Label>
                <Select value={referralType} onValueChange={setReferralType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERAL">General</SelectItem>
                    <SelectItem value="SPECIALIST">Specialist</SelectItem>
                    <SelectItem value="ONCOLOGY">Oncology</SelectItem>
                    <SelectItem value="PSYCHIATRY">Psychiatry (sensitive)</SelectItem>
                    <SelectItem value="REPRODUCTIVE_HEALTH">Reproductive health (sensitive)</SelectItem>
                    <SelectItem value="HIV_AIDS">HIV/AIDS (sensitive)</SelectItem>
                    <SelectItem value="GENETIC_COUNSELING">Genetic counseling (sensitive)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason</Label>
                <Textarea
                  rows={3}
                  placeholder="Reason for referral"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Attach document</Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send referral"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.length === 0 && <EmptyState label="No referrals sent yet." />}
        {items.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">To: {r.toDoctorID}</div>
            <div className="text-xs text-muted-foreground">Patient: {r.patientID}</div>
            <div className="mt-2 text-sm">{r.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionsSent() {
  const [items, setItems] = useState<{ id: string; patient: string; resource: string; status: string }[]>([
    { id: "PRS-1", patient: "Ananya Nair", resource: "Psychiatry consultation", status: "PENDING" },
    { id: "PRS-2", patient: "Rohan Gupta", resource: "HIV screening", status: "APPROVED" },
    { id: "PRS-3", patient: "Priya Sharma", resource: "Genetic report", status: "REJECTED" },
    { id: "PRS-4", patient: "Amit Verma", resource: "Oncology summary", status: "EXPIRED" },
  ]);
  const [open, setOpen] = useState(false);
  const [patientID, setPatientID] = useState("");
  const [resourceType, setResourceType] = useState("CONSULTATION");
  const [resourceID, setResourceID] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader title="Permission requests (sent)" subtitle="Status of your requests to view sensitive patient records." />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>Request permission</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Request access to a sensitive record</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              if (!patientID || !resourceID || !reason) { toast.error("Fill in every field"); return; }
              setLoading(true);
              try {
                const res: any = await permissionRequestApi.create({ patientID, resourceType, resourceID, reason });
                setItems([{ id: res.requestID, patient: patientID, resource: resourceID, status: "PENDING" }, ...items]);
                setOpen(false);
                toast.success("Request sent to patient");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Couldn't send request");
              } finally { setLoading(false); }
            }}>
              <Input placeholder="Patient ID (e.g. PAT0049)" value={patientID} onChange={(e) => setPatientID(e.target.value)} />
              <Select value={resourceType} onValueChange={setResourceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONSULTATION">Consultation</SelectItem>
                  <SelectItem value="LAB_REPORT">Lab report</SelectItem>
                  <SelectItem value="PRESCRIPTION">Prescription</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Resource ID (e.g. CONS0012)" value={resourceID} onChange={(e) => setResourceID(e.target.value)} />
              <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <DialogFooter>
                <Button type="submit" className="w-full" disabled={loading}>{loading ? "Sending…" : "Send request"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-3">
        {items.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2"><div className="text-sm font-semibold">{r.patient}</div><StatusPill status={r.status} /></div>
              <div className="text-xs text-muted-foreground">{r.resource}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function EmergencyAccess({ doctorID }: { doctorID: string }) {
  const [patientID, setPatientID] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Emergency access"
        subtitle="For patients who cannot consent right now. Every emergency access is heavily audited."
      />
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              Trigger emergency access
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Bypasses consent and permission gates. Use only when the patient
              cannot grant access (e.g. unconscious). Your action, identity,
              and reason are permanently written to the ledger.
            </p>
            <div className="mt-4">
              <FormField
                label="Patient ID"
                placeholder="e.g. PAT0049"
                value={patientID}
                onChange={(e) => setPatientID(e.target.value)}
              />
            </div>
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">Clinical reason</Label>
              <Textarea
                rows={3}
                placeholder="Patient unconscious after trauma; need history and allergies."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={!patientID || !reason}>
                    <AlertTriangle className="h-4 w-4" />
                    Confirm emergency access
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Grant yourself emergency access?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This overrides patient consent and is logged
                      permanently. Governance may review.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={loading}
                      onClick={async () => {
                        setLoading(true);
                        try {
                         await emergencyApi.create({ patientID, reason, doctorID });
                          try {
                            const existing = JSON.parse(localStorage.getItem("medvault_relationships") ?? "[]");
                            localStorage.setItem(
                              "medvault_relationships",
                              JSON.stringify([
                                { id: "", patientID, relationshipType: "ASSIGNED_EMERGENCY_PHYSICIAN (auto-expires 24h)", status: "Active" },
                                ...existing,
                              ]),
                            );
                          } catch {}
                          toast.success("Emergency access granted — audit written");
                          setPatientID("");
                          setReason("");
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : "Couldn't grant emergency access");
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Yes, proceed
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CONSULTATION_TYPES: { value: string; label: string; sensitive?: boolean }[] = [
  { value: "GENERAL", label: "General" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "CARDIOLOGY", label: "Cardiology" },
  { value: "ORTHOPEDICS", label: "Orthopedics" },
  { value: "DERMATOLOGY", label: "Dermatology" },
  { value: "NEUROLOGY", label: "Neurology" },
  { value: "ENDOCRINOLOGY", label: "Endocrinology" },
  { value: "PULMONOLOGY", label: "Pulmonology" },
  { value: "GASTROENTEROLOGY", label: "Gastroenterology" },
  { value: "PSYCHIATRY", label: "Psychiatry", sensitive: true },
  { value: "SUBSTANCE_ABUSE", label: "Substance abuse", sensitive: true },
  { value: "REPRODUCTIVE_HEALTH", label: "Reproductive health", sensitive: true },
  { value: "HIV_AIDS", label: "HIV/AIDS", sensitive: true },
  { value: "GENETIC_COUNSELING", label: "Genetic counseling", sensitive: true },
  { value: "DISABILITY", label: "Disability", sensitive: true },
  { value: "TERMINAL_ILLNESS", label: "Terminal illness", sensitive: true },
  { value: "MINOR", label: "Minor", sensitive: true },
  { value: "ONCOLOGY", label: "Oncology", sensitive: true },
  { value: "PEDIATRICS", label: "Pediatrics", sensitive: true },
  { value: "GYNECOLOGY", label: "Gynecology", sensitive: true },
];

const PRESCRIPTION_TYPES: { value: string; label: string; sensitive?: boolean }[] = [
  { value: "GENERAL", label: "General" },
  { value: "GENERAL_CHRONIC", label: "General (chronic)" },
  { value: "ONCOLOGY", label: "Oncology" },
  { value: "PSYCHIATRIC", label: "Psychiatric", sensitive: true },
  { value: "CONTROLLED_SUBSTANCE", label: "Controlled substance", sensitive: true },
  { value: "REPRODUCTIVE", label: "Reproductive", sensitive: true },
  { value: "HIV_MEDICATION", label: "HIV medication", sensitive: true },
];

function CreateRecordDialog({
  kind,
  doctorID,
  onCreated,
}: {
  kind: "Consultation" | "Prescription";
  doctorID: string;
  onCreated?: (r: { id: string; patientID: string; recordType: string; diagnosis: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [patientID, setPatientID] = useState("");
  const [recordType, setRecordType] = useState("GENERAL");
  const [diagnosis, setDiagnosis] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const types = kind === "Consultation" ? CONSULTATION_TYPES : PRESCRIPTION_TYPES;

  const reset = () => {
    setPatientID("");
    setRecordType("GENERAL");
    setDiagnosis("");
    setFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <FileText className="h-4 w-4" />
          New {kind.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create {kind.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!patientID || !file) {
              toast.error("Patient ID and a document are required");
              return;
            }
            if (kind === "Consultation" && !diagnosis) {
              toast.error("Diagnosis / notes are required");
              return;
            }
            setLoading(true);
            try {
              let newID = "";
              if (kind === "Consultation") {
                const res: any = await consultationApi.create(
                  { patientID, doctorID, diagnosis, recordType },
                  file,
                );
                newID = res.consultationID ?? "";
              } else {
                const res: any = await prescriptionApi.create(
                  { patientID, doctorID, recordType },
                  file,
                );
                newID = res.prescriptionID ?? "";
              }
              onCreated?.({ id: newID, patientID, recordType, diagnosis });
              setOpen(false);
              reset();
              toast.success(`${kind} recorded`);
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : `Couldn't save ${kind.toLowerCase()}`);
            } finally {
              setLoading(false);
            }
          }}
        >
          <FormField
            label="Patient ID"
            placeholder="e.g. PAT0049"
            value={patientID}
            onChange={(e) => setPatientID(e.target.value)}
          />
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={recordType} onValueChange={setRecordType}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Normal</SelectLabel>
                  {types.filter((t) => !t.sensitive).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-sensitive">Sensitive</SelectLabel>
                  {types.filter((t) => t.sensitive).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {kind === "Consultation" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Diagnosis / notes</Label>
              <Textarea
                rows={3}
                placeholder="Clinical summary"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Attach document</Label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving…" : `Save ${kind.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input {...rest} />
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
