"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Install this app" — the browser's own prompt, offered on our terms.
 *
 * WHAT A BROWSER WILL AND WILL NOT LET YOU DO. You cannot make the native
 * install dialog appear on page load. Chrome fires `beforeinstallprompt`, and
 * the deferred event's `.prompt()` may only be called from a USER GESTURE;
 * calling it on mount is ignored and burns the event. So "offer it the moment
 * they open the app" means: show OUR banner immediately, and the native dialog
 * opens when they tap it. That is the whole design, and it is also the better
 * experience — an unprompted system dialog on first visit is what people
 * dismiss reflexively.
 *
 * Chrome only fires the event at all when every installability condition is
 * met: a manifest with 192px and 512px icons, a service worker with a fetch
 * handler, and a SECURE CONTEXT.
 *
 * That last one is the live blocker: this deployment has no TLS, so in
 * production the event never fires and this component renders nothing. It is
 * not broken — it is correctly waiting for https. On localhost it works today,
 * which is how it was tested.
 *
 * iOS is a separate path entirely. Safari has never implemented
 * `beforeinstallprompt` and there is no API to trigger installation, so the
 * only honest thing to offer an iPhone is the manual route through the Share
 * sheet. Detected rather than assumed, and shown as instructions rather than
 * as a button that cannot work.
 */

/** The Chrome-only event. Not in lib.dom, so it is declared here. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "install-prompt-dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's non-standard flag, the only way to detect an installed iOS app.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so the touch-point check is what
  // separates an iPad from a desktop Safari that cannot install at all.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [hidden, setHidden] = useState(true);

  // The wall display is an unattended kiosk. A banner there would sit on
  // screen for weeks with nobody to dismiss it — and installing the app is
  // meaningless on a TV that boots into a browser anyway.
  const isKiosk = pathname === "/wall";

  useEffect(() => {
    if (isKiosk) return;
    // Already installed, or previously dismissed. Re-offering an install to
    // someone running the installed app is the most obviously broken thing
    // this component could do.
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      // Private mode. Treat as not dismissed rather than failing shut.
    }

    if (isIOS()) {
      // Deferred via queueMicrotask rather than set straight from the effect
      // body, so the update reads as a reaction to probing the user agent
      // instead of a cascading render on mount — the same pattern and the
      // same lint rule (react-hooks/set-state-in-effect) as
      // usePowerFlowViewMode and lib/auth-context.
      queueMicrotask(() => {
        setShowIOSHelp(true);
        setHidden(false);
      });
      return;
    }

    const onPrompt = (e: Event) => {
      // Without preventDefault Chrome shows its own mini-infobar and this
      // banner becomes a second, competing offer.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Fired when installation completes by any route, including the browser
    // menu rather than this banner.
    const onInstalled = () => setHidden(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [isKiosk]);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to do; it will simply be offered again next session.
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use. Whatever they chose, it cannot be prompted
    // again with this instance, so the banner goes either way — leaving it up
    // after a dismissal offers a button that now does nothing.
    setDeferred(null);
    setHidden(true);
    if (outcome === "dismissed") {
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        /* see dismiss() */
      }
    }
  }

  if (isKiosk || hidden || (!deferred && !showIOSHelp)) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Collective Energy Africa"
      className={cn(
        "fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border bg-card p-4 shadow-lg",
        "animate-in fade-in slide-in-from-bottom-4 duration-300",
        // The wall display is a kiosk in a browser; an install banner over it
        // would sit there for weeks with nobody to dismiss it.
        "print:hidden",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand">
          <Download className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install the app</p>
          {showIOSHelp ? (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              Tap <Share className="inline size-4" aria-label="the Share button" /> then
              <span className="font-medium text-foreground">Add to Home Screen</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Open it full screen from your home screen, and keep working when the
              connection drops.
            </p>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {!showIOSHelp && (
        <Button onClick={install} className="mt-3 w-full">
          Install
        </Button>
      )}
    </div>
  );
}
