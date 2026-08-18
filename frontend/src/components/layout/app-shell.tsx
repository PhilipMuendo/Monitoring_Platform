"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, MonitorPlay, Settings } from "lucide-react";

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
      {/* The brand's own near-black green, in BOTH themes — it is the
          company's chrome colour and does not have a light variant, the same
          way their site runs a dark nav over a white page.

          Solid, no backdrop-blur. The old translucent header carried a
          careful /88 opacity because the 3D flow panel renders on a fixed
          near-white canvas and smeared through it in dark mode. An opaque
          surface removes that failure mode rather than tuning around it.

          Everything inside is coloured against this surface explicitly.
          Scoping a `.dark` class here would have styled the children
          automatically, but ThemeToggle swaps its icon on that exact class
          and would have frozen on the moon. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-brand text-brand-foreground">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-white">
            <BrandLogo />
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_LINKS.filter((link) => !link.roles || hasRole(...link.roles)).map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    // White at 15% rather than the brand accent as a fill: the
                    // accent is reserved for things you can act on, and the
                    // current page is not one of them. It marks the active
                    // item as a bar underneath instead.
                    active
                      ? "bg-white/15 text-white shadow-[inset_0_-2px_0_0_var(--brand-accent)]"
                      : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <link.icon className="size-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />

            {/* The outline variant resolves its border and text against the
                page theme, which is wrong on a surface that is dark in both —
                in light mode it rendered near-black text on near-black
                green. Stated against the header instead. */}
            {/* Hidden below xl, which is WallSizeGate's width floor: on a
                phone this opened a new tab that could only say "too small".
                CSS is the right tool here and the wrong one for the gate
                itself — this is a 40-byte anchor, whereas the wall mounts a
                3D scene, so hiding it must not mean loading it.

                The gate additionally requires a minimum HEIGHT, which has no
                Tailwind breakpoint. A short-but-wide window therefore still
                shows this button and lands on the gate — deliberately, since
                that case is a resizable desktop window, not a device. */}
            <Button
              variant="outline"
              size="sm"
              asChild
              className="hidden border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white xl:inline-flex"
            >
              <a href="/wall" target="_blank" rel="noopener noreferrer">
                <MonitorPlay className="size-4" />
                Wall display
              </a>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-white/15 text-xs text-white">
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
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <ChatWidget />
    </div>
  );
}
