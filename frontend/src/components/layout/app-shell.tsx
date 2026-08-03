"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { LayoutGrid, LogOut, Moon, MonitorPlay, ShieldCheck, Sun as SunIcon, SunMedium } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useHealth } from "@/hooks/use-health";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Fleet" },
  { href: "/admin", label: "Admin", roles: ["admin"] as const },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function HeaderClock() {
  const now = useClock();
  return (
    <div className="hidden items-baseline gap-1.5 font-mono text-xs tabular-nums text-muted-foreground md:flex">
      <span className="text-foreground">
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="label-caps text-micro">Local</span>
    </div>
  );
}

function SystemStatusIndicator() {
  const { data: health } = useHealth();
  const healthy = health?.status === "healthy";
  const label = !health ? "Connecting" : healthy ? "Live" : "Degraded";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1">
          <span className="relative flex size-1.5">
            {health && (
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                  healthy ? "bg-status-online" : "bg-status-warning",
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex size-1.5 rounded-full",
                !health ? "bg-status-offline" : healthy ? "bg-status-online" : "bg-status-warning",
              )}
            />
          </span>
          <span className="label-caps hidden text-micro font-semibold text-muted-foreground sm:inline">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {health ? `Last collection ${new Date(health.metrics.last_collection).toLocaleTimeString()}` : "Waiting for telemetry link"}
      </TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? <Moon className="size-4" /> : <SunMedium className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{isDark ? "Switch to light mode" : "Switch to dark mode"}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, hasRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useAlertStream(true);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="flex h-12 items-center gap-1 px-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 pr-3">
            <span className="flex size-6 items-center justify-center rounded-sm bg-solar/15 text-solar">
              <SunIcon className="size-3.5" strokeWidth={1.75} />
            </span>
            <span className="hidden font-mono text-brand font-semibold tracking-tight sm:inline">
              SOLAR FLEET <span className="text-muted-foreground">OPS</span>
            </span>
          </Link>

          <div className="hidden h-5 w-px bg-border sm:block" />

          <nav className="flex h-full items-center gap-0.5 pl-1">
            {NAV_LINKS.filter((link) => !link.roles || hasRole(...link.roles)).map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "label-caps relative flex h-full items-center px-2.5 text-tiny font-semibold transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {link.label}
                  <span
                    className={cn(
                      "absolute inset-x-2.5 bottom-0 h-0.5 rounded-full transition-opacity",
                      active ? "bg-solar opacity-100" : "opacity-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <SystemStatusIndicator />
            <div className="hidden h-5 w-px bg-border md:block" />
            <HeaderClock />
            <div className="h-5 w-px bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href="/wall" target="_blank" rel="noopener noreferrer" aria-label="Open wall display">
                    <MonitorPlay className="size-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open wall display</TooltipContent>
            </Tooltip>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-0.5 flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-micro font-semibold">
                      {user ? initials(user.name || user.email) : "?"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="truncate text-sm font-medium">{user?.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">{user?.email}</div>
                  <div className="mt-1 flex items-center gap-1 text-micro font-normal text-muted-foreground">
                    <ShieldCheck className="size-3" />
                    <span className="label-caps">{user?.role}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/">
                    <LayoutGrid className="size-4" />
                    Fleet overview
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await logout();
                    router.replace("/login");
                  }}
                >
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-4 sm:py-5">{children}</main>
    </div>
  );
}
