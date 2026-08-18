"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js. Renders nothing.
 *
 * PRODUCTION ONLY, and that is not caution — it is the difference between a
 * working dev server and a baffling one. A service worker that has cached the
 * app shell will happily serve it over the top of Next's hot reload, so edits
 * appear not to apply and the fix ("unregister the worker in DevTools") is
 * something nobody guesses on the first afternoon.
 *
 * Registered after `load` rather than on mount: registration competes for
 * bandwidth with the page's own first paint, and on the visit where it
 * actually matters (the first one) it would be delaying the thing it exists
 * to speed up on later visits.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration must never surface to the user. Everything
        // the worker provides is an enhancement — offline, install — and the
        // app is fully functional without it. The usual cause is an insecure
        // context, which is exactly the current production state.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
