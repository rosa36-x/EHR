import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  ArrowRight,
  Building2,
  FlaskConical,
  HeartPulse,
  Pill,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { getSession, dashboardPath } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MedVault — Secure Electronic Health Records" },
      {
        name: "description",
        content:
          "Patient-consented, cross-organization health records on Hyperledger Fabric.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    const s = getSession();
    if (s) navigate({ to: dashboardPath(s) });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-surface/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                MedVault
              </div>
              <div className="text-[11px] text-muted-foreground">
                Hyperledger Fabric EHR
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Preview build — not for production data
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-xs text-muted-foreground">
            <HeartPulse className="h-3.5 w-3.5 text-primary" />
            For the Indian healthcare network
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground md:text-5xl">
            One record. Many caregivers.
            <br />
            <span className="text-primary">Consent stays with the patient.</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">
            MedVault connects hospitals, pharmacies, laboratories and governance
            on a shared, auditable ledger — so every access is traced, every
            sensitive record is patient-gated, and no organization sees more
            than it should.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <RoleCard
            to="/auth/patient"
            icon={<UserRound className="h-5 w-5" />}
            title="I'm a patient"
            description="Aadhaar-verified sign-up, then just your phone and an OTP."
            tone="primary"
          />
          <RoleCard
            to="/auth/doctor"
            icon={<Stethoscope className="h-5 w-5" />}
            title="I'm a doctor"
            description="Password or OTP login for provisioned clinicians."
            tone="accent"
          />
          <RoleCard
            to="/auth/org-actor"
            icon={<Building2 className="h-5 w-5" />}
            title="Pharmacy · Lab · Governance"
            description="One sign-in for organization staff — the org decides the workspace."
            tone="muted"
          />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-4">
          <MiniStat icon={<UserRound className="h-4 w-4" />} label="Patients" />
          <MiniStat
            icon={<Stethoscope className="h-4 w-4" />}
            label="Doctors"
          />
          <MiniStat icon={<Pill className="h-4 w-4" />} label="Pharmacies" />
          <MiniStat
            icon={<FlaskConical className="h-4 w-4" />}
            label="Laboratories"
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground">
          © MedVault — Research is on the network but not yet live for
          end-user workflows.
        </div>
      </footer>
    </div>
  );
}

function RoleCard({
  to,
  icon,
  title,
  description,
  tone,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "primary" | "accent" | "muted";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "accent"
        ? "bg-accent text-accent-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <Link
      to={to}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-md ${toneClass}`}
      >
        {icon}
      </div>
      <div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">
        Continue
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function MiniStat({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-surface p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">On network</div>
      </div>
    </div>
  );
}
