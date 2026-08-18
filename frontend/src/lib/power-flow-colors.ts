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
  // Darkened from #e2e6ec. The backdrop gradient's top stop is #dfe5ee — three
  // RGB steps away — so any roof plane seen against the upper backdrop simply
  // disappeared into it. That is fine for the main roof, which carries a dark
  // solar array to separate it, and was very obviously wrong for the bare
  // undercroft cap at the left end, which had nothing on it and vanished.
  // A roof is the one surface lit only by sky rather than sun, so reading
  // darker than the walls is also what it should do physically.
  roof: "#ccd4de",
  trim: "#c4cad4",
  // Window frames. Lightened from #2f3742: near-black mullions on a white
  // facade turned every opening into a black-outlined rectangle that read
  // as a doorway punched through the wall. The reference uses thin, pale
  // frames that let the glazing itself carry the detail.
  //
  // Lightened again from #8d949e, which sat only eight RGB steps from the
  // conduit colour — so at panel scale the mullions and the cable runs were
  // the same mid-grey line and the eye could not tell an electrical service
  // from a window division. Sosen's frames are near-white and their cables
  // are distinctly dark; the two never compete. Frames and conduit are now
  // separated deliberately: see StudioInk.conduit.
  frame: "#bcc3cc",
  glassTint: "#a8bcca", // tinted architectural glass
  panel: "#0c1626", // dark glossy solar
  panelFrame: "#8b95a5",
  metal: "#c4cad3",
  metalDark: "#9aa1ab",
  cabinet: "#eceef2",
  cabinetTrim: "#cdd2da",
  cabinetScreen: "#1d2430",
  ground: "#e9ecf1",

  // The compound. Grass is deliberately desaturated — it has to sit clearly
  // BELOW the four semantic accents in saturation or it competes with them,
  // and the one it would collide with is `battery` (#00863f), the brightest
  // green on the canvas. These are roughly a third of that chroma, so a
  // battery flow particle still reads as the most saturated green on screen
  // even when it crosses the lawn.
  //
  // grassAlt is the darker end of the mottle, not a second surface: the lawn
  // texture interpolates between the two per pixel. Keep the pair close —
  // widening the gap turns patchy grass into visible blotches at panel scale.
  grass: "#9db58c",
  grassAlt: "#8aa578",
  // Paving. Darkened twice, from #dcdee3 via #c2c6cd, and the reason is worth
  // recording: this is a HORIZONTAL surface, so it takes the hemisphere light
  // almost square-on and renders far lighter than its own hex suggests. Picked
  // against the wall white (#f6f7f9) it came out a bright ribbon pulling as
  // hard as the building did. Judge this value as rendered, not as authored —
  // stone should be the quietest hard surface in the frame.
  paving: "#a9aeb8",

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
// (fleet-count badge, dashed callouts), plus the conduit material.
//
// These must NOT come from the theme tokens. The app theme says nothing about
// what is behind these labels — the canvas has its own background — so a
// `text-foreground` overlay resolves to near-white in dark mode and renders
// white-on-#eef1f5, effectively invisible. They are pinned to the canvas
// instead. Accent-colored values on the canvas should use
// POWER_FLOW_COLORS.light for the same reason.
//
// There are two sets because the canvas background is no longer fixed: the
// scene follows the clock in Kenya, and near-black text over a night sky is
// exactly the failure this pinning exists to prevent, in the other direction.
// Both sets are checked against the actual sky they sit on rather than against
// a nominal white — see the table on STUDIO_INK_SKY.
// SCENE_LIGHTING below names which set each phase uses; nothing should import
// an ink set directly to render with.
export interface StudioInk {
  strong: string;
  muted: string;
  line: string;
  /**
   * Electrical conduit. Deliberately darker than STUDIO.frame in daylight so a
   * cable run never reads as a window mullion — they were previously
   * near-identical greys and the two were genuinely hard to tell apart on the
   * facade. Kept off pure black: these are surface-mounted trunking against a
   * white render, not ink lines on a drawing.
   */
  conduit: string;
}

/**
 * Daylight and dusk ink.
 *
 * Darkened when the sky stopped being white. These labels float over whatever
 * the backdrop happens to be at that height, and the callout baseline sits
 * near the TOP of the frame — which is the most saturated part of a real sky,
 * and now a mid blue rather than #eef1f5. The old `muted` fell to 3.84:1 on
 * the day zenith and 3.17:1 on dusk.
 *
 * Checked against the three worst surfaces any of this text crosses:
 *
 *                    day zenith   dusk zenith   lawn
 *   strong #222933      8.28          6.83      6.57
 *   muted  #353d49      6.19          5.11      4.92
 *
 * The lawn matters because the fleet counter sits bottom-left over grass — it
 * was already failing there at 3.05:1 before any of this, which the near-white
 * sky had been hiding.
 *
 * `line` is the dashed leader, not text, so it is held to a visibility bar
 * rather than a legibility one: 3.87:1 on the day zenith, 3.08:1 on grass.
 * Taking it darker enough to clear 4.5 made a hairline read as a hard rule and
 * started competing with the conduit runs it points past.
 */
export const STUDIO_INK_SKY: StudioInk = {
  strong: "#222933",
  muted: "#353d49",
  line: "#525b6a",
  conduit: "#5d656f",
};

/**
 * Night ink. Clears 14.6:1 (strong) and 6.9:1 (muted) against #141a24.
 *
 * The conduit inverts along with the text and for the same reason: at night
 * the facade is a dark blue-grey, so the daylight conduit at #5d656f sits
 * within a few steps of the wall it is mounted on and the four runs — the
 * thing the panel exists to show — simply vanish.
 */
export const STUDIO_INK_NIGHT: StudioInk = {
  strong: "#eef2f8",
  muted: "#a7b3c6",
  line: "#69768c",
  conduit: "#9aa5b6",
};

/**
 * Everything about the scene that changes with the time of day in Kenya.
 *
 * MATERIALS ARE NOT IN HERE, and that is the design. Night is expressed almost
 * entirely as lighting, because that is what night is: the same white plaster
 * under a dim blue sky reads as dark blue-grey without a single material being
 * swapped. Duplicating the forty-odd STUDIO tones into a night set would be a
 * large surface to keep in sync for a worse result.
 *
 * The exceptions are the three background/backdrop colours, which are not
 * materials at all — nothing lights them — and the ink, which is HTML.
 */
export type TimeOfDay = "day" | "dusk" | "night";

export interface SceneLighting {
  /** Canvas clear colour. */
  background: string;
  backdropTop: string;
  backdropBottom: string;
  /**
   * The bright band low in the sky, where the lawn dissolves.
   *
   * Every real sky is lightest near the horizon, and putting that band exactly
   * where the ground fades is what turns the fade into distance rather than
   * into the grass texture running out. It is the brightest of the four sky
   * stops in all three phases — including at night, where it stands in for the
   * residual glow that keeps a real horizon from ever being as black as the
   * zenith.
   */
  skyHorizon: string;
  ambientIntensity: number;
  ambientColor: string;
  hemisphereIntensity: number;
  hemisphereSky: string;
  hemisphereGround: string;
  /** Sun, or moon at night. Position drives the direction shadows fall. */
  keyPosition: [number, number, number];
  keyIntensity: number;
  keyColor: string;
  /** Multiplier on the studio Lightformers — image-based fill for glass. */
  environmentIntensity: number;
  contactShadowOpacity: number;
  contactShadowColor: string;
  shadowFloorOpacity: number;
  ink: StudioInk;
  /**
   * Which accent variant the flow particles and callout dots use.
   *
   * This is what POWER_FLOW_COLORS' two variants were always for, finally used
   * for their actual purpose: the `light` set is tuned to be legible on a pale
   * background, and its grid blue (#0063d7) and load purple (#8031c0) are all
   * but invisible against a night sky. The choice tracks the canvas, not the
   * app theme — the panel can perfectly well be a night scene inside a
   * light-themed dashboard.
   */
  accents: PowerFlowPalette;
  /**
   * Ambient-occlusion strength for the N8AO pass.
   *
   * Scales down with the light, because AO is a multiplier on light that never
   * reached a crevice — and at night very little light reached anywhere. The
   * daylight value over a night scene does not read as deeper contact shading,
   * it reads as black holes in the corners.
   */
  aoIntensity: number;
  /** Whether the compound's dusk-to-dawn security lighting is lit. */
  securityLights: boolean;
  /** Whether to mount the starfield and moon. Night only — a dusk sky is far
   *  too bright for stars to register, and drawing them anyway just adds a
   *  points pass nobody can see. */
  stars: boolean;
}

export const SCENE_LIGHTING: Record<TimeOfDay, SceneLighting> = {
  // A REAL SKY, not a near-white swatch. The four stops were previously
  // #dfe5ee / #eef1f5 / #f9f7f2 / #f4f6f9 — all within a dozen RGB steps of
  // each other, which is a gradient on paper and plain white on screen.
  //
  // The scene stopped being a studio render once it got a lawn, a compound and
  // a time of day; a white void behind an outdoor building is the one part
  // that had not caught up. Only the BACKDROP changes here, not the light rig:
  // the key, ambient and hemisphere stay neutral white so the plaster keeps
  // reading as plaster rather than picking up a blue cast.
  //
  // Darkest at the zenith and palest at the horizon, which is the way round a
  // real sky goes — more atmosphere between you and the horizon means more
  // scattering, so it washes out. Inverting that is the classic tell.
  day: {
    background: "#bfd7ec",
    backdropTop: "#a8c6e4",
    backdropBottom: "#eef4fa",
    // The pale band where the lawn dissolves. Palest of the four, and it is
    // what turns the lawn's fade into distance instead of a texture running
    // out.
    skyHorizon: "#e6eff7",
    ambientIntensity: 0.72,
    ambientColor: "#ffffff",
    hemisphereIntensity: 0.62,
    hemisphereSky: "#ffffff",
    hemisphereGround: "#dfe4ec",
    keyPosition: [-5.5, 9, 5],
    keyIntensity: 0.95,
    keyColor: "#ffffff",
    environmentIntensity: 1,
    contactShadowOpacity: 0.42,
    contactShadowColor: "#2b3630",
    shadowFloorOpacity: 0.1,
    ink: STUDIO_INK_SKY,
    accents: POWER_FLOW_COLORS.light,
    aoIntensity: 2.6,
    securityLights: false,
    stars: false,
  },

  // Low warm sun. The key drops to y=2.6 and swings west, which is what
  // actually sells dusk: long shadows raking across the compound, not just a
  // warmer tint. Intensity goes UP rather than down — a low sun is not a weak
  // one, it is a grazing one, and dimming it here made the scene read as an
  // overcast afternoon instead.
  //
  // Security lights are already on. Dusk-to-dawn sensors switch at dusk, and
  // it is the one phase where the lamps and the sky are both visible, so it is
  // the phase where they read as lamps rather than as glowing dots.
  dusk: {
    // Deepened along with day. A sunset is a blue-violet zenith grading down
    // into orange, and the previous stops were beige all the way up, which
    // read as haze rather than as evening. The zenith is kept lighter than it
    // wants to be for one reason: the callout labels sit near the top of the
    // frame, and pushing it to a true dusk blue took the muted label colour
    // under 3:1.
    background: "#d9bda6",
    backdropTop: "#a6b1cd",
    backdropBottom: "#f5e4d2",
    // The one phase where the glow is the point rather than a refinement.
    skyHorizon: "#ffcf9c",
    ambientIntensity: 0.46,
    ambientColor: "#ffd9bd",
    hemisphereIntensity: 0.4,
    hemisphereSky: "#ffc79b",
    hemisphereGround: "#b9ada8",
    keyPosition: [-9, 2.6, 3.5],
    keyIntensity: 1.05,
    keyColor: "#ffa863",
    environmentIntensity: 0.7,
    contactShadowOpacity: 0.34,
    contactShadowColor: "#3a2f2c",
    shadowFloorOpacity: 0.08,
    ink: STUDIO_INK_SKY,
    accents: POWER_FLOW_COLORS.light,
    aoIntensity: 2.2,
    securityLights: true,
    stars: false,
  },

  // Moonlight, from the opposite side to the sun so the shadows are visibly
  // not daylight shadows. Everything ambient collapses; what is left to see by
  // is the security lighting, the windows the house lights when the fleet
  // draws load, and a thin rim off the moon.
  //
  // The floor passes go quiet rather than off. A contact shadow at daylight
  // strength over a dark lawn is a black smear, but removing it entirely
  // un-seats the building — so it stays, at a fraction of the opacity.
  night: {
    background: "#141a24",
    // Deepened from #0d121b. With a lit horizon underneath it, the zenith can
    // afford to go darker, and the gap between the two is what stops the night
    // sky reading as one flat rectangle.
    backdropTop: "#0a0e16",
    backdropBottom: "#1c2431",
    skyHorizon: "#27364a",
    // Dimmed hard from a first pass at 0.20/0.24/0.30/0.18. That looked like
    // heavy overcast, not night: the plaster still came back a light grey and
    // the lit windows had nothing to be brighter THAN. Night is not a dimmer
    // on the whole rig — it is the ambient terms collapsing while the point
    // sources stay put, so most of what is visible is the security lighting
    // and whatever rooms the fleet's own load has switched on.
    ambientIntensity: 0.13,
    ambientColor: "#7d90bd",
    hemisphereIntensity: 0.15,
    hemisphereSky: "#3a4767",
    hemisphereGround: "#12161f",
    keyPosition: [5, 8, -2],
    keyIntensity: 0.26,
    keyColor: "#b3c2e2",
    environmentIntensity: 0.1,
    contactShadowOpacity: 0.22,
    contactShadowColor: "#05070c",
    shadowFloorOpacity: 0.06,
    ink: STUDIO_INK_NIGHT,
    accents: POWER_FLOW_COLORS.dark,
    aoIntensity: 1.4,
    securityLights: true,
    stars: true,
  },
};
