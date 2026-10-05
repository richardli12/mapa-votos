import { useMemo } from 'react';
import { cargoInfo } from '../../shared/cargos';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import { UFS } from '../../shared/ufs';
import { partySlots, ranked, totalOf } from '../lib/mapcolor';
import { slotColor } from '../lib/palette';
import { useApp } from '../state';
import { Hemicycle } from './Hemicycle';
import { Avatar, Card, Empty } from './ui';

/** Panorama nacional dos cargos estaduais: as 27 disputas lado a lado. */
export function NationalPanorama() {
  const { map, cands, go, route, palette } = useApp();
  const prop = cargoInfo(route.cargo).proportional;
  const areas = useMemo(() => new Map((map.data?.areas ?? []).map((a) => [a.code, a])), [map.data]);
  const seats = route.cargo === 'senador' ? 2 : 1;

  // Composição nacional (soma das cadeiras por UF ou dos líderes de cada disputa)
  const composition = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of areas.values()) {
      if (prop) { for (const [p, n] of Object.entries(a.partySeats ?? {})) m.set(p, (m.get(p) ?? 0) + n); continue; }
      const winners = a.winners?.length ? a.winners : totalOf(a) > 0 ? ranked(a).slice(0, seats).map(([id]) => id) : [];
      for (const id of winners) { const p = cands.get(id)?.party; if (p) m.set(p, (m.get(p) ?? 0) + 1); }
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [areas, prop, cands, seats]);
  const slots = useMemo(() => partySlots(composition.map(([p]) => p)), [composition]);
  const total = composition.reduce((s, [, n]) => s + n, 0);
  const finals = [...areas.values()].filter((a) => a.status === 'encerrada').length;
  const label = route.cargo === 'governador' ? 'governos estaduais' : route.cargo === 'senador' ? 'cadeiras no Senado' : route.cargo === 'depfederal' ? 'cadeiras na Câmara' : 'cadeiras nas Assembleias';

  if (!map.data) return <Card title="Panorama nacional"><Empty>Carregando as 27 disputas…</Empty></Card>;
  return (
    <>
      <Card title={`Panorama nacional — ${fmtInt(total)} ${label}`} sub={`${finals} de 27 estados com apuração encerrada · ${prop ? 'cadeiras eleitas ou projetadas pela contagem atual' : finals === 27 ? 'resultado final' : 'líderes atuais (projeção)'}`}>
        {total > 0 ? (
          <div className="composition stacked-comp">
            <Hemicycle parts={composition.map(([p, n]) => ({ key: p, label: p, seats: n, color: slotColor(palette, slots.get(p) ?? -1) }))} total={total} otherColor={palette.other} />
            <ul className="comp-list">
              {composition.map(([p, n]) => (
                <li key={p}><i style={{ background: slotColor(palette, slots.get(p) ?? -1) }} /><span>{p}</span><b className="num">{n}</b><small className="num">{fmtPct((n / total) * 100, 1)}</small></li>
              ))}
            </ul>
          </div>
        ) : <Empty>Aguardando os primeiros resultados.</Empty>}
      </Card>
      <div className="uf-grid">
        {UFS.map((u) => {
          const a = areas.get(u.uf);
          const top = a && totalOf(a) > 0 ? ranked(a).slice(0, prop ? 0 : seats + 1) : [];
          const parties = prop && a?.partyVotes ? Object.entries(a.partyVotes).sort((x, y) => y[1] - x[1]).slice(0, 3) : [];
          const pvTotal = prop && a?.partyVotes ? Object.values(a.partyVotes).reduce((s, v) => s + v, 0) : 0;
          return (
            <button key={u.uf} className="uf-card" onClick={() => go({ uf: u.uf })}>
              <span className="uf-head"><b>{u.uf.toUpperCase()}</b><span>{u.name}</span><small className="num">{a ? fmtPct(a.pctCounted, 1) : '—'}</small></span>
              <span className="uf-prog"><span style={{ width: `${a?.pctCounted ?? 0}%` }} /></span>
              {top.map(([id, v], i) => {
                const c = cands.get(id);
                const st = a?.statuses?.[id];
                return (
                  <span key={id} className={`uf-cand ${i >= seats ? 'dim' : ''}`}>
                    <Avatar name={c?.name ?? '?'} photo={c?.photo} color={c?.color ?? -1} size={26} elected={!!st?.startsWith('Eleito')} />
                    <span className="uf-cn">{titleCase(c?.name ?? id)}<small>{c?.party}{st ? ` · ${st}` : ''}</small></span>
                    <b className="num">{fmtPct((v / totalOf(a!)) * 100, 1)}</b>
                  </span>
                );
              })}
              {parties.map(([p, v]) => (
                <span key={p} className="uf-cand">
                  <i className="dot-c" style={{ background: slotColor(palette, slots.get(p) ?? -1) }} />
                  <span className="uf-cn">{p}<small>{a?.partySeats?.[p] ? `${a.partySeats[p]} cadeira(s)` : ''}</small></span>
                  <b className="num">{fmtPct((v / (pvTotal || 1)) * 100, 1)}</b>
                </span>
              ))}
              {!a || totalOf(a) === 0 ? <span className="uf-wait">Aguardando votos</span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
