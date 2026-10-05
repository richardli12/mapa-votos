import { useCallback, useEffect, useState } from 'react';
import type { CargoId } from '../../shared/types';

export type View = 'geral' | 'comparar' | 'partidos' | 'perfil';
export type MapMode = 'lider' | 'partido' | 'forca' | 'duelo' | 'margem' | 'comparecimento' | 'brancosnulos' | 'apuracao';

export interface Route {
  cargo: CargoId;
  uf?: string;
  mu?: string;
  view: View;
  mode?: MapMode;
  /** candidatos selecionados para comparar (ids) */
  cmp: string[];
  /** candidato em destaque (mapa de força / ficha) */
  cand?: string;
  turno: number;
  /** Brasil por município */
  det?: 'mu';
}

const CARGOS: CargoId[] = ['presidente', 'governador', 'senador', 'depfederal', 'depestadual'];
const VIEWS: View[] = ['geral', 'comparar', 'partidos', 'perfil'];

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
    turno: p.get('turno') === '2' ? 2 : 1,
    det: p.get('det') === 'mu' ? 'mu' : undefined,
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
  if (r.turno !== 1) p.set('turno', '2');
  if (r.det && !r.uf) p.set('det', r.det);
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
