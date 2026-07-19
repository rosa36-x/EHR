import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  prescriptionApi,
  labReportApi,
  anomalyApi,
  ApiError,
  type AnomalyFlag,
  type AnomalySummary,
} from "@/lib/api";
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
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  DashboardShell,
  type NavItem,
} from "@/components/shared/dashboard-shell";
import { DocumentCard } from "@/components/shared/document-card";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusPill } from "@/components/shared/status-pill";
import { PriorityBadge } from "@/components/shared/priority-badge";
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
    return <LabOverview />;
  }
  if (tab === "create") return <LabCreate labTechID={labTechID} />;
  return <LabMine />;
}

const LAB_SENSITIVE_TYPES = [
  "HIV_TEST",
  "STI_TEST",
  "GENETIC_TEST",
  "DRUG_TEST",
  "PREGNANCY_TEST",
  "TOXICOLOGY",
];

function LabOverview() {
  const [items] = useState<{ id: string; patientID: string; reportType: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medvault_labreports") ?? "[]");
    } catch {
      return [];
    }
  });
  const sensitiveCount = items.filter((r) => LAB_SENSITIVE_TYPES.includes(r.reportType)).length;

  return (
    <div className="space-y-6">
      <Header
        org="Laboratory"
        copy="Create and manage lab reports. Only reports you created appear here."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Reports you've created" value={String(items.length)} />
        <Stat label="Sensitive reports" value={String(sensitiveCount)} />
      </div>
    </div>
  );
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
  return <AnomalyDashboard />;
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


const PRIORITY_COLORS: Record<string, string> = {
  P1_high_confidence: "hsl(var(--destructive))",
  P2_sequence_candidate: "hsl(var(--warn))",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: "hsl(var(--warn))",
  CONFIRMED: "hsl(var(--destructive))",
  DISMISSED: "hsl(var(--muted-foreground))",
};

function AnomalyDashboard() {
  const [subtab, setSubtab] = useState<"queue" | "summary">("queue");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PENDING" | "CONFIRMED" | "DISMISSED"
  >("PENDING");
  const [flags, setFlags] = useState<AnomalyFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AnomalyFlag | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadFlags = () => {
    setLoading(true);
    anomalyApi
      .list(statusFilter === "ALL" ? undefined : statusFilter, 100)
      .then((res) => setFlags(res.data))
      .catch((err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't load anomaly flags",
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFlags();
  }, [statusFilter]);

  const runNow = () => {
    setRefreshing(true);
    anomalyApi
      .run()
      .then(() => {
        toast.success("Detection cycle triggered");
        loadFlags();
      })
      .catch((err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't trigger detection cycle",
        ),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          title="AI anomaly detection"
          subtitle="Governed AI-driven flagging of suspicious access patterns."
        />
        <Button variant="outline" size="sm" onClick={runNow} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh now
        </Button>
      </div>

      <Tabs value={subtab} onValueChange={(v) => setSubtab(v as any)}>
        <TabsList>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            {(["PENDING", "CONFIRMED", "DISMISSED", "ALL"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {loading ? (
            <EmptyState label="Loading flags…" />
          ) : flags.length === 0 ? (
            <EmptyState label="No flags in this view." />
          ) : (
            <div className="rounded-lg border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((f) => (
                    <TableRow
                      key={f.flagID}
                      className="cursor-pointer"
                      onClick={() => setSelected(f)}
                    >
                      <TableCell className="text-sm">
                        {f.actorID}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {f.actorOrg ? `· ${f.actorOrg}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.date}
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={f.priority} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.topFeatures.slice(0, 2).map((tf) => tf.feature).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={f.status} />
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <AnomalySummaryPanel />
        </TabsContent>
      </Tabs>

      <FlagDetailDialog
        flag={selected}
        onClose={() => setSelected(null)}
        onReviewed={() => {
          setSelected(null);
          loadFlags();
        }}
      />
    </div>
  );
}

function AnomalySummaryPanel() {
  const [summary, setSummary] = useState<AnomalySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    anomalyApi
      .summary()
      .then((res) => setSummary(res.data))
      .catch((err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't load summary stats",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <EmptyState label="Loading summary…" />;
  if (!summary) return <EmptyState label="No summary data available." />;

  const byStatusData = Object.entries(summary.byStatus).map(([status, count]) => ({
    status,
    count,
  }));
  const byPriorityData = Object.entries(summary.byPriority).map(([priority, count]) => ({
    priority,
    count,
  }));
  const totalByPriority = byPriorityData.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Detection tiers</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          High-confidence flags vs. lower-precision sequence candidates.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {byPriorityData.map((row) => (
            <div key={row.priority} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <PriorityBadge priority={row.priority} />
                <span className="text-2xl font-semibold text-foreground">
                  {row.count}
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${totalByPriority ? (row.count / totalByPriority) * 100 : 0}%`,
                    backgroundColor: PRIORITY_COLORS[row.priority] ?? "hsl(var(--muted-foreground))",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Flags by status">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={byStatusData}
                dataKey="count"
                nameKey="status"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
              >
                {byStatusData.map((row) => (
                  <Cell
                    key={row.status}
                    fill={STATUS_COLORS[row.status] ?? "hsl(var(--muted-foreground))"}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Flags per day (last 30 days)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={summary.byDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top flagged actors (confirmed)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={summary.topActors} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="actorID"
                width={90}
                tick={{ fontSize: 10 }}
              />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--destructive))" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Ensemble score distribution">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={summary.scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function FlagDetailDialog({
  flag,
  onClose,
  onReviewed,
}: {
  flag: AnomalyFlag | null;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<"CONFIRMED" | "DISMISSED" | null>(null);

  useEffect(() => setNotes(""), [flag?.flagID]);

  if (!flag) return null;

  const review = (status: "CONFIRMED" | "DISMISSED") => {
    setSubmitting(status);
    anomalyApi
      .review(flag.flagID, status, notes.trim() || undefined)
      .then(() => {
        toast.success(`Flag ${status === "CONFIRMED" ? "confirmed" : "dismissed"}`);
        onReviewed();
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : "Couldn't submit review"),
      )
      .finally(() => setSubmitting(null));
  };

  return (
    <Dialog open={!!flag} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {flag.flagID}
            <PriorityBadge priority={flag.priority} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-surface-muted p-3 text-xs">
            <div>
              <div className="text-muted-foreground">Actor</div>
              <div className="font-medium text-foreground">{flag.actorID}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Org · Role</div>
              <div className="font-medium text-foreground">
                {flag.actorOrg || "—"} · {flag.actorRole}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Date</div>
              <div className="font-medium text-foreground">{flag.date}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Classification</div>
              <div className="font-medium text-foreground">{flag.classification}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Ensemble score</div>
              <div className="font-medium text-foreground">{flag.ifScore.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">LSTM z-score</div>
              <div className="font-medium text-foreground">
                {flag.lstmScore == null ? (
                  <span className="text-muted-foreground">n/a</span>
                ) : (
                  flag.lstmScore.toFixed(2)
                )}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">On-chain audit reference</div>
              <div className="font-mono text-[11px] text-foreground">{flag.auditID}</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Contributing signals (std. dev. from actor's own baseline)
            </div>
            <div className="space-y-1.5">
              {flag.topFeatures.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No feature breakdown on this flag.
                </div>
              )}
              {flag.topFeatures.map((tf) => {
                const max = Math.max(...flag.topFeatures.map((x) => x.contribution), 1);
                return (
                  <div key={tf.feature} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-xs text-foreground">
                      {tf.feature}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(tf.contribution / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                      {tf.contribution.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {flag.clarificationRequested && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">
                Actor's explanation
              </div>
              <p className="mt-1 text-sm text-foreground">
                {flag.clarificationText?.trim()
                  ? flag.clarificationText
                  : "No explanation submitted yet."}
              </p>
            </div>
          )}

          {flag.status === "PENDING" ? (
            <div className="space-y-2">
              <Label className="text-xs">Review notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reasoning for this decision…"
                rows={3}
              />
            </div>
          ) : (
            <div className="rounded-lg border bg-surface-muted p-3 text-xs">
              <span className="font-medium text-foreground">Already reviewed:</span>{" "}
              <StatusPill status={flag.status} className="ml-1" />
              {flag.reviewNotes && (
                <p className="mt-1 text-muted-foreground">{flag.reviewNotes}</p>
              )}
            </div>
          )}
        </div>

        {flag.status === "PENDING" && (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!submitting}
              onClick={() => review("DISMISSED")}
            >
              {submitting === "DISMISSED" ? "Dismissing…" : "Dismiss"}
            </Button>
            <Button
              variant="destructive"
              disabled={!!submitting}
              onClick={() => review("CONFIRMED")}
            >
              {submitting === "CONFIRMED" ? "Confirming…" : "Confirm violation"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
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
