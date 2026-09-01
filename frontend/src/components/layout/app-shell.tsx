"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, LayoutDashboard, LogOut, MonitorPlay, Settings } from "lucide-react";

import { ChatWidget } from "@/components/chat/chat-widget";
import { BrandLogo } from "@/components/layout/brand-logo";
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
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/admin", label: "Admin", icon: Settings, roles: ["admin"] as const },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, hasRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useAlertStream(true);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link. Every page here puts a nav bar, a theme toggle, a wall
          button and an account menu ahead of the content, which is a lot to
          tab past on every navigation. Visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* Brand green in BOTH themes — it is the company's chrome colour and
          has no light variant. Opaque, not translucent: the 3D flow panel
          renders on a fixed near-white canvas that smears through a blurred
          header in dark mode.

          Children are coloured against this surface explicitly rather than by
          scoping a `.dark` class here, because ThemeToggle keys its icon off
          that class and would freeze on the moon. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-brand text-brand-foreground">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-white">
            <BrandLogo />
          </Link>

          {/* Icon-only below sm, icon+label from sm up: three "icon + word"
              links plus the logo and avatar overflow a ~375px viewport. The
              label text is hidden visually but kept in the accessibility tree
              (see the sr-only span below). */}
          <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            {NAV_LINKS.filter((link) => !link.roles || hasRole(...link.roles)).map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3",
                    // White at 15% rather than the brand accent as a fill: the
                    // accent is reserved for things you can act on, and the
                    // current page is not one of them. It marks the active
                    // item as a bar underneath instead.
                    active
                      ? "bg-white/15 text-white shadow-[inset_0_-2px_0_0_var(--brand-accent)]"
                      : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <link.icon className="size-4 shrink-0" aria-hidden="true" />
                  {/* The label is always in the DOM — only its VISIBILITY is
                      responsive. `hidden sm:inline` removed it from the
                      accessibility tree below sm, leaving three icon links
                      with no accessible name on exactly the devices where
                      `title` never appears. sr-only keeps the name; the icon
                      still carries the meaning visually. */}
                  <span className="sr-only sm:not-sr-only sm:inline">{link.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />

            {/* Colours are stated against the header rather than left to the
                outline variant, which resolves against the PAGE theme and in
                light mode put near-black text on near-black green.

                Hidden below xl, WallSizeGate's width floor, so a phone is not
                offered a tab that can only say "too small". CSS is the right
                tool for a 40-byte anchor and the wrong one for the gate
                itself, which must not mount a 3D scene to hide it. The gate
                also has a height floor with no Tailwind equivalent, so a
                short-but-wide desktop window still lands on it. */}
            <Button
              variant="outline"
              size="sm"
              asChild
              className="hidden border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white xl:inline-flex"
            >
              <a href="/wall" target="_blank" rel="noopener noreferrer">
                <MonitorPlay className="size-4" aria-hidden="true" />
                Wall display
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* The initials are decorative — they are an abbreviation of
                    a name that is already inside the menu. Without an
                    explicit label this announced as "PM, button" and gave no
                    hint that it opens the account menu. */}
                <button
                  type="button"
                  aria-label={user ? `Account menu for ${user.name || user.email}` : "Account menu"}
                  className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Avatar className="size-8">
                    <AvatarFallback aria-hidden="true" className="bg-white/15 text-xs text-white">
                      {user ? initials(user.name || user.email) : "?"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="truncate text-sm font-medium">{user?.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">{user?.email}</div>
                  <div className="mt-0.5 text-xs font-normal capitalize text-muted-foreground">{user?.role}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await logout();
                    router.replace("/login");
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none">
        {children}
      </main>

      <ChatWidget />
    </div>
  );
}
