import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AlertStatus, AlertTypeBadge, alertTypeLabel } from "@/components/alerts/alert-display";
import type { Alert } from "@/lib/types";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a1",
    site_id: "s1",
    site_name: "Kibera Clinic",
    type: "offline",
    severity: "critical",
    message: "No telemetry for 45 minutes",
    created_at: "2026-08-30T09:15:00Z",
    resolved_at: null,
    acknowledged: false,
    ...overrides,
  } as Alert;
}

describe("alertTypeLabel", () => {
  it("names every known type", () => {
    expect(alertTypeLabel("offline")).toBe("Offline");
    expect(alertTypeLabel("fault")).toBe("Fault");
    expect(alertTypeLabel("production_drop")).toBe("Production drop");
    expect(alertTypeLabel("battery_issue")).toBe("Battery");
  });

  // This module replaced three verbatim copies of the same map. An unknown
  // type must degrade to the raw value rather than rendering "undefined",
  // which is what a divergent copy would eventually have produced.
  it("falls back to the raw value for an unknown type", () => {
    expect(alertTypeLabel("inverter_meltdown")).toBe("inverter_meltdown");
  });
});

describe("AlertTypeBadge", () => {
  it("labels the alert type", () => {
    render(<AlertTypeBadge alert={alert({ type: "production_drop" })} />);
    expect(screen.getByText("Production drop")).toBeInTheDocument();
  });

  it("can render without its icon", () => {
    const { container } = render(<AlertTypeBadge alert={alert()} showIcon={false} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("hides its icon from assistive tech when shown", () => {
    const { container } = render(<AlertTypeBadge alert={alert()} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("AlertStatus", () => {
  it("reads Active while unresolved", () => {
    render(<AlertStatus alert={alert()} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("reads Resolved once resolved but unacknowledged", () => {
    render(<AlertStatus alert={alert({ resolved_at: "2026-08-30T10:00:00Z" })} />);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  // Acknowledged only means anything on a resolved alert; an active alert
  // that someone has acked still reads Active, because it is still wrong.
  it("reads Acknowledged for a resolved, acknowledged alert", () => {
    render(<AlertStatus alert={alert({ resolved_at: "2026-08-30T10:00:00Z", acknowledged: true })} />);
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
  });

  it("still reads Active for an acknowledged but unresolved alert", () => {
    render(<AlertStatus alert={alert({ acknowledged: true })} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
