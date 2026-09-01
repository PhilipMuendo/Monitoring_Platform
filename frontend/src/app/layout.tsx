import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/lib/providers";
import "./globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

/**
 * Icons are file-convention based, NOT declared here: src/app/icon.svg is the
 * favicon and src/app/apple-icon.png the iOS home-screen icon. Next emits the
 * <link> tags for both, so adding an `icons` key would duplicate them. Do not
 * reintroduce a favicon.ico — it wins /favicon.ico over icon.svg.
 */
export const metadata: Metadata = {
  title: {
    default: "Collective Energy Africa",
    template: "%s · Collective Energy Africa",
  },
  description: "Real-time monitoring for a distributed solar installation fleet",
  applicationName: "Collective Energy Africa",
};

/**
 * Colours the browser/OS chrome. Two values, not one — a single theme-color
 * paints light-mode brand green behind a dark page, which reads as a bug.
 * These track --brand and the dark page background.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1e0b" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
