// Lê os tokens de cor do tema atual (CSS) para uso em SVG/JS e oferece rampas e misturas.
export interface Palette {
  slots: string[];
  other: string;
  empty: string;
  stroke: string;
  mid: string;
  surface: string;
  seq: string[];
  text: string;
  muted: string;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    slots: Array.from({ length: 8 }, (_, i) => v(`--s${i}`)),
    other: v('--other'), empty: v('--map-empty'), stroke: v('--map-stroke'), mid: v('--neutral-mid'),
    surface: v('--surface-1'), seq: Array.from({ length: 7 }, (_, i) => v(`--seq-${i + 1}`)), text: v('--text-primary'), muted: v('--text-muted'),
  };
}

// Aceita #rgb, #rgba, #rrggbb e #rrggbbaa (o minificador de CSS encurta #ffffff para #fff).
const hex = (h: string) => {
  let x = h.trim().replace('#', '');
  if (x.length === 3 || x.length === 4) x = x.slice(0, 3).split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) || 0);
};
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Mistura perceptual (OKLab) entre duas cores. */
export function mix(a: string, b: string, t: number): string {
  const ok = (h: string) => {
    const [r, g, bl] = hex(h).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const A = ok(a), B = ok(b);
  const [L, aa, bb] = A.map((x, i) => x + (B[i] - x) * t);
  const l = (L + 0.3963377774 * aa + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * aa - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * aa - 1.291485548 * bb) ** 3;
  return toHex([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin));
}

export const slotColor = (p: Palette, slot: number) => (slot >= 0 && slot < p.slots.length ? p.slots[slot] : p.other);

/** Rampa sequencial de uma cor: do quase-fundo até a cor cheia (e um passo mais profundo). */
export function ramp(p: Palette, color: string, n: number): string[] {
  const dark = document.documentElement.dataset.resolvedTheme === 'dark';
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    return t <= 0.8 ? mix(p.surface, color, 0.14 + (t / 0.8) * 0.86) : mix(color, dark ? '#ffffff' : '#000000', (t - 0.8) * 1.1);
  });
}

/** Rampa divergente A ← neutro → B com o mesmo número de passos por braço. */
export function diverging(p: Palette, a: string, b: string, arm: number): string[] {
  const left = Array.from({ length: arm }, (_, i) => mix(p.mid, a, (arm - i) / arm));
  const right = Array.from({ length: arm }, (_, i) => mix(p.mid, b, (i + 1) / arm));
  return [...left, p.mid, ...right];
}
