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
    solar: "#cf9b00",
    battery: "#339a83",
    grid: "#007cd9",
    load: "#8451c9",
    critical: "#df202e",
  },
  dark: {
    solar: "#e3ae28",
    battery: "#4abba1",
    grid: "#449df0",
    load: "#a87eeb",
    critical: "#f54748",
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
  wall: "#f6f7f9",
  wallAlt: "#e8eaef",
  wallSide: "#eceef2",
  roof: "#e2e6ec",
  trim: "#c4cad4",
  frame: "#2f3742",
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
} as const;
