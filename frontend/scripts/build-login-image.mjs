// Turns the full-resolution login photograph into the exact files the login
// page serves, plus the inline blur placeholder it paints first.
//
// Run after replacing assets/login-solar.jpg:
//
//   node scripts/build-login-image.mjs
//
// Why this exists rather than letting next/image do it: next/image optimizes
// on demand and caches the result in .next/cache/images, which is empty on
// every container start. Measured on the 3840x2372 master, that first request
// costs 628 ms of server CPU at 1200px and 1410 ms at 2048px — paid by the
// first person to open the login page after each deploy, before a single byte
// of image is sent. The page has one image, at one aspect ratio, that never
// changes between builds, so there is nothing for a runtime optimizer to
// decide. Doing the work here makes it free forever.
//
// sharp is declared in devDependencies purely for this script. Next ships it
// transitively today (it is what next/image uses), but relying on a transitive
// dependency would mean this breaks silently the day that changes.

import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "assets", "login-solar.jpg");
const OUT_DIR = path.join(ROOT, "public", "images");

// The panel is 60vw and hidden entirely below the lg breakpoint, so the widths
// that can actually be requested are: 1152 CSS px on a 1080p screen, 1728 on a
// 1440p one, and double each at DPR 2. These three cover that range without
// shipping a fourth file nobody selects.
const WIDTHS = [1280, 1920, 2560];

// 70 rather than 80: the photograph sits under a scrim and carries no text or
// fine detail, and at 2560px wide the difference is invisible while the file
// is a third smaller. The scrim is doing more to the image than the encoder.
const QUALITY = 70;

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

await mkdir(OUT_DIR, { recursive: true });

const meta = await sharp(SOURCE).metadata();
console.log(`source ${meta.width}x${meta.height} ${meta.format} ${kb(statSync(SOURCE).size)}`);

for (const width of WIDTHS) {
  const file = path.join(OUT_DIR, `login-solar-${width}.webp`);
  await sharp(SOURCE).resize({ width }).webp({ quality: QUALITY }).toFile(file);
  console.log(`  ${path.basename(file)}  ${kb(statSync(file).size)}`);
}

// The placeholder. 20px wide is enough to carry the photograph's colour and
// rough composition; the browser scales it up and the result is a blur without
// needing a blur filter. Small enough to inline in the HTML, so it costs no
// request at all and paints in the same frame as the markup.
const blur = await sharp(SOURCE).resize({ width: 20 }).webp({ quality: 40 }).toBuffer();
const dataUrl = `data:image/webp;base64,${blur.toString("base64")}`;
console.log(`  blur placeholder  ${blur.length} bytes`);

// Printed rather than written: everything in public/ is served and copied into
// the deployment image, and a stray .txt of base64 is not something to ship.
console.log(`\nPaste into LOGIN_IMAGE_BLUR in src/app/login/page.tsx:\n${dataUrl}`);
