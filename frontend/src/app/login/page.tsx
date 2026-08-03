"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to log in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background bg-grid-pattern px-4 text-foreground">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-9 items-center justify-center rounded-sm bg-solar/15 text-solar">
            <Sun className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="font-mono text-base font-semibold tracking-tight">
              SOLAR FLEET <span className="text-muted-foreground">OPS</span>
            </h1>
            <p className="label-caps mt-1 text-tiny text-muted-foreground">Distributed generation monitoring</p>
          </div>
        </div>

        <div className="border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <p className="label-caps text-tiny font-semibold text-muted-foreground">Operator sign-in</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="label-caps text-tiny text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="label-caps text-tiny text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            {error && <p className="border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </div>

        <p className="label-caps mt-4 text-center text-micro text-muted-foreground">Authorized personnel only</p>
      </div>
    </div>
  );
}
