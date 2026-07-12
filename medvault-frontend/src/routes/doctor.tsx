import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { getSession } from "@/lib/session";
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
      {tab === "consults" && <Consultations />}
      {tab === "rx" && <Prescriptions />}
      {tab === "labs" && <LabReports />}
      {tab === "referrals" && <Referrals />}
      {tab === "permissions" && <PermissionsSent />}
      {tab === "emergency" && <EmergencyAccess />}
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
  return (
    <div className="space-y-4">
      <SectionHeader
        title="My patients"
        subtitle="Patients currently under a treatment relationship."
      />
      <div className="space-y-3">
        {patients.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {p.name}
                </div>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {p.id} · {p.age}y · {p.gender} · {p.relationshipType}
              </div>
            </div>
            <div className="flex gap-2">
              {p.status === "Active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPatients(
                      patients.map((x) =>
                        x.id === p.id ? { ...x, status: "Dormant" } : x,
                      ),
                    );
                    toast.info("Relationship marked dormant");
                  }}
                >
                  Mark dormant
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setPatients(
                      patients.map((x) =>
                        x.id === p.id ? { ...x, status: "Active" } : x,
                      ),
                    );
                    toast.success("Relationship reactivated");
                  }}
                >
                  Reactivate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Consultations() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Consultations"
          subtitle="Create a new consultation or review recent ones."
        />
        <CreateRecordDialog kind="Consultation" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {mockRecords
          .filter((r) => r.type === "CONSULTATION")
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

function Prescriptions() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title="Prescriptions"
          subtitle="Issue prescriptions. Status is updated by pharmacy on dispense."
        />
        <CreateRecordDialog kind="Prescription" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {mockRecords
          .filter((r) => r.type === "PRESCRIPTION")
          .map((r) => (
            <div key={r.id} className="space-y-2">
              <DocumentCard record={r} />
              <div className="flex items-center justify-between rounded-md border bg-surface-muted px-3 py-2 text-xs">
                <span className="text-muted-foreground">Status</span>
                <StatusPill status="ISSUED" />
              </div>
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

function Referrals() {
  const [open, setOpen] = useState(false);
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
              onSubmit={(e) => {
                e.preventDefault();
                setOpen(false);
                toast.success("Referral sent");
              }}
            >
              <FormField label="To doctor (ID or name)" placeholder="DR-1234" />
              <FormField label="Patient" placeholder="PT-9001" />
              <div className="space-y-1.5">
                <Label className="text-xs">Reason</Label>
                <Textarea rows={3} placeholder="Reason for referral" />
              </div>
              <FormField label="Attach document" type="file" />
              <DialogFooter>
                <Button type="submit" className="w-full">
                  Send referral
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {mockRecords
          .filter((r) => r.type === "REFERRAL")
          .map((r) => (
            <DocumentCard key={r.id} record={r} />
          ))}
      </div>
    </div>
  );
}

function PermissionsSent() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Permission requests (sent)"
        subtitle="Status of your requests to view sensitive patient records."
      />
      <div className="space-y-3">
        {[
          {
            id: "PRS-1",
            patient: "Ananya Nair",
            resource: "Psychiatry consultation",
            status: "PENDING",
          },
          {
            id: "PRS-2",
            patient: "Rohan Gupta",
            resource: "HIV screening",
            status: "APPROVED",
            windowH: 36,
          },
          {
            id: "PRS-3",
            patient: "Priya Sharma",
            resource: "Genetic report",
            status: "REJECTED",
          },
          {
            id: "PRS-4",
            patient: "Amit Verma",
            resource: "Oncology summary",
            status: "EXPIRED",
          },
        ].map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">{r.patient}</div>
                <StatusPill status={r.status} />
              </div>
              <div className="text-xs text-muted-foreground">{r.resource}</div>
            </div>
            {"windowH" in r && r.status === "APPROVED" && (
              <div className="text-xs text-success-foreground">
                Access window: {r.windowH}h left
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmergencyAccess() {
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
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <FormField label="Patient ID" placeholder="PT-9001" />
              <FormField label="Encounter location" placeholder="ER, AIIMS Delhi" />
            </div>
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">Clinical reason</Label>
              <Textarea
                rows={3}
                placeholder="Patient unconscious after trauma; need history and allergies."
              />
            </div>
            <div className="mt-4 flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
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
                      onClick={() =>
                        toast.success("Emergency access granted — audit written")
                      }
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

function CreateRecordDialog({ kind }: { kind: "Consultation" | "Prescription" }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
            toast.success(`${kind} recorded`);
          }}
        >
          <FormField label="Patient (ID or name)" placeholder="PT-9001" />
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Normal</SelectLabel>
                  {normalRecordCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-sensitive">
                    Sensitive
                  </SelectLabel>
                  {sensitiveCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {kind === "Consultation" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Diagnosis / notes</Label>
              <Textarea rows={3} placeholder="Clinical summary" />
            </div>
          )}
          <FormField label="Attach document" type="file" />
          <DialogFooter>
            <Button type="submit" className="w-full">
              Save {kind.toLowerCase()}
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
