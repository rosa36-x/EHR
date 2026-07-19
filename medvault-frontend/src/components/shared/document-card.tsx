import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SensitivityBadge } from "./sensitivity-badge";
import type { HealthRecord } from "@/lib/mock-data";
import { toast } from "sonner";

export function DocumentCard({
  record,
  locked,
  onRequestAccess,
}: {
  record: HealthRecord;
  locked?: boolean;
  onRequestAccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDownload = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success("Document decrypted", {
        description: `${record.title} is ready to download.`,
      });
    }, 900);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-foreground">
                {record.title}
              </div>
              {record.sensitivity === "SENSITIVE" && <SensitivityBadge />}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {record.category} · {record.type.replace("_", " ").toLowerCase()}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{record.date}</div>
          <div className="mt-0.5">{record.authorName}</div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{record.summary}</p>

      <div className="flex items-center justify-end">
        {locked ? (
          <Button size="sm" variant="outline" onClick={onRequestAccess}>
            Request patient permission
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Decrypting…
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Decrypt & Download
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
