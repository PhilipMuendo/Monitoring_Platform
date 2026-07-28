"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API_URL, ApiError, api, registerAuthHandlers, setAccessToken } from "@/lib/api-client";
import type { AuthResponse, Role, User } from "@/lib/types";

const REFRESH_TOKEN_KEY = "solar_monitor_refresh_token";

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

// Bypasses the api-client's own 401-retry wrapper — this *is* that
// wrapper's retry handler, so it must talk to the refresh endpoint with a
// plain fetch to avoid recursing into itself on failure.
async function refreshWithToken(refreshToken: string): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
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
    setAccessToken(data.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    setUser(toUser(data.user));
    setStatus("authenticated");
  }, []);

  const clearAuth = useCallback(() => {
    setAccessToken(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
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
    const token = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (token) {
      await api.post("/api/v1/auth/logout", { refresh_token: token }).catch(() => {});
    }
    clearAuth();
  }, [clearAuth]);

  useEffect(() => {
    registerAuthHandlers({
      refresh: async () => {
        const token = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!token) return null;
        try {
          const data = await refreshWithToken(token);
          applyAuthResponse(data);
          return data.access_token;
        } catch {
          clearAuth();
          return null;
        }
      },
      logout: clearAuth,
    });

    // Bootstraps auth from the persisted refresh token. Wrapped in an
    // async IIFE (rather than an early synchronous setState) so every
    // state update happens as a reaction to the token check/refresh
    // resolving, not as a direct side effect of mounting.
    (async () => {
      const token = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!token) {
        setStatus("unauthenticated");
        return;
      }
      try {
        const data = await refreshWithToken(token);
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
