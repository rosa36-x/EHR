import { cn } from "@/lib/utils";

type Status =
  | "ACTIVE"
  | "APPROVED"
  | "DISPENSED"
  | "PENDING"
  | "REVOKED"
  | "REJECTED"
  | "EXPIRED"
  | "DORMANT"
  | "DISCHARGED"
  | "ISSUED"
  | "CANCELLED"
  | string;

const styles: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success-foreground border-success/30",
  APPROVED: "bg-success/15 text-success-foreground border-success/30",
  DISPENSED: "bg-success/15 text-success-foreground border-success/30",
  ISSUED: "bg-primary/10 text-primary border-primary/25",
  PENDING: "bg-warn/20 text-warn-foreground border-warn/40",
  DORMANT: "bg-warn/10 text-warn-foreground border-warn/30",
  REVOKED: "bg-muted text-muted-foreground border-border",
  REJECTED: "bg-muted text-muted-foreground border-border",
  EXPIRED: "bg-muted text-muted-foreground border-border",
  DISCHARGED: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const key = String(status).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        styles[key] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}
