// Hardcoded hex mirror of the oklch() design tokens in src/app/globals.css
// (--solar/--battery/--grid/--load, light and dark variants), computed via
// the standard OKLCH->linear-sRGB conversion so the 3D scene's accent
// colors match the 2D view exactly.
//
// Three.js materials need real color values, not CSS var()/oklch()
// strings, and parsing oklch() at runtime for a handful of static accent
// colors isn't worth the complexity — so this table is the deliberate
// tradeoff: manually kept in sync. If you change --solar/--battery/--grid/
// --load in globals.css, recompute and update the matching entry here.
export interface PowerFlowPalette {
  solar: string;
  battery: string;
  grid: string;
  load: string;
  critical: string;
}

export const POWER_FLOW_COLORS: Record<"light" | "dark", PowerFlowPalette> = {
  light: {
    solar: "#a96100",
    battery: "#00863f",
    grid: "#0063d7",
    load: "#8031c0",
    critical: "#d40924",
  },
  dark: {
    solar: "#f6af00",
    battery: "#43cc76",
    grid: "#53a0ff",
    load: "#bf83fe",
    critical: "#ff4c4d",
  },
};

// Neutral house/ground/platform tones — the only materials that swap with
// the theme; accent colors above stay fixed across light/dark since they
// carry semantic meaning (solar = amber, etc.) rather than surface styling.
export interface PowerFlowNeutrals {
  wall: string;
  roof: string;
  ground: string;
  panel: string;
}

export const POWER_FLOW_NEUTRALS: Record<"light" | "dark", PowerFlowNeutrals> = {
  light: {
    wall: "#f2efe9",
    roof: "#3f4757",
    ground: "#e4e0d8",
    panel: "#1f2733",
  },
  dark: {
    wall: "#4b5160",
    roof: "#22262f",
    ground: "#1a1c22",
    panel: "#12161d",
  },
};

// Fixed bright-studio material palette for the 3D scene. Deliberately
// theme-independent: the reference look is a clean, well-lit architectural
// render regardless of the app's light/dark mode, so the house/car/pylon
// always render in these light tones and only the semantic accent colors
// (POWER_FLOW_COLORS) and battery fill react to the data.
export const STUDIO = {
  background: "#eef1f5",
  // Vertical backdrop gradient. Subtle on purpose — enough to give the
  // render depth, not enough to compete with the building for contrast.
  backdropTop: "#dfe5ee",
  backdropBottom: "#f4f6f9",
  wall: "#f6f7f9",
  wallAlt: "#e8eaef",
  wallSide: "#eceef2",
  roof: "#e2e6ec",
  trim: "#c4cad4",
  // Window frames. Lightened from #2f3742: near-black mullions on a white
  // facade turned every opening into a black-outlined rectangle that read
  // as a doorway punched through the wall. The reference uses thin, pale
  // frames that let the glazing itself carry the detail.
  frame: "#8d949e",
  glassTint: "#9fb4c4", // tinted architectural glass
  panel: "#0c1626", // dark glossy solar
  panelFrame: "#8b95a5",
  carBody: "#eef0f3",
  carGlass: "#1f2732",
  carTrim: "#2c333e",
  carWheel: "#20252d",
  metal: "#c4cad3",
  metalDark: "#9aa1ab",
  cabinet: "#eceef2",
  cabinetTrim: "#cdd2da",
  cabinetScreen: "#1d2430",
  ground: "#e9ecf1",

  // Cutaway interior. Deliberately warm against the cool white shell —
  // this contrast is what makes a sectioned building read as a *home*
  // rather than a model, and it's the single biggest difference between
  // our render and the reference. Kept low-saturation so the four accent
  // colours on the flow overlay stay the brightest thing on screen.
  floor: "#e4dcd0",
  interiorWall: "#f3f0ea",
  slabEdge: "#f7f8fa",
  sofa: "#d6cec2",
  sofaAccent: "#c08268",
  wood: "#a9825a",
  woodLight: "#c8a87f",
  linen: "#f2eee7",
  rug: "#dbd1c1",
  foliage: "#7d9a6c",
  lampShade: "#f0ece3",
} as const;

// Text/line colors for the HTML overlays drawn on top of the 3D canvas
// (fleet-count badge, dashed callouts).
//
// These must NOT come from the theme tokens. The studio background above is
// deliberately fixed-light in both themes, so a `text-foreground` overlay
// resolves to near-white in dark mode and renders white-on-#eef1f5 —
// effectively invisible. These are pinned to the canvas instead, and clear
// 6:1 (muted) and 12.9:1 (strong) against it. Accent-colored values on the
// canvas should use POWER_FLOW_COLORS.light for the same reason.
export const STUDIO_INK = {
  strong: "#222933",
  muted: "#535c66",
  line: "#80878f",
} as const;
