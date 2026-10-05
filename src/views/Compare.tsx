import { useMemo, useState } from 'react';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import { MapView } from '../components/MapView';
import { Exportar } from '../components/Exportar';
import { Avatar, Card, Empty, slotVar, StatusBadge } from '../components/ui';
import { colorAreas, totalOf } from '../lib/mapcolor';
import { slotColor } from '../lib/palette';
import { useApp } from '../state';

export function CompareView() {
  const { route, go, result, map, palette, cands, areaName } = useApp();
  const r = result.data;
  const [sortBy, setSortBy] = useState<string>('nome');
  const [limit, setLimit] = useState(40);
  const all = r?.candidates ?? [];
  const chosen = (route.cmp.length ? route.cmp : all.slice(0, 2).map((c) => c.id)).map((id) => all.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const ids = chosen.map((c) => c.id);

  const areas = useMemo(() => (map.data?.areas ?? []).filter((a) => totalOf(a) > 0).map((a) => {
    const total = totalOf(a);
    const pct = Object.fromEntries(ids.map((id) => [id, ((a.votes[id] ?? 0) / total) * 100]));
    const winner = ids.reduce((best, id) => (pct[id] > (pct[best] ?? -1) ? id : best), ids[0]);
    return { code: a.code, name: areaName(a.code), pct, winner, electorate: a.electorate };
  }), [map.data, ids.join(','), areaName]); // eslint-disable-line react-hooks/exhaustive-deps

  const wins = useMemo(() => { const m = new Map<string, number>(); for (const a of areas) m.set(a.winner, (m.get(a.winner) ?? 0) + 1); return m; }, [areas]);
  const sharedMax = useMemo(() => Math.max(5, ...areas.flatMap((a) => ids.map((id) => a.pct[id]))), [areas, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const geoKey = route.uf ? route.uf : route.det === 'mu' ? 'br-mun' : 'uf';
  const sorted = useMemo(() => [...areas].sort((a, b) => (sortBy === 'nome' ? a.name.localeCompare(b.name, 'pt-BR') : sortBy === 'eleitorado' ? b.electorate - a.electorate : b.pct[sortBy] - a.pct[sortBy])), [areas, sortBy]);

  if (!r) return <Empty>Carregando…</Empty>;
  if (all.length < 2) return <Empty>É preciso pelo menos dois candidatos para comparar.</Empty>;
  const combined = chosen.reduce((s, c) => s + c.votes, 0) || 1;
  const remaining = all.filter((c) => !ids.includes(c.id));
  const set = (next: string[]) => go({ cmp: next });

  return (
    <div className="stack">
      <Card title="Comparativo" sub="Escolha de 2 a 4 candidatos do mesmo cargo e recorte">
        <div className="cmp-picker">
          {chosen.map((c) => (
            <span key={c.id} className="chip" style={{ ['--c' as string]: slotVar(c.color) }}>
              <i />{titleCase(c.name)} <small>{c.party}</small>
              {chosen.length > 2 && <button aria-label={`Remover ${titleCase(c.name)}`} onClick={() => set(ids.filter((x) => x !== c.id))}>×</button>}
            </span>
          ))}
          {chosen.length < 4 && (
            <select className="input" value="" onChange={(e) => e.target.value && set([...ids, e.target.value])} aria-label="Adicionar candidato">
              <option value="">+ adicionar candidato</option>
              {remaining.slice(0, 400).map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)} ({c.party} {c.number})</option>)}
            </select>
          )}
        </div>
        <div className="cmp-cards" data-n={chosen.length}>
          {chosen.map((c) => (
            <button key={c.id} className="cmp-card" style={{ ['--c' as string]: slotVar(c.color) }} onClick={() => go({ cand: c.id })}>
              <Avatar name={c.name} photo={c.photo} color={c.color} size={64} elected={c.elected} />
              <span className="cmp-name">{titleCase(c.name)}</span>
              <span className="cmp-meta">{c.party} · {c.number}</span>
              <span className="cmp-pct num">{fmtPct(c.pct)}</span>
              <span className="cmp-votes num">{fmtInt(c.votes)} votos</span>
              <StatusBadge status={c.status} projected={c.projected} size="sm" />
              <span className="cmp-wins"><b className="num">{fmtInt(wins.get(c.id) ?? 0)}</b> {route.uf || route.det ? 'municípios' : 'estados'} vencidos no confronto</span>
            </button>
          ))}
        </div>
        <div className="h2h" aria-label="Divisão dos votos somados dos candidatos comparados">
          {chosen.map((c) => (
            <span key={c.id} style={{ width: `${(c.votes / combined) * 100}%`, background: slotVar(c.color) }} title={`${titleCase(c.name)}: ${fmtPct((c.votes / combined) * 100)}`}>
              {(c.votes / combined) * 100 > 9 && <b className="num">{fmtPct((c.votes / combined) * 100, 1)}</b>}
            </span>
          ))}
        </div>
        <p className="muted small">Barra: divisão dos votos somados apenas entre os candidatos comparados. Diferença entre 1º e 2º: <b className="num">{fmtInt(Math.abs(chosen[0].votes - chosen[1].votes))}</b> votos.</p>
      </Card>

      <div className={`maps-grid n${chosen.length}`}>
        {chosen.map((c) => {
          const col = colorAreas(map.data, { mode: 'forca', palette, cands, byParty: false, forca: c.id, forcaMax: sharedMax });
          return (
            <Card key={c.id} className="mini-map" title={<><i className="dot-c" style={{ background: slotVar(c.color) }} /> {titleCase(c.name)}</>} sub="% dos válidos — mesma escala em todos os mapas">
              <MapView geoKey={geoKey} fill={col.fill} emptyColor={palette.empty} ariaLabel={col.legend.title}
                renderTip={(code) => { const a = areas.find((x) => x.code === code); return <div className="tip"><strong>{areaName(code)}</strong>{a && <div className="num">{fmtPct(a.pct[c.id] ?? 0, 1)}</div>}</div>; }}
                overlay={<div className="legend mini"><ul className="legend-items seq">{col.legend.items.map((it) => <li key={it.label}><i style={{ background: it.color }} /><span>{it.label}</span></li>)}</ul></div>} />
            </Card>
          );
        })}
      </div>

      <Card title={`Confronto por ${route.uf || route.det ? 'município' : 'estado'}`} sub="Clique nos cabeçalhos para ordenar"
        actions={<Exportar montar={() => ({
          arquivo: `comparativo-${route.cargo}-${route.uf ?? 'br'}`,
          titulo: `Comparativo: ${chosen.map((c) => titleCase(c.name)).join(' × ')}`,
          resumo: chosen.map((c) => ({ label: `${titleCase(c.name)} (${c.party} ${c.number})`, valor: `${fmtPct(c.pct, 2)} · vence em ${fmtInt(wins.get(c.id) ?? 0)}`, pessoa: { nome: titleCase(c.name), foto: c.photo, cor: slotColor(palette, c.color) } })),
          cor: slotColor(palette, chosen[0]?.color ?? -1),
          colunas: [{ titulo: route.uf || route.det ? 'Município' : 'Estado' }, ...chosen.map((c) => ({ titulo: `${titleCase(c.name)} (%)`, tipo: 'pct' as const })), { titulo: 'Vencedor' }],
          linhas: sorted.map((a) => [a.name, ...ids.map((id) => a.pct[id]), titleCase(cands.get(a.winner)?.name ?? '')]),
        })} />}>
        {!areas.length ? <Empty>Sem dados por área ainda.</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th className={`sortable ${sortBy === 'nome' ? 'on' : ''}`} onClick={() => setSortBy('nome')}>Área</th>
                {chosen.map((c) => <th key={c.id} className={`r sortable cand-col ${sortBy === c.id ? 'on' : ''}`} onClick={() => setSortBy(c.id)}><i className="dot-c" style={{ background: slotVar(c.color) }} /> {titleCase(c.name)}</th>)}
                <th>Vencedor</th>
                <th className={`r sortable hide-sm ${sortBy === 'eleitorado' ? 'on' : ''}`} onClick={() => setSortBy('eleitorado')}>Eleitores</th>
              </tr></thead>
              <tbody>
                {sorted.slice(0, limit).map((a) => (
                  <tr key={a.code}>
                    <td className="strong">{a.name}</td>
                    {ids.map((id) => <td key={id} className={`r num ${a.winner === id ? 'win' : ''}`}>{fmtPct(a.pct[id], 1)}</td>)}
                    <td><span className="who"><i className="dot-c" style={{ background: slotVar(cands.get(a.winner)?.color ?? -1) }} />{titleCase(cands.get(a.winner)?.name ?? '')}</span></td>
                    <td className="r num hide-sm">{fmtInt(a.electorate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sorted.length > limit && <button className="more-btn" onClick={() => setLimit((l) => l + 60)}>Mostrar mais ({fmtInt(sorted.length - limit)})</button>}
      </Card>
    </div>
  );
}
