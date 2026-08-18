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
 * The company name is the tab title; the product name is the subtitle.
 *
 * `template` applies to any route that sets its own `title`. None do today,
 * so every tab currently reads the default — but a tab strip with eight of
 * these open is the case that matters, and putting the company first means the
 * favicon and the first word agree.
 *
 * Icons are file-convention based, not declared here: src/app/icon.svg is the
 * favicon and src/app/apple-icon.png the iOS home-screen icon. Next discovers
 * both and emits the <link> tags, so adding an `icons` key would produce
 * duplicates. The stock create-next-app favicon.ico was REMOVED rather than
 * left in place — while it existed it kept winning /favicon.ico, so the tab
 * showed the Next.js logo no matter what icon.svg contained.
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
 * Colours the browser/OS chrome around the app.
 *
 * Two values, not one: a single theme-color paints the light-mode brand green
 * behind a dark-mode page, which reads as a rendering fault rather than as
 * branding. These match --brand and the dark page background respectively.
 *
 * viewportFit=cover so the installed app can paint into an iPhone's safe-area
 * insets instead of being letterboxed by white bars.
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
