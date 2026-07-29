"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

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
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="size-8"
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </Button>
  );
}
