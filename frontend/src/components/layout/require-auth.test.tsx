import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "@/components/layout/require-auth";

const replaceMock = vi.fn();
let mockStatus: "loading" | "authenticated" | "unauthenticated" = "loading";
let mockPathname = "/";
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ status: mockStatus }),
}));

describe("RequireAuth", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    mockStatus = "loading";
    mockPathname = "/";
    mockSearch = "";
  });

  it("withholds children while the session is being checked", () => {
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    expect(screen.queryByText("fleet data")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders children once authenticated", () => {
    mockStatus = "authenticated";
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    expect(screen.getByText("fleet data")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to a bare /login from the dashboard", async () => {
    mockStatus = "unauthenticated";
    mockPathname = "/";
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
  });

  // The regression this was written for: a session expiring on a deep page
  // used to drop the user at the dashboard, losing where they were.
  it("remembers a deep path across the sign-in round trip", async () => {
    mockStatus = "unauthenticated";
    mockPathname = "/sites/abc-123";
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/login?next=%2Fsites%2Fabc-123"),
    );
  });

  it("carries the query string too, so the view survives as well as the page", async () => {
    mockStatus = "unauthenticated";
    mockPathname = "/sites/abc-123";
    mockSearch = "range=7d";
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/login?next=%2Fsites%2Fabc-123%3Frange%3D7d"),
    );
  });

  it("never renders children while unauthenticated, even mid-redirect", () => {
    mockStatus = "unauthenticated";
    render(
      <RequireAuth>
        <p>fleet data</p>
      </RequireAuth>,
    );

    expect(screen.queryByText("fleet data")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Redirecting to sign in");
  });
});
