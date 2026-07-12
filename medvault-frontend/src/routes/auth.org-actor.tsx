import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "@/components/shared/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setSession, type Org } from "@/lib/session";
import { authApi, ApiError } from "@/lib/api";
import { setAuthToken } from "@/lib/auth-token";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

// UI shows the friendly org name; the backend expects the MSP identifier.
const ORG_TO_MSP: Record<Exclude<Org, "Research">, "PharmacyMSP" | "LaboratoryMSP" | "GovernanceMSP"> = {
  Pharmacy: "PharmacyMSP",
  Laboratory: "LaboratoryMSP",
  Governance: "GovernanceMSP",
};
const MSP_TO_ORG: Record<string, Org> = {
  PharmacyMSP: "Pharmacy",
  LaboratoryMSP: "Laboratory",
  GovernanceMSP: "Governance",
};

export const Route = createFileRoute("/auth/org-actor")({
  head: () => ({
    meta: [
      { title: "Organization sign-in — MedVault" },
      {
        name: "description",
        content:
          "One sign-in for Pharmacy, Laboratory and Governance staff. The org you pick decides the workspace.",
      },
    ],
  }),
  component: OrgActorAuth,
});

function OrgActorAuth() {
  return (
    <AuthShell
      title="Organization staff sign-in"
      subtitle="Same form for Pharmacy, Laboratory and Governance — pick your org."
    >
      <Tabs defaultValue="login">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
        </TabsList>
        <TabsContent value="login" className="mt-6">
          <OrgForm mode="login" />
        </TabsContent>
        <TabsContent value="register" className="mt-6">
          <OrgForm mode="register" />
        </TabsContent>
      </Tabs>
    </AuthShell>
  );
}

function OrgForm({ mode }: { mode: "login" | "register" }) {
  const [org, setOrg] = useState<Org>("Pharmacy");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (org === "Research") {
          toast.error("Research is not yet available");
          return;
        }
        if (!phone || !pw) {
          toast.error("Enter phone and password");
          return;
        }
        if (mode === "register" && (!name || !email)) {
          toast.error("Enter your full name and work email");
          return;
        }
        setLoading(true);
        try {
          if (mode === "register") {
            await authApi.orgActorRegister({
              fullName: name,
              org: ORG_TO_MSP[org],
              phone,
              email,
              password: pw,
            });
            toast.success("Account created. You can now sign in.");
            setLoading(false);
            return;
          }
          const res = await authApi.orgActorLogin(phone, pw);
          setAuthToken(res.token);
          setSession({
            role: "org-actor",
            name: name || `${MSP_TO_ORG[res.org] ?? org} Staff`,
            phone,
            email,
            org: MSP_TO_ORG[res.org] ?? org,
            id: res.actorID,
          });
          toast.success(`Signed in as ${MSP_TO_ORG[res.org] ?? org} staff`);
          navigate({ to: "/org" });
        } catch (err) {
          toast.error(
            err instanceof ApiError
              ? err.message
              : mode === "register"
                ? "Registration failed. Check the details and try again."
                : "Sign-in failed. Check your credentials and try again.",
          );
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-4">
        <Label className="flex items-center gap-2 text-sm font-medium text-primary">
          <Building2 className="h-4 w-4" />
          I am {mode === "register" ? "registering" : "signing in"} as…
        </Label>
        <Select value={org} onValueChange={(v) => setOrg(v as Org)}>
          <SelectTrigger className="h-11 bg-surface text-base font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Pharmacy">Pharmacy staff</SelectItem>
            <SelectItem value="Laboratory">Laboratory staff</SelectItem>
            <SelectItem value="Governance">Governance</SelectItem>
            <SelectItem value="Research" disabled>
              <div className="flex items-center gap-2">
                Research
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Coming soon
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "register" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          inputMode="numeric"
          value={phone}
          onChange={(e) =>
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw">Password</Label>
        <Input
          id="pw"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading
          ? mode === "register"
            ? "Creating…"
            : "Signing in…"
          : mode === "register"
            ? "Create account"
            : "Sign in"}
      </Button>
    </form>
  );
}
