import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesPanel } from "@/components/dashboard/issues-panel";
import type { Alert, Role } from "@/lib/types";

const acknowledgeMock = vi.fn();
let mockAlerts: Alert[] = [];
let mockLoading = false;
let mockRole: Role = "viewer";

vi.mock("@/hooks/use-alerts", () => ({
  useActiveAlerts: () => ({ data: mockAlerts, isLoading: mockLoading }),
  useAcknowledgeAlert: () => ({
    mutate: acknowledgeMock,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    hasRole: (...roles: Role[]) => roles.includes(mockRole),
  }),
}));

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a1",
    site_id: "s1",
    site_name: "Kibera Clinic",
    type: "offline",
    severity: "critical",
    message: "No telemetry for 45 minutes",
    created_at: new Date().toISOString(),
    acknowledged: false,
    resolved_at: null,
    ...overrides,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IssuesPanel />
    </QueryClientProvider>,
  );
}

describe("IssuesPanel", () => {
  beforeEach(() => {
    mockAlerts = [];
    mockLoading = false;
    mockRole = "viewer";
    acknowledgeMock.mockReset();
  });

  it("announces the loading state to assistive tech", () => {
    mockLoading = true;
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Loading active issues");
  });

  it("says so plainly when nothing is wrong", () => {
    renderPanel();
    expect(screen.getByText("All systems normal")).toBeInTheDocument();
  });

  it("exposes its title as a real heading", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: /Active Issues/ })).toBeInTheDocument();
  });

  it("counts the active alerts in an accessible label", () => {
    mockAlerts = [alert({ id: "a1" }), alert({ id: "a2" })];
    renderPanel();
    expect(screen.getByLabelText("2 active issues")).toBeInTheDocument();
  });

  // The row was a div with role="button" wrapping another button. This is the
  // regression guard for that: navigation must be a real link.
  it("renders each alert as a link to its site", () => {
    mockAlerts = [alert()];
    renderPanel();

    const link = screen.getByRole("link", { name: "Kibera Clinic" });
    expect(link).toHaveAttribute("href", "/sites/s1");
  });

  it("hides the acknowledge control from viewers", () => {
    mockAlerts = [alert()];
    mockRole = "viewer";
    renderPanel();

    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();
  });

  it.each<Role>(["admin", "technician"])("offers acknowledge to %s", (role) => {
    mockAlerts = [alert()];
    mockRole = role;
    renderPanel();

    expect(
      screen.getByRole("button", { name: "Acknowledge Offline alert at Kibera Clinic" }),
    ).toBeInTheDocument();
  });

  it("acknowledges the alert it was pressed for", async () => {
    const user = userEvent.setup();
    mockAlerts = [alert({ id: "a1" }), alert({ id: "a2", site_name: "Mathare Depot" })];
    mockRole = "admin";
    renderPanel();

    await user.click(screen.getByRole("button", { name: /Mathare Depot/ }));

    await waitFor(() => expect(acknowledgeMock).toHaveBeenCalledTimes(1));
    expect(acknowledgeMock.mock.calls[0][0]).toBe("a2");
  });

  // A relative label is right for a glance, but the absolute instant has to
  // survive in the DOM or the timestamp is unusable in an incident review.
  it("carries the machine-readable timestamp alongside the relative one", () => {
    const created = "2026-08-30T09:15:00.000Z";
    mockAlerts = [alert({ created_at: created })];
    renderPanel();

    const time = screen.getByText(/ago|just now/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", created);
  });
});
