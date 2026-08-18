"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query.
 *
 * WHY A HOOK AND NOT A TAILWIND CLASS. `hidden xl:block` is the right tool
 * when both branches are cheap — the browser lays out both and paints one.
 * It is the wrong tool when one branch is expensive, because a
 * `display: none` subtree is still MOUNTED: its components run, its effects
 * fire, and its dynamic import()s are fetched. Hiding the 3D scene in CSS on
 * a phone would still cost that phone the ~860 KB scene chunk. Gating the
 * mount is the only thing that actually prevents the work.
 *
 * One MediaQueryList per distinct query, shared by every subscriber, because
 * the whole point is to avoid per-component listeners on a page that stays
 * open for weeks.
 *
 * `serverValue` is what SSR and the hydrating render report. There is no
 * honest answer there — the server does not know the viewport — so the caller
 * picks the assumption whose wrong case is cheapest. For a gate protecting an
 * expensive subtree, that is `false`: briefly withholding a heavy view from a
 * large screen costs a frame, whereas briefly mounting it on a small one
 * costs the download the gate exists to prevent.
 */

interface Store {
  mql: MediaQueryList;
  listeners: Set<() => void>;
  matches: boolean;
}

const stores = new Map<string, Store>();

function storeFor(query: string): Store {
  let store = stores.get(query);
  if (store) return store;

  const mql = window.matchMedia(query);
  store = { mql, listeners: new Set(), matches: mql.matches };
  const onChange = () => {
    // Cached rather than read through on every getSnapshot call:
    // useSyncExternalStore requires a snapshot that is referentially stable
    // between notifications, and `mql.matches` is a live getter.
    store!.matches = mql.matches;
    for (const listener of store!.listeners) listener();
  };
  mql.addEventListener("change", onChange);
  stores.set(query, store);
  return store;
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (listener) => {
      const store = storeFor(query);
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => storeFor(query).matches,
    () => serverValue,
  );
}
