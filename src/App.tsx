import { useEffect, useMemo, useState } from 'react';
import { cargoInfo } from '../shared/cargos';
import { titleCase } from '../shared/format';
import { ufName } from '../shared/ufs';
import type { CandidateLite, MapPayload, MetaPayload, Municipality, Result } from '../shared/types';
import { AreaTable } from './components/AreaTable';
import { CandidateDrawer } from './components/CandidateDrawer';
import { CandidateList, LeaderCards } from './components/Candidates';
import { Evolution } from './components/Evolution';
import { CargoTabs, ProgressStrip, ScopeHeader, ViewTabs } from './components/Header';
import { MapPanel, useMapModes } from './components/MapPanel';
import { NationalPanorama } from './components/National';
import { TimeMachine } from './components/TimeMachine';
import { TopBar } from './components/TopBar';
import { Empty } from './components/ui';
import { usePoll } from './hooks/usePoll';
import { useRoute } from './hooks/useRoute';
import { useTheme } from './hooks/useTheme';
import { urls } from './lib/api';
import { readPalette } from './lib/palette';
import { AppCtx, useApp, type AppState } from './state';
import { CompareView } from './views/Compare';
import { PartiesView } from './views/Parties';
import { ProfileView } from './views/Profile';

export function App() {
  const [route, go] = useRoute();
  const [theme, setTheme, resolved] = useTheme();
  const palette = useMemo(() => readPalette(), [resolved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [t, setT] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  const meta = usePoll<MetaPayload>(urls.meta({ turno: route.turno }), 60_000);
  const isDemo = meta.data?.source === 'demo';
  const tq = isDemo ? t : undefined;
  const refresh = tq !== undefined ? null : (meta.data?.refreshSeconds ?? 30) * 1000;
  const munisPoll = usePoll<Municipality[]>(meta.data ? urls.municipios({}) : null, null);

  const needsUf = route.cargo !== 'presidente' && !route.uf;
  const q = { cargo: route.cargo, uf: route.uf, mu: route.mu, turno: route.turno, t: tq };
  const result = usePoll<Result>(meta.data && !needsUf ? urls.resultado(q) : null, refresh);
  const focus = [...new Set([route.cand, ...route.cmp].filter((x): x is string => !!x))];
  const big = cargoInfo(route.cargo).proportional && !!route.uf;
  const mapUrl = meta.data ? urls.mapa({ cargo: route.cargo, uf: route.uf, turno: route.turno, t: tq }, big ? focus : [], route.det === 'mu' && !route.uf ? 'mu' : undefined) : null;
  const map = usePoll<MapPayload>(mapUrl, refresh);
  // Fonte ao vivo carrega os municípios aos poucos: consulta de novo em ritmo curto até completar.
  useEffect(() => {
    if (!map.data?.pending) return;
    const id = window.setTimeout(map.refresh, 2500);
    return () => window.clearTimeout(id);
  }, [map.data, map.refresh]);

  const munis = useMemo(() => new Map((munisPoll.data ?? []).map((m) => [m.code, m])), [munisPoll.data]);
  const cands = useMemo(() => {
    const m = new Map<string, CandidateLite>();
    for (const c of map.data?.candidates ?? []) m.set(c.id, c);
    for (const c of result.data?.candidates ?? []) m.set(c.id, { id: c.id, name: c.name, number: c.number, party: c.party, color: c.color, photo: c.photo });
    return m;
  }, [map.data, result.data]);
  const areaName = useMemo(() => (code: string) => (/^[a-z]{2}$/.test(code) ? ufName(code) : `${titleCase(munis.get(code)?.name ?? code)}${!route.uf && munis.get(code) ? ` (${munis.get(code)!.uf.toUpperCase()})` : ''}`), [munis, route.uf]);

  useEffect(() => {
    const where = route.mu ? titleCase(munis.get(route.mu)?.name ?? '') : route.uf ? ufName(route.uf) : 'Brasil';
    document.title = `${cargoInfo(route.cargo).label} · ${where} — Radar Eleições - Triad3`;
  }, [route.cargo, route.uf, route.mu, munis]);

  const state: AppState = { route, go, palette, meta: meta.data, result, map, munis, muniList: munisPoll.data ?? [], cands, t: tq, isDemo, areaName };

  return (
    <AppCtx.Provider value={state}>
      <div className={`app ${isDemo ? 'has-tm' : ''}`}>
        <TopBar theme={theme} setTheme={setTheme} />
        {isDemo ? (
          <div className="banner demo">
            <b>Modo simulação</b> — candidatos, números e resultados são <b>fictícios</b>, gerados para demonstrar o sistema.
            {meta.data?.warnings.length ? ' A fonte ao vivo (API Brasil Paralelo → TSE) não respondeu agora; ela é testada a cada minuto e assume sozinha quando voltar.' : ' Rode com AGORA_MODE=live para a apuração real.'}
          </div>
        ) : meta.data?.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
        {meta.error && !meta.data && <div className="banner error">Não foi possível conectar à API do Radar Eleições ({meta.error}). Verifique se o servidor está rodando.</div>}
        <main className="main">
          <ScopeHeader />
          <CargoTabs />
          {!needsUf && <ProgressStrip r={result.data} />}
          <ViewTabs />
          {result.error && !needsUf && <div className="banner error">{result.error}</div>}
          <Body />
        </main>
        <CandidateDrawer />
        {isDemo && <TimeMachine t={t} setT={setT} playing={playing} setPlaying={setPlaying} />}
      </div>
    </AppCtx.Provider>
  );
}

function Body() {
  const { route, result } = useApp();
  const { prop } = useMapModes();
  const needsUf = route.cargo !== 'presidente' && !route.uf;
  if (route.view === 'comparar') return needsUf ? <PickState /> : <CompareView />;
  if (route.view === 'partidos') return <PartiesView />;
  if (route.view === 'perfil') return needsUf ? <PickState /> : <ProfileView />;
  if (needsUf) {
    return (
      <div className="grid-geral national">
        <MapPanel />
        <div className="stack"><NationalPanorama /></div>
      </div>
    );
  }
  const r = result.data;
  return (
    <>
      <div className="grid-geral">
        <MapPanel />
        <div className="stack">
          {r ? <>{!prop && <LeaderCards r={r} />}<CandidateList r={r} limitDefault={prop ? 30 : 15} /></> : <Empty>{result.loading ? 'Carregando resultado…' : 'Sem resultado.'}</Empty>}
        </div>
      </div>
      {r && !prop && <Evolution r={r} />}
      {!route.mu && <AreaTable />}
    </>
  );
}

function PickState() {
  return <Empty>Este cargo é disputado em cada estado. Escolha um estado no mapa da visão geral ou pela busca (tecla <kbd>/</kbd>).</Empty>;
}
