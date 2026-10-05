import { useMemo, useState } from 'react';
import { cargoInfo } from '../../shared/cargos';
import { fmtCompact, fmtInt, fmtPct, titleCase } from '../../shared/format';
import { REGIONS, ufInfo } from '../../shared/ufs';
import type { CandidateLite, MapArea } from '../../shared/types';
import { Card, Empty, slotVar } from '../components/ui';
import { useWidth } from '../hooks/useWidth';
import { totalOf } from '../lib/mapcolor';
import { useApp } from '../state';

interface Group { key: string; label: string; sub?: string; areas: MapArea[] }

function Stacked({ groups, cands }: { groups: Group[]; cands: CandidateLite[] }) {
  return (
    <div className="stacked">
      {groups.map((g) => {
        const total = g.areas.reduce((s, a) => s + totalOf(a), 0);
        const parts = cands.map((c) => ({ c, v: g.areas.reduce((s, a) => s + (a.votes[c.id] ?? 0), 0) }));
        const other = Math.max(0, total - parts.reduce((s, p) => s + p.v, 0));
        const electorate = g.areas.reduce((s, a) => s + a.electorate, 0);
        return (
          <div key={g.key} className="stacked-row">
            <div className="stacked-label"><b>{g.label}</b><small>{g.sub ?? `${fmtInt(g.areas.length)} áreas · ${fmtCompact(electorate)} eleitores`}</small></div>
            <div className="stacked-bar" role="img" aria-label={`${g.label}: ${parts.map((p) => `${titleCase(p.c.name)} ${fmtPct(total ? (p.v / total) * 100 : 0, 1)}`).join(', ')}`}>
              {total ? <>
                {parts.map((p) => {
                  const pct = (p.v / total) * 100;
                  return <span key={p.c.id} style={{ width: `${pct}%`, background: slotVar(p.c.color) }} title={`${titleCase(p.c.name)}: ${fmtPct(pct)}`}>{pct >= 8 && <b className="num">{fmtPct(pct, 0)}</b>}</span>;
                })}
                {other > 0 && <span className="other" style={{ width: `${(other / total) * 100}%` }} title={`Outros: ${fmtPct((other / total) * 100)}`} />}
              </> : <span className="none">sem votos</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SIZE: { key: string; label: string; test: (e: number) => boolean }[] = [
  { key: 'a', label: 'Até 10 mil eleitores', test: (e) => e < 10_000 },
  { key: 'b', label: '10 a 50 mil', test: (e) => e >= 10_000 && e < 50_000 },
  { key: 'c', label: '50 a 200 mil', test: (e) => e >= 50_000 && e < 200_000 },
  { key: 'd', label: '200 mil a 1 milhão', test: (e) => e >= 200_000 && e < 1_000_000 },
  { key: 'e', label: 'Mais de 1 milhão', test: (e) => e >= 1_000_000 },
];

export function ProfileView() {
  const { route, go, map, munis, result, cands } = useApp();
  const r = result.data;
  const [scatterCand, setScatterCand] = useState<string | undefined>();
  const prop = cargoInfo(route.cargo).proportional;
  const areas = map.data?.areas ?? [];
  const muniLevel = !!route.uf || route.det === 'mu';
  const top = useMemo(() => (r?.candidates ?? []).slice(0, prop ? 5 : 4).map((c) => cands.get(c.id)!).filter(Boolean), [r, cands, prop]);

  const regions = useMemo<Group[]>(() => (!route.uf && route.cargo === 'presidente')
    ? REGIONS.map((reg) => ({ key: reg, label: reg, areas: areas.filter((a) => (ufInfo(a.code)?.region ?? ufInfo(munis.get(a.code)?.uf ?? '')?.region) === reg) }))
    : [], [areas, route.uf, route.cargo, munis]);
  const sizes = useMemo<Group[]>(() => muniLevel ? SIZE.map((s) => ({ key: s.key, label: s.label, areas: areas.filter((a) => s.test(a.electorate) && !munis.get(a.code)?.capital) })).filter((g) => g.areas.length) : [], [areas, muniLevel, munis]);
  const capital = useMemo<Group[]>(() => muniLevel ? [
    { key: 'cap', label: route.uf ? 'Capital' : 'Capitais', areas: areas.filter((a) => munis.get(a.code)?.capital) },
    { key: 'int', label: 'Interior', areas: areas.filter((a) => !munis.get(a.code)?.capital) },
  ] : [], [areas, muniLevel, munis, route.uf]);

  if (!r && route.cargo !== 'presidente' && !route.uf) {
    return <Empty>O perfil do voto é calculado dentro de cada disputa. Escolha um estado no mapa ou na busca.</Empty>;
  }
  if (!map.data) return <Empty>Carregando dados por área…</Empty>;
  if (!top.length) return <Empty>Aguardando votos.</Empty>;

  const sc = scatterCand && cands.get(scatterCand) ? cands.get(scatterCand)! : top[0];
  return (
    <div className="stack">
      <Card title="Legenda">
        <div className="evo-legend">{top.map((c) => <span key={c.id}><i style={{ background: slotVar(c.color) }} />{titleCase(c.name)} <small>{c.party}</small></span>)}<span><i style={{ background: 'var(--other)' }} />Outros</span></div>
      </Card>
      {regions.length > 0 && <Card title="Por região" sub="Distribuição dos votos válidos em cada região do país"><Stacked groups={regions} cands={top} /></Card>}
      {muniLevel ? (
        <>
          <Card title="Capital × interior" sub="O voto urbano contra o resto do estado"><Stacked groups={capital.filter((g) => g.areas.length)} cands={top} /></Card>
          <Card title="Por porte do município" sub="Municípios agrupados pelo tamanho do eleitorado (sem capitais)"><Stacked groups={sizes} cands={top} /></Card>
          <Card title="Dispersão: tamanho × votação" sub="Cada ponto é um município. Eixo horizontal em escala logarítmica."
            actions={<select className="input sm" value={sc.id} onChange={(e) => setScatterCand(e.target.value)} aria-label="Candidato da dispersão">{top.map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)}</option>)}</select>}>
            <Scatter areas={areas} cand={sc} names={(code) => titleCase(munis.get(code)?.name ?? code)} />
          </Card>
        </>
      ) : (
        <Card title="Perfil por município">
          <div className="cta">
            <p>Para ver o voto por porte de cidade, capital × interior e a dispersão, carregue os 5.570 municípios do país.</p>
            <button className="primary-btn" onClick={() => go({ det: 'mu' })}>Carregar Brasil por município</button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Scatter({ areas, cand, names }: { areas: MapArea[]; cand: CandidateLite; names: (c: string) => string }) {
  const [hover, setHover] = useState<{ code: string; x: number; y: number; pct: number; e: number } | null>(null);
  const [box, W] = useWidth<HTMLDivElement>(720);
  const H = W < 560 ? 260 : 320, L = 44, R = 14, T = 12, B = 34;
  const pts = areas.filter((a) => totalOf(a) > 0).map((a) => ({ code: a.code, e: Math.max(1000, a.electorate), pct: ((a.votes[cand.id] ?? 0) / totalOf(a)) * 100 }));
  if (!pts.length) return <div ref={box}><Empty>Sem votos ainda.</Empty></div>;
  const minE = 3, maxE = Math.log10(Math.max(...pts.map((p) => p.e))) + 0.1;
  const yMax = Math.min(100, Math.ceil(Math.max(...pts.map((p) => p.pct)) / 10) * 10 || 10);
  const x = (e: number) => L + ((Math.log10(e) - minE) / (maxE - minE)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  // média ponderada por faixa (linha de tendência simples)
  const bins = Array.from({ length: 10 }, (_, i) => minE + ((i + 0.5) * (maxE - minE)) / 10);
  const trend = bins.map((b) => {
    const inBin = pts.filter((p) => Math.abs(Math.log10(p.e) - b) <= (maxE - minE) / 20);
    const w = inBin.reduce((s, p) => s + p.e, 0);
    return inBin.length >= 3 ? { b, v: inBin.reduce((s, p) => s + p.pct * p.e, 0) / w } : null;
  }).filter((t): t is { b: number; v: number } => !!t);
  return (
    <div className="scatter" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Dispersão da votação de ${titleCase(cand.name)} por tamanho do município`} onPointerLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(f * yMax)} y2={y(f * yMax)} /><text className="axis" x={L - 6} y={y(f * yMax) + 4} textAnchor="end">{Math.round(f * yMax)}%</text></g>)}
        {[1e3, 1e4, 1e5, 1e6, 1e7].filter((e) => Math.log10(e) <= maxE).map((e) => <text key={e} className="axis" x={x(e)} y={H - 12} textAnchor="middle">{fmtCompact(e)}</text>)}
        <text className="axis" x={W - R} y={H - 12} textAnchor="end">eleitores →</text>
        {pts.map((p) => <circle key={p.code} cx={x(p.e)} cy={y(p.pct)} r={hover?.code === p.code ? 6 : 2.6} fill={slotVar(cand.color)} fillOpacity={0.55} stroke="var(--surface-1)" strokeWidth={0.6}
          onPointerEnter={() => setHover({ code: p.code, x: x(p.e), y: y(p.pct), pct: p.pct, e: p.e })} />)}
        {trend.length > 1 && <polyline fill="none" stroke="var(--text-primary)" strokeWidth={2} points={trend.map((t) => `${L + ((t.b - minE) / (maxE - minE)) * (W - L - R)},${y(t.v)}`).join(' ')} />}
      </svg>
      {hover && <div className="evo-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}><b>{names(hover.code)}</b><span>{fmtPct(hover.pct, 1)} · {fmtInt(hover.e)} eleitores</span></div>}
      <p className="muted small">Linha: média ponderada pelo eleitorado em cada faixa de tamanho.</p>
    </div>
  );
}
