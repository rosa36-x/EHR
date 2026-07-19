import type { AuditEntry } from "@/lib/mock-data";
import { Activity } from "lucide-react";

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-surface-muted p-8 text-center text-sm text-muted-foreground">
        No audit entries yet.
      </div>
    );
  }
  return (
    <ol className="relative space-y-4 border-l border-border pl-6">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[29px] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
            <Activity className="h-2.5 w-2.5" />
          </span>
          <div className="rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium text-foreground">
                {e.actor}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {e.actorRole} · {e.actorOrg}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatTime(e.timestamp)}
              </div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs text-foreground">
                {e.action}
              </span>{" "}
              on {e.resourceType}{" "}
              <span className="font-mono text-xs">{e.resourceId}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
