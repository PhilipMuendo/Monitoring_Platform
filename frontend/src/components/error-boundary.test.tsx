import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error("scene exploded");
  return <p>rendered fine</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs the caught error to console.error by design. Silencing it
    // keeps the test output readable without hiding a real assertion.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("rendered fine")).toBeInTheDocument();
  });

  // The whole reason the boundary exists: a WebGL failure must degrade to the
  // 2D diagram rather than taking the dashboard down with it.
  it("renders the fallback instead of propagating a render error", () => {
    render(
      <ErrorBoundary fallback={<p>2D fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("2D fallback")).toBeInTheDocument();
    expect(screen.queryByText("rendered fine")).not.toBeInTheDocument();
  });

  it("passes the error and a reset callback to a function fallback", () => {
    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: scene exploded")).toBeInTheDocument();
  });

  it("reports the error to onError", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("scene exploded");
  });

  it("recovers when the reset callback is invoked and the child no longer throws", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <ErrorBoundary
          fallback={(_error, reset) => (
            <button
              onClick={() => {
                setBroken(false);
                reset();
              }}
            >
              Try again
            </button>
          )}
        >
          <Boom shouldThrow={broken} />
        </ErrorBoundary>
      );
    }

    render(<Harness />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("rendered fine")).toBeInTheDocument();
  });

  // resetKey is what lets the power-flow panel retry on its own when the
  // scene it was handed changes, without the user pressing anything.
  it("clears the error when resetKey changes", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [key, setKey] = useState(0);
      return (
        <>
          <button onClick={() => setKey((k) => k + 1)}>next scene</button>
          <ErrorBoundary resetKey={key} fallback={<p>fallback</p>}>
            <Boom shouldThrow={key === 0} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByText("fallback")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "next scene" }));

    expect(screen.getByText("rendered fine")).toBeInTheDocument();
  });
});
