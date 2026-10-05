import { useCallback, useEffect, useState } from 'react';
import type { CargoId } from '../../shared/types';

export type View = 'geral' | 'comparar' | 'partidos' | 'perfil' | 'urnas';
export type UrnaMode = 'lider' | 'forca' | 'comparecimento' | 'apuracao';
export type MapMode = 'lider' | 'partido' | 'forca' | 'duelo' | 'margem' | 'comparecimento' | 'brancosnulos' | 'apuracao';

export interface Route {
  cargo: CargoId;
  uf?: string;
  mu?: string;
  view: View;
  mode?: MapMode;
  /** candidatos selecionados para comparar (ids) */
  cmp: string[];
  /** candidato com a ficha aberta */
  cand?: string;
  /** candidato em foco no mapa (força e locais de votação) */
  fc?: string;
  /** pins dos locais de votação ligados */
  pins?: boolean;
  turno: number;
  /** Brasil por município */
  det?: 'mu';
  /** aba Urnas: zona eleitoral, local de votação (`zona-local`), seção e modo do mapa de escolas */
  z?: number;
  esc?: string;
  s?: number;
  um?: UrnaMode;
}

const CARGOS: CargoId[] = ['presidente', 'governador', 'senador', 'depfederal', 'depestadual'];
const VIEWS: View[] = ['geral', 'comparar', 'partidos', 'perfil', 'urnas'];
const UMODES: UrnaMode[] = ['lider', 'forca', 'comparecimento', 'apuracao'];
const int = (v: string | null) => (v && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

export function parseHash(hash: string): Route {
  const p = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const cargo = (CARGOS as string[]).includes(p.get('cargo') ?? '') ? (p.get('cargo') as CargoId) : 'presidente';
  const uf = p.get('uf')?.toLowerCase() || undefined;
  return {
    cargo, uf, mu: uf ? p.get('mu') || undefined : undefined,
    view: (VIEWS as string[]).includes(p.get('v') ?? '') ? (p.get('v') as View) : 'geral',
    mode: (p.get('m') as MapMode) || undefined,
    cmp: (p.get('cmp') ?? '').split(',').filter(Boolean).slice(0, 4),
    cand: p.get('cand') || undefined,
    fc: /^\d+$/.test(p.get('fc') ?? '') ? p.get('fc')! : undefined,
    pins: p.get('pins') === '1' || undefined,
    turno: p.get('turno') === '2' ? 2 : 1,
    det: p.get('det') === 'mu' ? 'mu' : undefined,
    z: int(p.get('z')),
    esc: /^\d{1,4}-\d{1,4}$/.test(p.get('esc') ?? '') ? p.get('esc')! : undefined,
    s: int(p.get('s')),
    um: (UMODES as string[]).includes(p.get('um') ?? '') ? (p.get('um') as UrnaMode) : undefined,
  };
}

export function toHash(r: Route): string {
  const p = new URLSearchParams();
  p.set('cargo', r.cargo);
  if (r.uf) p.set('uf', r.uf);
  if (r.uf && r.mu) p.set('mu', r.mu);
  if (r.view !== 'geral') p.set('v', r.view);
  if (r.mode) p.set('m', r.mode);
  if (r.cmp.length) p.set('cmp', r.cmp.join(','));
  if (r.cand) p.set('cand', r.cand);
  if (r.fc) p.set('fc', r.fc);
  if (r.pins) p.set('pins', '1');
  if (r.turno !== 1) p.set('turno', '2');
  if (r.det && !r.uf) p.set('det', r.det);
  if (r.mu && r.z) p.set('z', String(r.z));
  if (r.mu && r.esc) p.set('esc', r.esc);
  if (r.mu && r.s) p.set('s', String(r.s));
  if (r.um && r.um !== 'lider') p.set('um', r.um);
  return `#/${p.toString()}`;
}

export function useRoute(): [Route, (patch: Partial<Route>) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const update = useCallback((patch: Partial<Route>) => {
    const next = { ...parseHash(window.location.hash), ...patch };
    const h = toHash(next);
    if (h !== window.location.hash) window.location.hash = h;
  }, []);
  return [route, update];
}
