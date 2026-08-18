import type { MetadataRoute } from "next";

/**
 * The web app manifest, served at /manifest.webmanifest by Next's file
 * convention.
 *
 * This is one of the three things Chrome requires before it will offer to
 * install the app at all. The other two are a service worker with a fetch
 * handler (public/sw.js) and a SECURE CONTEXT — https, or localhost. That last
 * one is not satisfied by the current deployment: there is no TLS anywhere
 * yet, so the install prompt will not appear in production until there is.
 * Everything here is correct and inert until then; see InstallPrompt.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Collective Energy Africa",
    short_name: "CEA Monitor",
    description: "Real-time monitoring for a distributed solar installation fleet",

    // start_url is the dashboard rather than "/" with a query string. A
    // launched app should land where the user works, and tracking params in
    // start_url are a common way to end up with two separate installed
    // entries for the same app.
    start_url: "/",
    scope: "/",

    // standalone, not fullscreen: this is a working tool that people
    // cross-reference with other apps, so it keeps the status bar and the
    // system back gesture. fullscreen belongs to the wall display, which is a
    // browser in kiosk mode rather than an installed app.
    display: "standalone",
    orientation: "any",

    // Matches --brand (#0b1e0b), the header colour, so the OS chrome around
    // the app continues the header instead of framing it in white.
    theme_color: "#0b1e0b",
    // The app's own page background in light mode. Shown on the splash screen
    // before the first paint, so a mismatch here reads as a flash.
    background_color: "#ffffff",

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable entry, inset to 62%. Android crops icons to the
      // launcher's shape; the same artwork declared "any" would have its ring
      // sliced by a circular mask. Declaring one file as BOTH any and
      // maskable is the usual mistake — it gets padding it does not want in
      // one context or a crop it cannot survive in the other.
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
