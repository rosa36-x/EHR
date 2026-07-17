import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { prescriptionApi, labReportApi, ApiError } from "@/lib/api";
import {
  Activity,
  Building2,
  ClipboardList,
  FileText,
  FlaskConical,
  Search,
  ShieldCheck,
  Sparkles,
  Download,
} from "lucide-react";
import {
  DashboardShell,
  type NavItem,
} from "@/components/shared/dashboard-shell";
import { DocumentCard } from "@/components/shared/document-card";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusPill } from "@/components/shared/status-pill";
import { SensitivityBadge } from "@/components/shared/sensitivity-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSession, type Org } from "@/lib/session";
import { mockAudit, mockRecords, sensitiveCategories } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/org")({
  head: () => ({
    meta: [{ title: "Organization workspace — MedVault" }],
  }),
  component: OrgDashboard,
});

function OrgDashboard() {
  const navigate = useNavigate();
  const [session, setSess] = useState<ReturnType<typeof getSession>>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || s.role !== "org-actor" || !s.org) {
      navigate({ to: "/auth/org-actor" });
      return;
    }
    setSess(s);
  }, [navigate]);

  const org = (session?.org ?? "Pharmacy") as Org;

  const nav: NavItem[] = useMemo(() => {
    if (org === "Pharmacy") {
      return [
        {
          id: "overview",
          label: "Overview",
          icon: <Sparkles className="h-4 w-4" />,
        },
        {
          id: "fulfill",
          label: "Prescriptions",
          icon: <ClipboardList className="h-4 w-4" />,
        },
      ];
    }
    if (org === "Laboratory") {
      return [
        {
          id: "overview",
          label: "Overview",
          icon: <Sparkles className="h-4 w-4" />,
        },
        {
          id: "create",
          label: "Create lab report",
          icon: <FileText className="h-4 w-4" />,
        },
        {
          id: "mine",
          label: "My lab reports",
          icon: <FlaskConical className="h-4 w-4" />,
        },
      ];
    }
    return [
      { id: "overview", label: "Overview", icon: <Sparkles className="h-4 w-4" /> },
      { id: "audit", label: "Audit log", icon: <Activity className="h-4 w-4" /> },
      {
        id: "anomaly",
        label: "AI anomaly detection",
        icon: <ShieldCheck className="h-4 w-4" />,
      },
    ];
  }, [org]);

  const [tab, setTab] = useState("overview");

  if (!session) return null;

  const roleLabel =
    org === "Pharmacy"
      ? "Pharmacy staff"
      : org === "Laboratory"
        ? "Laboratory staff"
        : "Governance";

  return (
    <DashboardShell
      roleLabel={roleLabel}
      userName={session.name}
      navItems={nav}
      activeId={tab}
      onNavigate={setTab}
      badgeTone={org === "Governance" ? "muted" : "accent"}
    >
      {org === "Pharmacy" && <PharmacyView tab={tab} />}
      {org === "Laboratory" && <LabView tab={tab} labTechID={session.id!} />}
      {org === "Governance" && <GovernanceView tab={tab} />}
    </DashboardShell>
  );
}

// -------------------- Pharmacy --------------------
function PharmacyView({ tab }: { tab: string }) {
  if (tab === "overview") {
    return (
      <div className="space-y-6">
        <Header
          org="Pharmacy"
          copy="Fulfill prescriptions patients have shared with you. Nothing else is visible from this workspace."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Prescriptions with active consent" value="1" />
          <Stat label="Dispensed today" value="0" />
        </div>
      </div>
    );
  }
  return <PharmacyFulfill />;
}

function PharmacyFulfill() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<"none" | "allowed" | null>(null);
  const [rx, setRx] = useState<any>(null);
  const [rxID, setRxID] = useState("");
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q) return;
    setLoading(true);
    try {
      const res: any = await prescriptionApi.get(q, "pharmacy");
      setRx(res.data);
      setRxID(q);
      setResult("allowed");
    } catch (err) {
      setResult("none");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Prescriptions to fulfill"
        subtitle="Search by prescription ID. Access is consent-gated."
      />
      <div className="flex gap-2">
        <Input
          placeholder="e.g. PRE0012"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="outline" onClick={search} disabled={loading}>
          <Search className="h-4 w-4" />
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>

      {result === "none" && (
        <AccessDenied
          title="No active consent"
          message="This patient hasn't granted Pharmacy access to this prescription, or it doesn't exist."
        />
      )}

      {result === "allowed" && rx && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">{rx.recordType}</div>
            <div className="text-xs text-muted-foreground">Patient: {rx.patientID}</div>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-surface-muted px-4 py-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Status:</span>{" "}
              <StatusPill status={rx.status} />
            </div>
            <Button
              disabled={rx.status === "DISPENSED"}
              onClick={async () => {
                try {
                  await prescriptionApi.updateStatus(rxID, "DISPENSED", "pharmacy");
                  setRx({ ...rx, status: "DISPENSED" });
                  toast.success("Prescription marked as dispensed");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Couldn't update status");
                }
              }}
            >
              Mark as dispensed
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------- Laboratory --------------------
function LabView({ tab, labTechID }: { tab: string; labTechID: string }) {
  if (tab === "overview") {
    return (
      <div className="space-y-6">
        <Header
          org="Laboratory"
          copy="Create and manage lab reports. Only reports you created appear here."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Reports this month" value="12" />
          <Stat label="Sensitive reports" value="2" />
        </div>
      </div>
    );
  }
  if (tab === "create") return <LabCreate labTechID={labTechID} />;
  return <LabMine />;
}

function LabCreate({ labTechID }: { labTechID: string }) {
  const [patientID, setPatientID] = useState("");
  const [reportType, setReportType] = useState("BLOOD_TEST");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const NORMAL = ["BLOOD_TEST", "URINE_TEST", "BIOPSY", "IMAGING", "PATHOLOGY", "MICROBIOLOGY"];
  const SENSITIVE = ["HIV_TEST", "STI_TEST", "GENETIC_TEST", "DRUG_TEST", "PREGNANCY_TEST", "TOXICOLOGY"];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Create lab report"
        subtitle="Reports are encrypted and pushed to the ledger with patient consent."
      />
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!patientID || !file) {
              toast.error("Patient ID and a file are required");
              return;
            }
            setLoading(true);
            try {
              const res: any = await labReportApi.create({ patientID, labTechID, reportType }, file);
              const existing = JSON.parse(localStorage.getItem("medvault_labreports") ?? "[]");
              localStorage.setItem(
                "medvault_labreports",
                JSON.stringify([{ id: res.reportID, patientID, reportType }, ...existing]),
              );
              toast.success("Lab report created");
              setOpen(true);
              setPatientID("");
              setFile(null);
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Couldn't save report");
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Patient ID"
              placeholder="e.g. PAT0049"
              value={patientID}
              onChange={(e) => setPatientID(e.target.value)}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Report type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Normal</SelectLabel>
                    {NORMAL.map((c) => (
                      <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="text-sensitive">Sensitive</SelectLabel>
                    {SENSITIVE.map((c) => (
                      <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Attach report file</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save report"}</Button>
          </div>
        </form>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report saved</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The report is now visible to the patient and any clinician they allow.
          </p>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabMine() {
  const [items] = useState<{ id: string; patientID: string; reportType: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_labreports") ?? "[]");
    } catch {
      return [];
    }
  });
  return (
    <div className="space-y-4">
      <SectionHeader
        title="My lab reports"
        subtitle="Reports you've created."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {items.length === 0 && (
          <EmptyState label="No lab reports created yet." />
        )}
        {items.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{r.reportType}</div>
                <div className="text-xs text-muted-foreground">Patient: {r.patientID}</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => labReportApi.document(r.id, "laboratory").catch((err) =>
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

// -------------------- Governance --------------------
function GovernanceView({ tab }: { tab: string }) {
  if (tab === "overview") {
    return (
      <div className="space-y-6">
        <Header
          org="Governance"
          copy="Oversight and compliance. Governance and Hospital are the only orgs that can read the full audit trail."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Audit events (24h)" value="128" />
          <Stat label="Sensitive-record accesses" value="7" />
          <Stat label="Emergency overrides" value="1" tone="warn" />
        </div>
      </div>
    );
  }
  if (tab === "audit") return <AuditExplorer />;
  return <AnomalyPlaceholder />;
}

function AuditExplorer() {
  const [org, setOrg] = useState<string>("ALL");
  const [action, setAction] = useState<string>("ALL");

  const filtered = mockAudit.filter(
    (a) =>
      (org === "ALL" || a.actorOrg === org) &&
      (action === "ALL" || a.action === action),
  );

  const actions = Array.from(new Set(mockAudit.map((a) => a.action)));

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Audit log explorer"
        subtitle="Filter by org, action or date."
      />
      <div className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm md:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Org</Label>
          <Select value={org} onValueChange={setOrg}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All orgs</SelectItem>
              <SelectItem value="Hospital">Hospital</SelectItem>
              <SelectItem value="Pharmacy">Pharmacy</SelectItem>
              <SelectItem value="Laboratory">Laboratory</SelectItem>
              <SelectItem value="Governance">Governance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input type="date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input type="date" />
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Role · Org</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </TableCell>
                <TableCell className="text-sm">{e.actor}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {e.actorRole} · {e.actorOrg}
                </TableCell>
                <TableCell>
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px]">
                    {e.action}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {e.resourceType}{" "}
                  <span className="text-muted-foreground">({e.resourceId})</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AnomalyPlaceholder() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="AI anomaly detection"
        subtitle="Governed AI-driven flagging of suspicious access patterns."
      />
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-surface-muted p-10 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <SensitivityBadgeLite /> Coming soon
          </div>
          <h3 className="mt-3 text-base font-semibold text-foreground">
            Anomaly detection is planned but not yet live
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            When available, this panel will surface off-hours access bursts,
            cross-org anomalies and unusual sensitive-record reads. We're not
            showing sample stats here — they would be fabricated. Real numbers
            will appear once the model and its governance guardrails ship.
          </p>
        </div>
      </div>
    </div>
  );
}

function SensitivityBadgeLite() {
  return <span className="text-[10px]">■</span>;
}

// -------------------- Shared building blocks --------------------
function Header({ org, copy }: { org: string; copy: string }) {
  return (
    <header className="rounded-xl border bg-gradient-to-br from-accent via-surface to-surface p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        {org} workspace
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
        Welcome
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{copy}</p>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
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
    </div>
  );
}

function Field({
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