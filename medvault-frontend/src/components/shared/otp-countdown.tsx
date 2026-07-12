import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function OtpCountdown({
  seconds = 300,
  onResend,
}: {
  seconds?: number;
  onResend: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Code expires in{" "}
        <span className="font-mono text-foreground">
          {mm}:{ss}
        </span>
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        disabled={remaining > 0}
        onClick={onResend}
      >
        Resend code
      </Button>
    </div>
  );
}
