"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Reads and writes a single search-param, so view state survives a reload and
 * travels in a shared link.
 *
 * WHY. Pagination and the history range were plain useState, which meant a
 * refresh silently threw you back to page 1 / the last 24h, and "send me the
 * link to that alert" landed the recipient somewhere else entirely. For an
 * operations tool where the normal way to escalate is to paste a URL into
 * chat, that is a functional gap rather than a nicety.
 *
 * router.replace, not push: paging a table should not stack twenty history
 * entries that the back button then has to walk through one at a time. The
 * URL tracks the view; the back button still leaves the page.
 *
 * `scroll: false` because Next otherwise jumps to the top on every param
 * change, which fights the table you are paging through.
 */
export function useQueryParam(
  key: string,
  defaultValue: string,
): [string, (next: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // The default is the absence of the param, not `?page=1`. Keeps the
      // canonical URL clean and makes "is this the default view?" a simple
      // check rather than a comparison.
      if (next === defaultValue) params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultValue, key, pathname, router, searchParams],
  );

  return [value, setValue];
}

/**
 * Same, for a param that is a positive integer (a page number, a limit).
 * Anything unparseable falls back to the default rather than propagating NaN
 * into a query key and an API request.
 */
export function useNumericQueryParam(
  key: string,
  defaultValue: number,
): [number, (next: number) => void] {
  const [raw, setRaw] = useQueryParam(key, String(defaultValue));

  const value = useMemo(() => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }, [raw, defaultValue]);

  const setValue = useCallback((next: number) => setRaw(String(next)), [setRaw]);

  return [value, setValue];
}

/**
 * Same, constrained to a fixed set of allowed values — a tab, a range picker.
 * An unrecognised value in the URL is treated as absent, so a hand-edited or
 * stale link degrades to the default view instead of rendering nothing.
 */
export function useEnumQueryParam<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T,
): [T, (next: T) => void] {
  const [raw, setRaw] = useQueryParam(key, defaultValue);
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue;
  return [value, setRaw as (next: T) => void];
}
