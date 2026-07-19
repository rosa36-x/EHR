import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "@/components/shared/auth-shell";
import { OtpCountdown } from "@/components/shared/otp-countdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { setSession } from "@/lib/session";
import { authApi, ApiError } from "@/lib/api";
import { setAuthToken } from "@/lib/auth-token";
import { toast } from "sonner";
import { ShieldCheck, Info } from "lucide-react";

export const Route = createFileRoute("/auth/patient")({
  head: () => ({
    meta: [
      { title: "Patient sign-in — MedVault" },
      {
        name: "description",
        content:
          "Register once with Aadhaar. Sign in any time with just your phone and an OTP.",
      },
    ],
  }),
  component: PatientAuth,
});

function PatientAuth() {
  return (
    <AuthShell
      title="Patient access"
      subtitle="No passwords, ever. Aadhaar is used once during registration."
    >
      <Tabs defaultValue="existing">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="existing">Existing patient</TabsTrigger>
          <TabsTrigger value="new">New patient</TabsTrigger>
        </TabsList>
        <TabsContent value="existing" className="mt-6">
          <ExistingFlow />
        </TabsContent>
        <TabsContent value="new" className="mt-6">
          <NewFlow />
        </TabsContent>
      </Tabs>
    </AuthShell>
  );
}

function ExistingFlow() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <StepBar step={step === "phone" ? 1 : 2} total={2} />
      {step === "phone" ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (phone.length < 10) {
              toast.error("Enter a valid 10-digit phone number");
              return;
            }
            setLoading(true);
            try {
              await authApi.patientOtpInitiate(phone);
              toast.success("OTP sent", {
                description: `Check messages on ${phone}`,
              });
              setStep("otp");
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : "Couldn't send OTP. Check your connection and try again.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send OTP"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (otp.length !== 6) {
              toast.error("Enter the 6-digit code");
              return;
            }
            setLoading(true);
            try {
              const res = await authApi.patientOtpVerify(phone, otp);
              setAuthToken(res.token);
              setSession({
                role: "patient",
                name: phone, // real display name isn't returned by login; profile fetch can update this later
                phone,
                id: res.patientID,
              });
              navigate({ to: "/patient" });
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : "Invalid or expired code. Try again.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label>Enter the 6-digit code</Label>
            <InputOTP maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <OtpCountdown
              onResend={async () => {
                try {
                  await authApi.patientOtpInitiate(phone);
                  toast.info("New OTP sent");
                } catch {
                  toast.error("Couldn't resend OTP. Try again.");
                }
              }}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verifying…" : "Verify & sign in"}
          </Button>
          <button
            type="button"
            className="w-full text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setStep("phone")}
          >
            Use a different phone
          </button>
        </form>
      )}
    </div>
  );
}

function NewFlow() {
  const [step, setStep] = useState<"kyc" | "otp">("kyc");
  const [aadhaar, setAadhaar] = useState("");
  const [dob, setDob] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [transactionID, setTransactionID] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const maskedAadhaar = aadhaar.replace(/\d(?=\d{4})/g, "•");

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Aadhaar is used <b>only for one-time verification</b>. After
        registration you'll sign in with your phone number.
      </div>
      <StepBar step={step === "kyc" ? 1 : 2} total={2} />

      {step === "kyc" ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (aadhaar.length !== 12) {
              toast.error("Aadhaar must be 12 digits");
              return;
            }
            if (!dob) {
              toast.error("Enter your date of birth");
              return;
            }
            if (!fullName || !gender || phone.length < 10 || !email) {
              toast.error("Fill in your name, gender, phone, and email");
              return;
            }
            setLoading(true);
            try {
              const res = await authApi.patientInitiateRegistration(aadhaar, dob);
              if (res.status !== "OTP_SENT") {
                toast.error((res as any).message ?? "Aadhaar verification failed.");
                return;
              }
              setTransactionID(res.transactionID);
              toast.success("OTP sent to Aadhaar-linked phone");
              setStep("otp");
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : "Aadhaar verification failed. Check the details and try again.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="aadhaar">Aadhaar number</Label>
            <Input
              id="aadhaar"
              inputMode="numeric"
              placeholder="12-digit Aadhaar"
              value={aadhaar}
              onChange={(e) => {
                // Only update raw digits from delta
                const digitsIn = e.target.value.replace(/\D/g, "");
                setAadhaar(digitsIn.slice(0, 12));
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              placeholder="As per Aadhaar"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Input
              id="gender"
              placeholder="e.g. Female / Male / Other"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regPhone">Phone number</Label>
            <Input
              id="regPhone"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regEmail">Email</Label>
            <Input
              id="regEmail"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verifying…" : "Verify & send OTP"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (otp.length !== 6) {
              toast.error("Enter the 6-digit code");
              return;
            }
            setLoading(true);
            try {
              const res = await authApi.patientCompleteRegistration({
                transactionID,
                otp,
                fullName,
                dob,
                gender,
                phone,
                email,
              });
	      setAuthToken(res.token);
              setSession({
                role: "patient",
                name: res.patient.fullName,
                phone,
                id: res.patient.patientID,
              });
              toast.success("Account created");
              navigate({ to: "/patient" });
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : "Couldn't verify the code. Try again.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label>Verify OTP</Label>
            <InputOTP maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <OtpCountdown
              onResend={async () => {
                try {
                  const res = await authApi.patientInitiateRegistration(aadhaar, dob);
                  setTransactionID(res.transactionID);
                  toast.info("New OTP sent");
                } catch {
                  toast.error("Couldn't resend OTP. Try again.");
                }
              }}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </Button>
        </form>
      )}
      <div className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Your Aadhaar number is not stored. Only the verified identity flag is
        retained on the ledger.
      </div>
    </div>
  );
}

function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full ${
            i < step ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
      <span className="text-[11px] text-muted-foreground">
        Step {step} of {total}
      </span>
    </div>
  );
}
