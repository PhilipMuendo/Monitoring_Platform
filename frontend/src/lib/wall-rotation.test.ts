import { describe, expect, it } from "vitest";

import {
  firstReadyIndex,
  nextReadyIndex,
  readyCount,
  resolveActiveIndex,
  type RotatingPage,
} from "@/lib/wall-rotation";

const page = (id: string, ready: boolean): RotatingPage => ({ id, ready, dwellMs: 1000 });

describe("firstReadyIndex", () => {
  it("returns the first ready page from the start", () => {
    expect(firstReadyIndex([page("a", false), page("b", true), page("c", true)])).toBe(1);
  });

  it("wraps around when starting past the only ready page", () => {
    expect(firstReadyIndex([page("a", true), page("b", false)], 1)).toBe(0);
  });

  it("returns null when nothing is ready rather than defaulting to 0", () => {
    expect(firstReadyIndex([page("a", false), page("b", false)])).toBeNull();
  });

  it("returns null for an empty page list", () => {
    expect(firstReadyIndex([])).toBeNull();
  });
});

describe("nextReadyIndex", () => {
  it("advances to the next ready page", () => {
    expect(nextReadyIndex([page("a", true), page("b", true)], 0)).toBe(1);
  });

  it("skips over empty pages", () => {
    const pages = [page("a", true), page("b", false), page("c", false), page("d", true)];
    expect(nextReadyIndex(pages, 0)).toBe(3);
  });

  it("wraps past the end", () => {
    expect(nextReadyIndex([page("a", true), page("b", true)], 1)).toBe(0);
  });

  it("holds still when it is the only ready page", () => {
    const pages = [page("a", true), page("b", false)];
    expect(nextReadyIndex(pages, 0)).toBe(0);
  });

  it("holds still when no page is ready", () => {
    expect(nextReadyIndex([page("a", false), page("b", false)], 1)).toBe(1);
  });
});

describe("resolveActiveIndex", () => {
  it("keeps the stored index while that page is still ready", () => {
    expect(resolveActiveIndex([page("a", true), page("b", true)], 1)).toBe(1);
  });

  it("moves off a page that has gone empty underneath the viewer", () => {
    // The regression this exists for: the wall is showing page 1 when its
    // content disappears. Resolving during render means no frame ever shows
    // the emptied page.
    expect(resolveActiveIndex([page("a", true), page("b", false)], 1)).toBe(0);
  });

  it("falls back to 0 when nothing is ready", () => {
    expect(resolveActiveIndex([page("a", false), page("b", false)], 1)).toBe(0);
  });

  it("clamps an out-of-range index", () => {
    expect(resolveActiveIndex([page("a", true), page("b", true)], 5)).toBe(1);
  });

  it("returns 0 for an empty page list", () => {
    expect(resolveActiveIndex([], 3)).toBe(0);
  });
});

describe("readyCount", () => {
  it("counts only ready pages", () => {
    expect(readyCount([page("a", true), page("b", false), page("c", true)])).toBe(2);
  });

  it("is 0 for an empty list", () => {
    expect(readyCount([])).toBe(0);
  });
});
