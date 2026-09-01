"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { safeRedirect } from "@/lib/safe-redirect";

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

/**
 * A 20px-wide encoding of the photograph, painted underneath it.
 *
 * 132 bytes, so it is inlined rather than fetched — it costs no request and
 * appears in the same frame as the markup, which means the panel is never an
 * empty rectangle. The browser scales it up; at that size the upscaling is the
 * blur, so no filter is involved.
 *
 * Regenerate with `node scripts/build-login-image.mjs` whenever
 * assets/login-solar.jpg changes; the script prints the replacement string.
 */
const LOGIN_IMAGE_BLUR =
  "data:image/webp;base64,UklGRnwAAABXRUJQVlA4IHAAAADwAwCdASoUAAwAPu1iqU2ppaOiMAgBMB2JagCdEf/gOwSrG6PIrvj+AP7ZfPWnaNNok9YdBrM+/RJG6aGim2Kt+SKFr6EUOe7rtp9rRKQdhSm/jwLUaV4gkr4rAKBF9Q1VxkCNwGkC2pw8JuNcAAAA";

function LoginScreen() {
  const { status, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where RequireAuth wanted to send them before the session ran out.
  // safeRedirect rejects anything that is not a same-origin path, so a
  // crafted ?next= cannot bounce a just-authenticated user off-site.
  const next = safeRedirect(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to log in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Brand surfaces rather than neutral slate. This page was already
    // committed to being dark whatever the theme, which is exactly the
    // condition the brand's own chrome colour is designed for.
    //
    // `dark` is on the root so the TOKENS resolve to their dark values here
    // regardless of the app theme. Without it a light-themed visitor got the
    // light --brand-accent, which is darkened for legibility on white and
    // measures only 3.85:1 against this near-black green. The header cannot
    // use this trick because ThemeToggle keys its icon off the same class;
    // this page has no toggle, so nothing objects.
    <div className="dark grid min-h-screen bg-brand lg:grid-cols-5">
      {/* --- Left: photography (60%) --- */}
      {/* Hidden below lg rather than stacked: on a phone a hero image would
          push the form under the fold, and signing in is the only thing this
          screen is for. */}
      <aside className="relative hidden lg:col-span-3 lg:block">
        {/* A plain <img>, deliberately, not next/image.
            next/image resizes and re-encodes on demand and caches the result
            in .next/cache/images — which is empty on every container start, so
            the first person to open the login page after a deploy waited for
            it. Measured on the 3840x2372 master: 628 ms of server CPU at
            1200px, 1410 ms at 2048px, before any image bytes were sent.
            This page has one image at one aspect ratio that cannot change
            between builds, so there is nothing for a runtime optimizer to
            decide. scripts/build-login-image.mjs does the work at authoring
            time and these files are served straight off disk.
            The widths match what 60vw can actually request between the lg
            breakpoint and a 1440p screen at DPR 2 — see that script. */}
        {/* The <picture> is not about formats — it is how the photo is kept
            off phones entirely. This panel is `hidden` below lg, but a
            display:none <img> is still downloaded, so a phone was paying 135 KB
            for something it never renders. Sources are tried in order: above lg
            the first matches and serves the photograph; below it, the second
            (no media, so it always matches) serves a 1x1 transparent GIF and
            the photograph is never requested. The <img>'s own src is the
            last-resort fallback for a browser with no <picture> support. */}
        {/* `contents` so the wrapper generates no box of its own — the <img>
            inside is absolutely positioned against the <aside>, and an inline
            <picture> would otherwise leave an empty line box in the flow.
            Source selection is a DOM mechanism, unaffected by display. */}
        <picture className="contents">
          <source
            media="(min-width: 1024px)"
            srcSet="/images/login-solar-1280.webp 1280w, /images/login-solar-1920.webp 1920w, /images/login-solar-2560.webp 2560w"
            sizes="60vw"
          />
          <source srcSet="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <img
            src="/images/login-solar-1280.webp"
            alt=""
            // High priority and eager: this is the page's largest paint and
            // there is nothing above it competing for bandwidth.
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            // The placeholder sits behind the image on the same element, so it
            // is covered the instant the real one decodes — no second element
            // to fade out, and no state to track.
            style={{
              backgroundImage: `url("${LOGIN_IMAGE_BLUR}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </picture>

        {/* ONE overlay, and it only does the job that needs doing: holding
            contrast under the wordmark.

            There used to be a second, horizontal one —
            `from-transparent via-transparent to-brand-elevated` — meant to
            dissolve the seam between photo and form panel. It did not read as
            a seam treatment. Tailwind spaces a three-stop gradient at 0/50/100%,
            so that ramp ran across the RIGHT HALF of the photograph, and every
            pixel of it was compositing a desaturated dark green over sky and
            field while the vertical scrim below was laying more green over the
            same pixels. Two translucent greens over a photo across 400-odd
            pixels is not a fade, it is a smear, and it read as a rendering
            fault rather than as a decision.

            The seam is now a HARD EDGE, which is the honest shape of this
            layout: the photo and the form are separate grid columns, so there
            is already a real boundary there. A crisp line between a bright sky
            and a near-black panel looks deliberate; a 400px mush cannot.

            The vertical scrim stays because it is functional rather than
            decorative — the wordmark and strapline sit on the photograph and
            need something to sit on. It is now confined to the bottom ~45%
            with explicit stops, instead of tinting the whole frame: above that
            line the sky is the photographer's, not ours.

            Tuned to THIS photograph, which measures mean luminance 81 — dark
            already. The previous image was 145 and needed a much heavier scrim
            (95/40/20); reusing that here would have buried the picture for no
            contrast gain. See public/images/ATTRIBUTION.md, and re-check these
            numbers if the image is swapped. */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand/95 from-0% via-brand/45 via-18% to-transparent to-45%" />

        <div className="absolute inset-x-0 bottom-0 p-10">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-accent/15 ring-1 ring-brand-accent/40">
              <Sun className="size-5 text-brand-accent" />
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
      <main className="flex items-center justify-center bg-brand-elevated px-6 py-12 lg:col-span-2">
        <div className="w-full max-w-sm">
          {/* Wordmark repeats here for small screens, where the left panel is
              hidden entirely and the page would otherwise be unbranded. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-accent/15 ring-1 ring-brand-accent/40">
              <Sun className="size-5 text-brand-accent" />
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
                  className="h-11 border-slate-700 bg-slate-800/80 pl-9 text-white placeholder:text-slate-500 focus-visible:border-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/40"
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
                  className="h-11 border-slate-700 bg-slate-800/80 pl-9 pr-10 text-white placeholder:text-slate-500 focus-visible:border-brand-accent focus-visible:ring-2 focus-visible:ring-brand-accent/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  // Labelled and excluded from the tab order's happy path is
                  // wrong for a11y — it stays focusable, but screen readers
                  // need to know what it does and what state it is in.
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40"
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
              // No colour classes: under the `dark` scope on this page the
              // default variant already resolves --primary to the bright
              // brand green with a near-black label (4.94:1). Hardcoding it
              // here would be a second place to update.
              className="h-11 w-full font-medium disabled:opacity-60"
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

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary above it. The fallback is the
  // page's own background so the transition is invisible rather than a flash
  // of white on a dark screen.
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-brand" />}>
      <LoginScreen />
    </Suspense>
  );
}
