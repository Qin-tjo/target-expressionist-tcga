// Palettes for the clean data graph (Layer C). Default is on-theme rank-shaded mono.
// Named presets deliberately echo the retro palette while staying colorblind-legible.

export interface Palette {
  id: string;
  name: string;
  /** color for a bar given its rank position (0 = highest median) and total bars. */
  colorFor: (rankIndex: number, total: number) => string;
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}
function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
/** Interpolate across a list of [r,g,b] stops by fraction t∈[0,1]. */
function ramp(stops: [number, number, number][], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  return hex(lerp(r1, r2, f), lerp(g1, g2, f), lerp(b1, b2, f));
}

const rank = (id: string, name: string, stops: [number, number, number][]): Palette => ({
  id,
  name,
  colorFor: (i, total) => ramp(stops, total <= 1 ? 0 : i / (total - 1)),
});

const cyclic = (id: string, name: string, colors: string[]): Palette => ({
  id,
  name,
  colorFor: (i) => colors[i % colors.length],
});

export const PALETTES: Palette[] = [
  rank("mono-pink", "Mono Pink", [
    [255, 79, 163], // hot pink (rank 1)
    [255, 199, 222], // soft pink
    [154, 160, 166], // grey
    [17, 17, 17], // ink
  ]),
  rank("grayscale", "Grayscale", [
    [17, 17, 17],
    [95, 99, 104],
    [154, 160, 166],
    [214, 214, 218],
  ]),
  cyclic("pico8", "PICO-8", [
    "#FF004D", "#FF77A8", "#FFA300", "#FFEC27", "#00E436", "#29ADFF", "#83769C", "#111111",
  ]),
  rank("blueprint", "Blueprint", [
    [11, 42, 122],
    [37, 99, 235],
    [125, 211, 252],
    [219, 234, 254],
  ]),
  rank("hot-pink", "Hot Pink", [
    [131, 24, 67],
    [219, 39, 119],
    [244, 114, 182],
    [252, 231, 243],
  ]),
];

export const paletteById = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0];
