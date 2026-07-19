import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function SensitivityBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-sensitive/30 bg-sensitive/10 px-2 py-0.5 text-[11px] font-medium text-sensitive",
        className,
      )}
      title="Sensitive record — patient-gated access"
    >
      <Lock className="h-3 w-3" />
      Sensitive
    </span>
  );
}
