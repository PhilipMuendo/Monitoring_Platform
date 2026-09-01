"use client";

import { Component, type ReactNode } from "react";

/**
 * Catches render/lifecycle errors in a subtree and shows `fallback` instead
 * of letting the failure unmount the whole tree.
 *
 * React offers no hook equivalent — error boundaries must be class
 * components — so this is the one class in the codebase.
 *
 * `resetKey` remounts the subtree when it changes, which is what makes a
 * "Try again" button possible: the caller bumps the key and the children get
 * a fresh mount rather than re-throwing from the same broken state.
 */
interface Props {
  children: ReactNode;
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  resetKey?: unknown;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(error, this.reset) : fallback;
  }
}
