"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, MonitorPlay, Settings, Sun } from "lucide-react";

import { ChatWidget } from "@/components/chat/chat-widget";
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
      {/* /88 rather than /60 under backdrop-filter: the 3D flow panel renders
          on a fixed near-white canvas in both themes, and at 60% opacity that
          bright block smeared through the header in dark mode — visibly
          lighter across the left half than the right. */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/88">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Sun className="size-5 text-solar" />
            <span className="hidden sm:inline">Solar Fleet Monitor</span>
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
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <link.icon className="size-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />

            <Button variant="outline" size="sm" asChild>
              <a href="/wall" target="_blank" rel="noopener noreferrer">
                <MonitorPlay className="size-4" />
                Wall display
              </a>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">{user ? initials(user.name || user.email) : "?"}</AvatarFallback>
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
