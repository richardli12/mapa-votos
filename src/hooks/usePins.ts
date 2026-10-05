import { useEffect, useMemo } from 'react';
import type { CandidateLite } from '../../shared/types';
import type { LocaisPayload, LocalResumo, UrnaEstrutura } from '../../shared/urnas';
import { urls } from '../lib/api';
import { useApp } from '../state';
import { useLocaisEstaticos } from './useLocaisEstaticos';
import { usePoll } from './usePoll';

export interface PinData {
  id: string; zona: number; local: number;
  nome: string; endereco?: string; bairro?: string;
  lon: number; lat: number; eleitores: number;
  soma: LocalResumo | null;
  /** % dos votos válidos do candidato em foco no local */
  share: number | null;
  votos: number;
  pos?: number;
}

export type PinsEstado = 'desligado' | 'sem-municipio' | 'carregando' | 'sem-coordenadas' | 'escolher-zona' | 'ok' | 'erro';

/** Locais de votação do município selecionado, com a soma de votos do cargo e do candidato em foco. */
export function usePins(on: boolean, foco: CandidateLite | undefined) {
  const { route, t, meta, isDemo } = useApp();
  const ativo = on && !!route.uf && !!route.mu;
  const q = { cargo: route.cargo, uf: route.uf, mu: route.mu, turno: route.turno, t };
  const refresh = t !== undefined ? null : (meta?.refreshSeconds ?? 30) * 1000;
  const est = usePoll<UrnaEstrutura>(ativo ? urls.urnasEstrutura(q) : null, null);
  const e = est.data && est.data.mu === route.mu ? est.data : null;
  const estaticos = useLocaisEstaticos(route.uf, route.mu, ativo && !!e && !e.locais);
  // a simulação soma o município inteiro; ao vivo, cidades grandes vão por zona (limite de requisições)
  const zona = !e ? null : isDemo || e.municipioInteiro ? (route.z ?? null) : route.z ?? e.zonas[0]?.zona ?? null;
  const loc = usePoll<LocaisPayload>(ativo && e ? urls.urnasLocais(q, zona, foco ? [foco.number] : []) : null, refresh);
  useEffect(() => {
    if (!loc.data?.pending) return;
    const id = window.setTimeout(loc.refresh, 2500);
    return () => window.clearTimeout(id);
  }, [loc.data, loc.refresh]);
  const payload = loc.data && loc.data.mu === route.mu && loc.data.cargo === route.cargo ? loc.data : null;

  const pins = useMemo<PinData[]>(() => {
    if (!e) return [];
    const info = new Map((e.locais ?? estaticos ?? []).map((l) => [l.id, l]));
    const somas = new Map((payload?.locais ?? []).map((l) => [l.id, l]));
    const ids = new Set([...info.keys()].filter((id) => zona === null || info.get(id)!.zona === zona));
    const out: PinData[] = [];
    for (const id of ids) {
      const l = info.get(id)!;
      if (l.lat == null || l.lon == null) continue;
      const s = somas.get(id) ?? null;
      const validos = s ? s.nom + s.leg : 0;
      const votos = foco && s ? s.v[foco.number] ?? 0 : 0;
      out.push({
        id, zona: l.zona, local: l.local, nome: l.nome, endereco: l.endereco, bairro: l.bairro, lon: l.lon, lat: l.lat,
        eleitores: l.eleitores || (s?.apt ?? 0), soma: s, votos,
        share: s && s.totalizadas && validos ? votos / validos : null, pos: s?.pos,
      });
    }
    return out;
  }, [e, estaticos, payload, zona, foco]);

  let estado: PinsEstado = 'ok';
  if (!on) estado = 'desligado';
  else if (!route.uf || !route.mu) estado = 'sem-municipio';
  else if (est.error || loc.error) estado = loc.error?.includes('zona') ? 'escolher-zona' : 'erro';
  else if (!e || (!payload && loc.loading)) estado = 'carregando';
  else if (!pins.length && (e.locais ?? estaticos) !== null) estado = 'sem-coordenadas';
  else if (!pins.length && !e.locais && estaticos === null) estado = 'sem-coordenadas';
  return { pins, estado, estrutura: e, zona, payload, erro: est.error ?? loc.error };
}
