import { readFileSync } from 'node:fs';
import type { Municipality } from '../shared/types.ts';

type Row = [string, string, string, string, number, number | null, number | null];
const rows = JSON.parse(readFileSync(new URL('../shared/data/municipios.json', import.meta.url), 'utf8')) as Row[];

export const MUNICIPALITIES: Municipality[] = rows.map(([code, ibge, name, uf, capital, lon, lat]) => ({
  code, ibge, name, uf: uf.toLowerCase(), capital: capital === 1, lon, lat,
}));
export const MUN_BY_CODE = new Map(MUNICIPALITIES.map((m) => [m.code, m]));
export const munsOf = (uf: string) => MUNICIPALITIES.filter((m) => m.uf === uf);
