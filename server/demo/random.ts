// Aleatoriedade determinística (mesma semente → mesmos números) para a simulação.
export function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export const rand = (seed: string) => hash32(seed) / 4294967296;

export function gauss(seed: string): number {
  const u = Math.max(rand(seed + '#u'), 1e-9), v = rand(seed + '#v');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(arr: readonly T[], seed: string): T {
  return arr[Math.floor(rand(seed) * arr.length)];
}

export function shuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(`${seed}:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Campo espacial suave em [-1, 1] — cria "regiões" coerentes no mapa. */
export function field(seed: string, lon: number, lat: number, scale = 1): number {
  let s = 0, norm = 0;
  for (let k = 0; k < 4; k++) {
    const a = 1 / (k + 1);
    const theta = rand(`${seed}:t${k}`) * Math.PI * 2;
    const f = (0.12 + rand(`${seed}:f${k}`) * 0.35) * scale * (k + 1);
    const phi = rand(`${seed}:p${k}`) * Math.PI * 2;
    s += a * Math.sin(f * (lon * Math.cos(theta) + lat * Math.sin(theta)) + phi);
    norm += a;
  }
  return s / norm;
}
