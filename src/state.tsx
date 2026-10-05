import { createContext, useContext } from 'react';
import type { CandidateLite, MapPayload, MetaPayload, Municipality, Result } from '../shared/types';
import type { Poll } from './hooks/usePoll';
import type { Route } from './hooks/useRoute';
import type { Palette } from './lib/palette';

export interface AppState {
  route: Route;
  go: (patch: Partial<Route>) => void;
  palette: Palette;
  meta: MetaPayload | null;
  result: Poll<Result>;
  map: Poll<MapPayload>;
  munis: Map<string, Municipality>;
  muniList: Municipality[];
  /** candidatos conhecidos (resultado atual + mapa) */
  cands: Map<string, CandidateLite>;
  t?: number;
  isDemo: boolean;
  /** nome legível de uma área do mapa atual */
  areaName: (code: string) => string;
}

export const AppCtx = createContext<AppState | null>(null);
export const useApp = () => useContext(AppCtx)!;
