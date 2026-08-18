"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * How many fixed-height rows actually fit in a container.
 *
 * WHY NOT A CONSTANT. The wall's "Needs Attention" list used a hardcoded
 * PAGE_SIZE of 6 and gave each row `flex-1 min-h-0`, which let the rows shrink
 * without limit while their contents — a site name above a status badge — did
 * not. On a panel with less vertical room than the layout assumed, the rows
 * collapsed to less than their own content height and the text of one row
 * rendered on top of the next. Not clipped, not scrolled: overlapping and
 * unreadable.
 *
 * That is not a number anyone can pick correctly in advance, because the wall
 * is whatever screen the office mounted. A 1080p panel fits six rows, a 4K one
 * fits far more, and the same layout on a short window fits three. Measuring
 * is the only answer that is right on all of them, and it costs one
 * ResizeObserver on a page that lays out once and then sits there.
 *
 * Returns `min` until the container has been measured, so the first paint
 * shows a plausible list rather than nothing.
 */
export function useFittedRows(
  ref: RefObject<HTMLElement | null>,
  { rowPx, gapPx = 0, min = 1, max = 20 }: { rowPx: number; gapPx?: number; min?: number; max?: number },
): number {
  const [count, setCount] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const height = el.clientHeight;
      if (height <= 0) return;
      // n rows occupy n*rowPx + (n-1)*gapPx, so solve for n and floor it.
      const fitted = Math.floor((height + gapPx) / (rowPx + gapPx));
      setCount(Math.max(min, Math.min(max, fitted)));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [ref, rowPx, gapPx, min, max]);

  return count;
}
