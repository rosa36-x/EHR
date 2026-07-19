import { AlertOctagon, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export function PriorityBadge({
  priority,
  className,
}: {
  priority: string;
  className?: string;
}) {
  if (priority === "P1_high_confidence") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-destructive-foreground shadow-sm",
          className,
        )}
      >
        <AlertOctagon className="h-3 w-3" />
        High Confidence
      </span>
    );
  }
  if (priority === "P2_sequence_candidate") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[11px] font-medium text-warn-foreground",
          className,
        )}
      >
        <Eye className="h-3 w-3" />
        Sequence Pattern — Review
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {priority}
    </span>
  );
}
