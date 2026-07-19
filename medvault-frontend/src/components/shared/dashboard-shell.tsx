import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { clearSession, getSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  roleLabel: string;
  userName: string;
  navItems: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
  badgeTone?: "primary" | "accent" | "muted";
}

export function DashboardShell({
  roleLabel,
  userName,
  navItems,
  activeId,
  onNavigate,
  children,
  badgeTone = "primary",
}: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const handleSignOut = () => {
    clearSession();
    navigate({ to: "/" });
  };

  // Rehydrate name if not passed in
  const name = userName || getSession()?.name || "User";

  const toneClass =
    badgeTone === "accent"
      ? "bg-accent text-accent-foreground"
      : badgeTone === "muted"
        ? "bg-muted text-muted-foreground"
        : "bg-primary/10 text-primary";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="text-sm font-semibold tracking-tight">
                MedVault
              </div>
            </Link>
            <span
              className={cn(
                "hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline-flex",
                toneClass,
              )}
            >
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-xs sm:block">
              <div className="font-medium text-foreground">{name}</div>
              <div className="text-muted-foreground">
                {pathname.startsWith("/patient")
                  ? "Patient portal"
                  : pathname.startsWith("/doctor")
                    ? "Clinician workspace"
                    : "Org workspace"}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        <aside className="md:w-56 md:shrink-0">
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {navItems.map((item) => {
              const active = item.id === activeId;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
