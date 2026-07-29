"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API_URL, ApiError, api, registerAuthHandlers, setAccessToken } from "@/lib/api-client";
import type { AuthResponse, Role, User } from "@/lib/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toUser(res: AuthResponse["user"]): User {
  return { id: res.id, email: res.email, name: res.name, role: res.role, is_active: true, created_at: "" };
}

/**
 * Refreshes the session.
 *
 * The refresh token is no longer handled by this code at all — it lives in
 * an HttpOnly cookie the browser attaches automatically, which is why every
 * call here sends `credentials: "include"` and no body. Previously it sat
 * in localStorage, where any XSS anywhere on the origin could read a
 * 30-day credential straight out of it.
 *
 * Bypasses the api-client's own 401-retry wrapper deliberately: this *is*
 * that wrapper's retry handler, so it must use a plain fetch or it recurses
 * into itself on failure.
 */
async function refreshSession(): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? "Failed to refresh session");
  }
  return res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const applyAuthResponse = useCallback((data: AuthResponse) => {
    // The access token is short-lived and kept in memory only. It is never
    // persisted, so closing the tab ends its usefulness immediately; the
    // cookie is what survives a reload.
    setAccessToken(data.access_token);
    setUser(toUser(data.user));
    setStatus("authenticated");
  }, []);

  const clearAuth = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<AuthResponse>("/api/v1/auth/login", { email, password });
      applyAuthResponse(data);
    },
    [applyAuthResponse],
  );

  const logout = useCallback(async () => {
    // The server clears the cookie; there is nothing client-side to erase
    // beyond the in-memory access token.
    await api.post("/api/v1/auth/logout", {}).catch(() => {});
    clearAuth();
  }, [clearAuth]);

  useEffect(() => {
    registerAuthHandlers({
      refresh: async () => {
        try {
          const data = await refreshSession();
          applyAuthResponse(data);
          return data.access_token;
        } catch {
          clearAuth();
          return null;
        }
      },
      logout: clearAuth,
    });

    // Bootstraps auth from the refresh cookie. We can't test for the
    // cookie's presence (that is the entire point of HttpOnly), so we
    // simply attempt a refresh: a 401 means no valid session.
    //
    // Wrapped in an async IIFE rather than an early synchronous setState so
    // every state update happens as a reaction to the refresh resolving,
    // not as a direct side effect of mounting.
    (async () => {
      try {
        const data = await refreshSession();
        applyAuthResponse(data);
      } catch {
        clearAuth();
      }
    })();
  }, [applyAuthResponse, clearAuth]);

  const hasRole = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  const value = useMemo(() => ({ user, status, login, logout, hasRole }), [user, status, login, logout, hasRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
