"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch.
 *
 * Both icons are always rendered and swapped purely by CSS on the `.dark`
 * class that next-themes puts on <html> before first paint. That avoids the
 * usual "wait for mount then pick an icon" dance, which both flashes the
 * wrong icon and trips react-hooks/set-state-in-effect. Reading
 * resolvedTheme inside the click handler is safe — handlers only ever run
 * after hydration, so it can't cause a mismatch.
 */
// `className` exists so the header can override the ghost variant's colours:
// that variant resolves against --foreground/--accent, and the header now
// renders on the brand's dark green in BOTH themes, where light-mode
// foreground would be near-invisible.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn("size-8", className)}
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </Button>
  );
}
