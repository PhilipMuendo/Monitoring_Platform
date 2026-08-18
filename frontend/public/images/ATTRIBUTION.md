# Image credits

## login-solar-{1280,1920,2560}.webp

- **Source:** "Solar panels in the desert", NREL Image Gallery, via Wikimedia Commons
  https://commons.wikimedia.org/wiki/File:Solar_panels_in_the_desert.jpg
- **Photographer:** Dennis Schroeder, NREL
- **Licence:** Public domain (work of the US Department of Energy's National
  Renewable Energy Laboratory)
- **Attribution required:** No.
- **Dimensions:** 3840 x 2372

Recorded even though nothing obliges it. `public/models/ATTRIBUTION.md` covers
an asset (the car) that *does* carry a live attribution obligation, and the two
files sitting side by side is what makes it obvious which is which. A future
reader should not have to guess whether an asset is safe to ship.

Public domain was preferred over several higher-resolution CC BY-SA candidates
specifically to avoid adding a second attribution obligation to the deployment.

## Why this image over the alternatives

Chosen on measurements rather than taste, because the sign-in page overlays
white text on it and that either works or it does not. Compared against a CC0
4896x3672 alternative and the 1920x1081 image it replaced:

| | resolution | mean luminance | variance under the text |
|---|---|---|---|
| **this one** | **3840x2372** | **81** | **55** |
| CC0 Roßleben | 3840x2880 | 143 | 84 |
| previous (Lon D. Wright) | 1920x1081 | 145 | 71 |

Twice the resolution of the one it replaces, which matters because the left
panel is close to square on a 1080p screen (~1152x1080 CSS px) and `object-fit:
cover` crops a wide photo hard before it ever reaches the viewer.

Darker and calmer are both wins here: a low-luminance photo sits naturally
under a dark UI, and low variance in the bottom-left — where the wordmark and
tagline sit — is what keeps that text legible. The scrim in `login/page.tsx` is
tuned to these numbers, so re-tune it if this image is swapped.

**There is exactly one overlay, and it is confined to the bottom 45%.** There
used to be a second, horizontal one fading the photo into the form panel. It
was removed: Tailwind spaces a three-stop gradient at 0/50/100%, so that ramp
ran across the entire right HALF of the photograph, compositing a desaturated
dark green over sky and field while the vertical scrim laid more green over
the same pixels. The result read as a gray-green smear — a rendering fault
rather than a decision. The photo and the form are separate grid columns, so
the seam is now simply the boundary between them: a hard edge, which is the
honest shape of the layout.

If the scrim is ever re-tuned, the number to hold is the contrast behind the
tagline. Measured on the current image and stops
(`from-brand/95 from-0% via-brand/45 via-18% to-transparent to-45%`):
**4.96:1 worst case, 9.06:1 mean** against `text-slate-300`. AA needs 4.5:1.

## Where the files come from

The `.webp` files here are **generated**, not authored. The master is
`frontend/assets/login-solar.jpg` (3840x2372, 1.98 MB), which lives outside
`public/` so it is never served or copied into the Docker image.

```
node scripts/build-login-image.mjs
```

emits the three widths plus the inline blur placeholder. They are committed
because `public/` is copied verbatim into the deployment; nothing regenerates
them at build time.

They are served as static files rather than through `next/image` on purpose —
that optimizer works on demand and its cache starts empty in every container,
so the first visitor after a deploy was paying 628 ms of server CPU (1410 ms
for the 2048px variant) before any image bytes moved. See the comment in
`src/app/login/page.tsx`.

## Replacing it

Replace `frontend/assets/login-solar.jpg`, run the script above, and paste the
blur string it prints into `LOGIN_IMAGE_BLUR` in `src/app/login/page.tsx`.
Prefer something dark and quiet in the lower-left, and at least ~2560px wide so
the largest generated width is a downscale rather than an upscale.
