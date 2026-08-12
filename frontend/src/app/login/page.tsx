"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

// Split-screen sign-in: photography on the left, form on the right.
//
// This page is deliberately DARK regardless of the app's light/dark setting.
// It sits outside the authenticated shell, has no theme toggle of its own, and
// is the one screen designed around a photograph — a light variant would mean
// a second overlay treatment and a second set of contrast decisions for a
// screen nobody spends time on. The same reasoning the 3D scene uses to stay
// in its studio palette whatever the theme is.
//
// There are deliberately NO live metrics over the photo. This page is
// pre-authentication, so anything real would be operational data shown to
// anyone who can reach the URL, and anything impressive would be invented —
// which is the opposite of what a monitoring product should open with. See
// ADR 6 in docs/ARCHITECTURE.md.
export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="grid min-h-screen bg-slate-950 lg:grid-cols-5">
      {/* --- Left: photography (60%) --- */}
      {/* Hidden below lg rather than stacked: on a phone a hero image would
          push the form under the fold, and signing in is the only thing this
          screen is for. */}
      <aside className="relative hidden lg:col-span-3 lg:block">
        <Image
          src="/images/login-solar.jpg"
          alt=""
          fill
          priority
          sizes="60vw"
          className="object-cover"
        />

        {/* Two overlays, not one. The vertical scrim holds contrast for the
            wordmark at the bottom; the left-to-right gradient darkens toward
            the form panel so the seam between photo and panel is a fade
            rather than a hard edge. */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/40 to-slate-950/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-slate-950" />

        <div className="absolute inset-x-0 bottom-0 p-10">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30">
              <Sun className="size-5 text-amber-400" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">Solar Fleet Monitor</span>
          </div>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300">
            Live monitoring for distributed solar installations — generation, storage and grid
            flow across every site, from one place.
          </p>
        </div>
      </aside>

      {/* --- Right: form (40%) --- */}
      <main className="flex items-center justify-center bg-slate-900 px-6 py-12 lg:col-span-2">
        <div className="w-full max-w-sm">
          {/* Wordmark repeats here for small screens, where the left panel is
              hidden entirely and the page would otherwise be unbranded. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30">
              <Sun className="size-5 text-amber-400" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">Solar Fleet Monitor</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-white">Sign in</h1>
          <p className="mt-1.5 text-sm text-slate-400">Enter your credentials to access the fleet.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 border-slate-700 bg-slate-800/80 pl-9 text-white placeholder:text-slate-500 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/40"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 border-slate-700 bg-slate-800/80 pl-9 pr-10 text-white placeholder:text-slate-500 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  // Labelled and excluded from the tab order's happy path is
                  // wrong for a11y — it stays focusable, but screen readers
                  // need to know what it does and what state it is in.
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* role="alert" so the failure is announced, not just recoloured —
                a login error that only exists visually is invisible to anyone
                using a screen reader. */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              >
                <AlertCircle className="mt-px size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full bg-amber-500 font-medium text-slate-950 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
