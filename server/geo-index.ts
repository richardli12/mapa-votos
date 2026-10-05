import type { Municipality } from '../shared/types.ts';
// Importado (e não lido do disco) para entrar no pacote da função serverless.
import data from '../shared/data/municipios.json' with { type: 'json' };

type Row = [string, string, string, string, number, number | null, number | null];
const rows = data as unknown as Row[];

export const MUNICIPALITIES: Municipality[] = rows.map(([code, ibge, name, uf, capital, lon, lat]) => ({
  code, ibge, name, uf: uf.toLowerCase(), capital: capital === 1, lon, lat,
}));
export const MUN_BY_CODE = new Map(MUNICIPALITIES.map((m) => [m.code, m]));
export const munsOf = (uf: string) => MUNICIPALITIES.filter((m) => m.uf === uf);
