import type { CargoId, MapPayload, MetaPayload, Municipality, ProgressRow, Result } from '../../shared/types';

export interface Query { cargo: CargoId; uf?: string; mu?: string; turno: number; t?: number; fonte?: string }

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

const common = (q: Partial<Query>) => ({ turno: q.turno !== 1 ? q.turno : undefined, t: q.t !== undefined ? q.t.toFixed(4) : undefined, fonte: q.fonte });

export const urls = {
  meta: (q: Partial<Query>) => `/api/meta?${qs(common(q))}`,
  municipios: (q: Partial<Query>) => `/api/municipios?${qs({ fonte: q.fonte })}`,
  resultado: (q: Query) => `/api/resultado?${qs({ cargo: q.cargo, uf: q.uf, mu: q.mu, ...common(q) })}`,
  mapa: (q: Query, foco: string[], detalhe?: 'mu') => `/api/mapa?${qs({ cargo: q.cargo, uf: q.uf, foco: foco.join(',') || undefined, detalhe, ...common(q) })}`,
  progresso: (q: Partial<Query>) => `/api/progresso?${qs(common(q))}`,
  urnasEstrutura: (q: Query) => `/api/urnas/estrutura?${qs({ uf: q.uf, mu: q.mu, ...common(q) })}`,
  urnasSecoes: (q: Query, zona: number | null, foco: string[]) => `/api/urnas/secoes?${qs({ cargo: q.cargo, uf: q.uf, mu: q.mu, zona: zona ?? undefined, foco: foco.join(',') || undefined, ...common(q) })}`,
  urnasLocais: (q: Query, zona: number | null, foco: string[]) => `/api/urnas/locais?${qs({ cargo: q.cargo, uf: q.uf, mu: q.mu, zona: zona ?? undefined, foco: foco.join(',') || undefined, ...common(q) })}`,
  urnasBoletim: (q: Query, zona: number, secao: number) => `/api/urnas/boletim?${qs({ uf: q.uf, mu: q.mu, zona, secao, ...common(q) })}`,
};

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { erro?: string }).erro ?? `Erro ${res.status}`);
  return body as T;
}

export type { CargoId, MapPayload, MetaPayload, Municipality, ProgressRow, Result };
