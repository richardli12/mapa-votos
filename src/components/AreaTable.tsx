import { useMemo, useState } from 'react';
import { fmtInt, fmtPct, normalizeText, titleCase } from '../../shared/format';
import { ranked, totalOf } from '../lib/mapcolor';
import { useApp } from '../state';
import { Exportar } from './Exportar';
import { Avatar, Bar, Card, slotVar } from './ui';

type SortKey = 'nome' | 'apurado' | 'lider' | 'margem' | 'comparecimento' | 'eleitorado';

/** Tabela das áreas do mapa (estados ou municípios) com líder, vice-líder e margem. */
export function AreaTable() {
  const { map, cands, areaName, go, route, munis } = useApp();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'eleitorado', desc: true });
  const [limit, setLimit] = useState(30);
  const unit = route.uf ? 'Município' : route.det === 'mu' ? 'Município' : 'Estado';

  const rows = useMemo(() => (map.data?.areas ?? []).map((a) => {
    const r = ranked(a), total = totalOf(a);
    const l = r[0], s = r[1];
    return {
      code: a.code, name: areaName(a.code), a, total,
      leader: l && l[1] ? cands.get(l[0]) : undefined, lpct: l && total ? (l[1] / total) * 100 : 0,
      second: s && s[1] ? cands.get(s[0]) : undefined, spct: s && total ? (s[1] / total) * 100 : 0,
    };
  }), [map.data, cands, areaName]);

  const list = useMemo(() => {
    const n = normalizeText(q);
    const l = rows.filter((r) => !n || normalizeText(r.name).includes(n));
    const val = (r: (typeof rows)[number]): number | string => {
      switch (sort.k) {
        case 'nome': return r.name;
        case 'apurado': return r.a.pctCounted;
        case 'lider': return r.lpct;
        case 'margem': return r.lpct - r.spct;
        case 'comparecimento': return r.a.turnoutPct;
        default: return r.a.electorate;
      }
    };
    return [...l].sort((x, y) => { const a = val(x), b = val(y); const c = typeof a === 'string' ? a.localeCompare(b as string, 'pt-BR') : (a as number) - (b as number); return sort.desc ? -c : c; });
  }, [rows, q, sort]);

  if (!rows.length) return null;
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`${cls} sortable ${sort.k === k ? 'on' : ''}`} onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== 'nome' }))} aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      {label}{sort.k === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );
  return (
    <Card title={`Resultado por ${unit.toLowerCase()}`} sub={`${fmtInt(rows.length)} ${route.uf || route.det ? 'municípios' : 'estados'} — clique para abrir`}
      actions={<>
        <input className="input sm" placeholder={`Filtrar ${unit.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar áreas" />
        <Exportar montar={() => ({
          arquivo: `${unit === 'Estado' ? 'estados' : 'municipios'}-${route.cargo}-${route.uf ?? 'br'}`,
          titulo: `Resultado por ${unit.toLowerCase()}`,
          subtitulo: q ? `Filtro: "${q}" — ${fmtInt(list.length)} de ${fmtInt(rows.length)}` : `${fmtInt(rows.length)} ${unit === 'Estado' ? 'estados' : 'municípios'}`,
          colunas: [{ titulo: unit }, { titulo: '% apurado', tipo: 'pct' }, { titulo: 'Líder' }, { titulo: 'Partido' }, { titulo: '% líder', tipo: 'pct', barra: true }, { titulo: '2º colocado' }, { titulo: '% 2º', tipo: 'pct' }, { titulo: 'Margem (p.p.)', tipo: 'num' }, { titulo: 'Comparec.', tipo: 'pct' }, { titulo: 'Eleitores', tipo: 'int' }],
          linhas: list.map((r) => [r.name, r.a.pctCounted, r.leader ? titleCase(r.leader.name) : '', r.leader?.party ?? '', r.lpct, r.second ? titleCase(r.second.name) : '', r.spct, Number((r.lpct - r.spct).toFixed(2)), r.a.turnoutPct, r.a.electorate]),
        })} />
      </>}>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            {th('nome', unit)}{th('apurado', 'Apurado', 'r')}{th('lider', 'Líder')}<th>2º colocado</th>{th('margem', 'Margem', 'r')}{th('comparecimento', 'Compar.', 'r hide-sm')}{th('eleitorado', 'Eleitores', 'r hide-sm')}
          </tr></thead>
          <tbody>
            {list.slice(0, limit).map((r) => (
              <tr key={r.code} onClick={() => go(route.uf ? { mu: r.code } : route.det === 'mu' ? { uf: munis.get(r.code)?.uf, mu: r.code, det: undefined } : { uf: r.code })} className={route.mu === r.code ? 'on' : ''}>
                <td className="strong">{r.name}</td>
                <td className="r"><span className="mini-progress"><span style={{ width: `${r.a.pctCounted}%` }} /></span><span className="num">{fmtPct(r.a.pctCounted, 1)}</span></td>
                <td>{r.leader ? <span className="who"><Avatar name={r.leader.name} photo={r.leader.photo} color={r.leader.color} size={22} /><span>{titleCase(r.leader.name)}<small>{r.leader.party}</small></span><b className="num">{fmtPct(r.lpct, 1)}</b></span> : <span className="muted">—</span>}</td>
                <td>{r.second ? <span className="who dim"><i className="dot-c" style={{ background: slotVar(r.second.color) }} /><span>{titleCase(r.second.name)}</span><b className="num">{fmtPct(r.spct, 1)}</b></span> : <span className="muted">—</span>}</td>
                <td className="r"><span className="margin-cell"><Bar pct={r.lpct - r.spct} max={40} color={slotVar(r.leader?.color ?? -1)} height={4} /><span className="num">{(r.lpct - r.spct).toFixed(1).replace('.', ',')}</span></span></td>
                <td className="r num hide-sm">{fmtPct(r.a.turnoutPct, 1)}</td>
                <td className="r num hide-sm">{fmtInt(r.a.electorate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > limit && <button className="more-btn" onClick={() => setLimit((l) => l + 50)}>Mostrar mais ({fmtInt(list.length - limit)})</button>}
    </Card>
  );
}
