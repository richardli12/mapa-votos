import { Fragment, useEffect, useMemo } from 'react';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import { totalOf } from '../lib/mapcolor';
import { useApp } from '../state';
import { Avatar, Bar, slotVar, StatusBadge } from './ui';

function age(birth?: string) {
  if (!birth || !/^\d{2}\/\d{2}\/\d{4}$/.test(birth)) return null;
  const [d, m, y] = birth.split('/').map(Number);
  const now = new Date(2026, 9, 4);
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}

const ROLE: Record<string, string> = { v: 'Vice', s1: '1º suplente', s2: '2º suplente' };

export function CandidateDrawer() {
  const { route, go, result, map, areaName, cands } = useApp();
  const r = result.data;
  const c = r?.candidates.find((x) => x.id === route.cand);
  const lite = route.cand ? cands.get(route.cand) : undefined;

  useEffect(() => {
    if (!route.cand) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') go({ cand: undefined }); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [route.cand, go]);

  const areas = useMemo(() => {
    if (!route.cand || !map.data) return null;
    const list = map.data.areas.map((a) => ({ code: a.code, v: a.votes[route.cand!], total: totalOf(a), lead: Object.entries(a.votes).sort((x, y) => y[1] - x[1])[0]?.[0] === route.cand }))
      .filter((a) => a.v !== undefined && a.total > 0).map((a) => ({ ...a, pct: (a.v! / a.total) * 100 }));
    if (!list.length) return null;
    return {
      best: [...list].sort((a, b) => b.pct - a.pct).slice(0, 6),
      worst: [...list].sort((a, b) => a.pct - b.pct).slice(0, 4),
      votes: [...list].sort((a, b) => b.v! - a.v!).slice(0, 6),
      led: list.filter((a) => a.lead).length, n: list.length,
    };
  }, [route.cand, map.data]);

  if (!route.cand) return null;
  const name = c?.name ?? lite?.name ?? '';
  const position = c && r ? r.candidates.indexOf(c) + 1 : null;
  const unit = route.uf ? 'municípios' : 'estados';
  const ag = age(c?.birth);

  return (
    <>
      <div className="drawer-scrim" onClick={() => go({ cand: undefined })} />
      <aside className="drawer" role="dialog" aria-label={`Ficha de ${titleCase(name)}`} style={{ ['--c' as string]: slotVar(c?.color ?? lite?.color ?? -1) }}>
        <button className="drawer-close" onClick={() => go({ cand: undefined })} aria-label="Fechar">×</button>
        {!c && !lite ? <div className="empty">Candidato não está neste recorte.</div> : (
          <>
            <div className="drawer-hero">
              <Avatar name={name} photo={c?.photo ?? lite?.photo} color={c?.color ?? lite?.color ?? -1} size={104} elected={c?.elected} />
              <div>
                <div className="drawer-number num">{c?.number ?? lite?.number}</div>
                <h2>{titleCase(name)}</h2>
                {c && <p className="drawer-full">{titleCase(c.fullName)}{ag ? ` · ${ag} anos` : ''}</p>}
                <p className="drawer-party"><b>{c?.party ?? lite?.party}</b> {c?.partyName && `· ${c.partyName}`}</p>
                {c && <StatusBadge status={c.status} projected={c.projected} />}
              </div>
            </div>
            {c && r && (
              <div className="drawer-stats">
                <div><span>Votos</span><b className="num">{fmtInt(c.votes)}</b></div>
                <div><span>% válidos</span><b className="num">{fmtPct(c.pct)}</b></div>
                <div><span>Posição</span><b className="num">{position}º <small>de {r.candidates.length}</small></b></div>
                {areas && <div><span>Lidera em</span><b className="num">{areas.led} <small>{unit}</small></b></div>}
              </div>
            )}
            {c && (c.coalition || c.federation || c.runningMates.length > 0) && (
              <dl className="drawer-facts">
                {c.coalition && <><dt>{c.coalitionParties ? 'Coligação' : 'Federação'}</dt><dd>{c.coalition}{c.coalitionParties && <small>{c.coalitionParties}</small>}</dd></>}
                {c.federation && !c.coalition && <><dt>Federação</dt><dd>{c.federation}</dd></>}
                {c.runningMates.map((m) => <Fragment key={m.role}><dt>{ROLE[m.role] ?? 'Chapa'}</dt><dd>{titleCase(m.name)} <small>{m.party}</small></dd></Fragment>)}
              </dl>
            )}
            <div className="drawer-actions">
              <button className="primary-btn" onClick={() => go({ mode: 'forca', view: 'geral' })}>Mapa de força</button>
              <button className="ghost-btn" onClick={() => go({ cmp: route.cmp.includes(route.cand!) ? route.cmp.filter((x) => x !== route.cand) : [...route.cmp, route.cand!].slice(-4) })}>
                {route.cmp.includes(route.cand) ? '✓ No comparativo' : '+ Comparar'}
              </button>
              {r && r.candidates[0]?.id !== route.cand && r.seats === 1 && (
                <button className="ghost-btn" onClick={() => go({ mode: 'duelo', cmp: [r.candidates[0].id, route.cand!], view: 'geral', cand: undefined })}>Duelo com o líder</button>
              )}
            </div>
            {areas && (
              <div className="drawer-areas">
                <AreaList title={`Onde vai melhor (% dos válidos)`} rows={areas.best.map((a) => ({ k: a.code, name: areaName(a.code), pct: a.pct, v: a.v! }))} onPick={(k) => go(route.uf ? { mu: k } : { uf: k })} />
                <AreaList title="Onde tem mais votos" rows={areas.votes.map((a) => ({ k: a.code, name: areaName(a.code), pct: a.pct, v: a.v! }))} onPick={(k) => go(route.uf ? { mu: k } : { uf: k })} />
                <AreaList title="Onde vai pior" rows={areas.worst.map((a) => ({ k: a.code, name: areaName(a.code), pct: a.pct, v: a.v! }))} onPick={(k) => go(route.uf ? { mu: k } : { uf: k })} />
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function AreaList({ title, rows, onPick }: { title: string; rows: { k: string; name: string; pct: number; v: number }[]; onPick: (k: string) => void }) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="area-list">
      <h3>{title}</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.k} onClick={() => onPick(r.k)}>
            <span className="al-name">{r.name}</span>
            <Bar pct={r.pct} max={max} color="var(--c)" height={5} />
            <span className="num">{fmtPct(r.pct, 1)}</span>
            <small className="num">{fmtInt(r.v)}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
