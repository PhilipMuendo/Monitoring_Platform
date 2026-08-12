import { describe, expect, it } from "vitest";

import { boundsKey, boundsOf, geoSites } from "@/lib/map-bounds";
import type { SiteWithStatus } from "@/lib/types";

function site(overrides: Partial<SiteWithStatus> & { id: string }): SiteWithStatus {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    brand: "deye",
    brand_site_id: overrides.id,
    location: "",
    latitude: overrides.latitude,
    longitude: overrides.longitude,
    capacity_kw: 10,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: overrides.status ?? "online",
  };
}

describe("geoSites", () => {
  it("drops sites with null or undefined coordinates", () => {
    const sites = [
      site({ id: "a", latitude: null, longitude: null }),
      site({ id: "b", latitude: -1.29, longitude: undefined }),
      site({ id: "c", latitude: -1.29, longitude: 36.82 }),
    ];
    expect(geoSites(sites).map((s) => s.id)).toEqual(["c"]);
  });

  it("drops non-finite coordinates", () => {
    const sites = [
      site({ id: "a", latitude: NaN, longitude: 36.82 }),
      site({ id: "b", latitude: -1.29, longitude: Infinity }),
      site({ id: "c", latitude: -1.29, longitude: 36.82 }),
    ];
    expect(geoSites(sites).map((s) => s.id)).toEqual(["c"]);
  });

  it("drops out-of-range coordinates", () => {
    const sites = [
      site({ id: "a", latitude: 200, longitude: 36.82 }),
      site({ id: "b", latitude: -1.29, longitude: 400 }),
      site({ id: "c", latitude: -1.29, longitude: 36.82 }),
    ];
    expect(geoSites(sites).map((s) => s.id)).toEqual(["c"]);
  });

  it("drops exactly (0, 0) as Null Island", () => {
    const sites = [
      site({ id: "a", latitude: 0, longitude: 0 }),
      site({ id: "b", latitude: -1.29, longitude: 36.82 }),
    ];
    expect(geoSites(sites).map((s) => s.id)).toEqual(["b"]);
  });

  it("returns an empty array for undefined input", () => {
    expect(geoSites(undefined)).toEqual([]);
  });
});

describe("boundsOf", () => {
  it("returns null for zero sites", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("returns a zero-area box for a single site", () => {
    const sites = geoSites([site({ id: "a", latitude: -1.29, longitude: 36.82 })]);
    expect(boundsOf(sites)).toEqual({ sw: [-1.29, 36.82], ne: [-1.29, 36.82] });
  });

  it("spans the min/max of multiple sites", () => {
    const sites = geoSites([
      site({ id: "a", latitude: -1.29, longitude: 36.82 }),
      site({ id: "b", latitude: -4.05, longitude: 39.67 }),
      site({ id: "c", latitude: 0.51, longitude: 35.27 }),
    ]);
    expect(boundsOf(sites)).toEqual({ sw: [-4.05, 35.27], ne: [0.51, 39.67] });
  });
});

describe("boundsKey", () => {
  it("is stable across two structurally-equal-but-distinct arrays", () => {
    const a = geoSites([site({ id: "a", latitude: -1.29, longitude: 36.82 })]);
    const b = geoSites([site({ id: "a", latitude: -1.29, longitude: 36.82 })]);
    expect(a).not.toBe(b);
    expect(boundsKey(a)).toBe(boundsKey(b));
  });

  it("changes when a coordinate changes", () => {
    const before = geoSites([site({ id: "a", latitude: -1.29, longitude: 36.82 })]);
    const after = geoSites([site({ id: "a", latitude: -1.3, longitude: 36.82 })]);
    expect(boundsKey(before)).not.toBe(boundsKey(after));
  });

  it("is order-independent", () => {
    const sites1 = geoSites([
      site({ id: "a", latitude: -1.29, longitude: 36.82 }),
      site({ id: "b", latitude: -4.05, longitude: 39.67 }),
    ]);
    const sites2 = geoSites([
      site({ id: "b", latitude: -4.05, longitude: 39.67 }),
      site({ id: "a", latitude: -1.29, longitude: 36.82 }),
    ]);
    expect(boundsKey(sites1)).toBe(boundsKey(sites2));
  });
});
