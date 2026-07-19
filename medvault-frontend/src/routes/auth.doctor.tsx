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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setSession } from "@/lib/session";
import { authApi, ApiError } from "@/lib/api";
import { setAuthToken } from "@/lib/auth-token";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/doctor")({
  head: () => ({
    meta: [
      { title: "Doctor sign-in — MedVault" },
      {
        name: "description",
        content:
          "Clinician sign-in for MedVault — password or OTP, provisioned by your hospital.",
      },
    ],
  }),
  component: DoctorAuth,
});

function DoctorAuth() {
  const navigate = useNavigate();

  const signIn = (doctorID: string, token: string) => {
    setAuthToken(token);
    setSession({
      role: "doctor",
      name: doctorID, // real display name isn't returned by login; profile fetch can update this later
      id: doctorID,
    });
    navigate({ to: "/doctor" });
  };

  return (
    <AuthShell
      title="Clinician sign-in"
      subtitle="Doctors are provisioned by their hospital. Choose your preferred method."
    >
      <Tabs defaultValue="password">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">OTP</TabsTrigger>
        </TabsList>
        <TabsContent value="password" className="mt-6">
          <PasswordForm onSuccess={signIn} />
        </TabsContent>
        <TabsContent value="otp" className="mt-6">
          <OtpForm onSuccess={signIn} />
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
        <span>New to MedVault?</span>
        <RegisterDialog />
      </div>
    </AuthShell>
  );
}

function PasswordForm({ onSuccess }: { onSuccess: (doctorID: string, token: string) => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!id || !pw) {
          toast.error("Enter your credentials");
          return;
        }
        setLoading(true);
        try {
          const res = await authApi.doctorLoginPassword(id, pw);
          onSuccess(res.doctorID, res.token);
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : "Sign-in failed. Check your credentials and try again.",
          );
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="id">Phone or email</Label>
        <Input
          id="id"
          placeholder="doctor@hospital.org"
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="pw">Password</Label>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => toast.info("Password reset link sent")}
          >
            Forgot password
          </button>
        </div>
        <Input
          id="pw"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function OtpForm({ onSuccess }: { onSuccess: (doctorID: string, token: string) => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  return step === "phone" ? (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (phone.length < 10) {
          toast.error("Enter your registered phone");
          return;
        }
        setLoading(true);
        try {
          await authApi.doctorOtpInitiate(phone);
          toast.success("OTP sent");
          setStep("otp");
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : "Couldn't send OTP. Try again.",
          );
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="phone">Registered phone</Label>
        <Input
          id="phone"
          inputMode="numeric"
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
          const res = await authApi.doctorOtpVerify(phone, otp);
          onSuccess(res.doctorID, res.token);
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
        <Label>Enter code</Label>
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
              await authApi.doctorOtpInitiate(phone);
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
    </form>
  );
}

function RegisterDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    licenseNumber: "",
    hospitalID: "",
    specialization: "",
  });

  const update = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs font-medium text-primary hover:underline">
          Register as a doctor
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Doctor registration</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { fullName, phone, email, password, licenseNumber, hospitalID, specialization } = fields;
            if (!fullName || !phone || !email || !password || !licenseNumber || !hospitalID || !specialization) {
              toast.error("Fill in every field");
              return;
            }
            setLoading(true);
            try {
              await authApi.doctorRegister(fields);
              setOpen(false);
              toast.success("Registration submitted", {
                description: "Your hospital admin will review shortly.",
              });
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : "Registration failed. Check the details and try again.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <Field label="Full name" placeholder="Dr. Full name" value={fields.fullName} onChange={update("fullName")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" placeholder="10-digit mobile" value={fields.phone} onChange={update("phone")} />
            <Field label="Email" placeholder="you@hospital.org" value={fields.email} onChange={update("email")} />
          </div>
          <Field label="Password" type="password" value={fields.password} onChange={update("password")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="NMC License #" placeholder="e.g. NMC-12345" value={fields.licenseNumber} onChange={update("licenseNumber")} />
            <Field label="Hospital ID / Name" placeholder="AIIMS Delhi" value={fields.hospitalID} onChange={update("hospitalID")} />
          </div>
          <Field label="Specialization" placeholder="Cardiology" value={fields.specialization} onChange={update("specialization")} />
          <DialogFooter className="mt-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Submitting…" : "Submit registration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  ...rest
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input {...rest} />
    </div>
  );
}
