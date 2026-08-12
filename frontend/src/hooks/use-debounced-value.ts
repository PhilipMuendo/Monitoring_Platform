"use client";

import { useEffect, useState } from "react";

/**
 * Trails `value` by `delayMs`, so expensive work keyed off it runs once the
 * input settles rather than on every keystroke.
 *
 * The site grid filters and re-renders a card per matching site. At 20 sites
 * that is invisible; at 100 it is a visible stutter on every character, and
 * the work is wasted anyway — nobody reads the results of a half-typed query.
 * The <input> itself stays controlled by the raw value, so typing never feels
 * laggy; only the filtering trails behind.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
