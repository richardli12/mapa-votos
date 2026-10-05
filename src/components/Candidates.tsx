import { useMemo, useState } from 'react';
import { cargoInfo, cargoLabel } from '../../shared/cargos';
import { fmtInt, fmtPct, normalizeText, titleCase } from '../../shared/format';
import type { Candidate, Result } from '../../shared/types';
import { slotColor } from '../lib/palette';
import { useApp } from '../state';
import { Exportar } from './Exportar';
import { Avatar, Bar, Card, Empty, Seg, slotVar, StatusBadge } from './ui';

export function LeaderCards({ r }: { r: Result }) {
  const { go } = useApp();
  const n = r.cargo === 'senador' ? Math.max(3, r.seats + 1) : 2;
  const top = r.candidates.slice(0, n);
  if (!top.length || r.totals.valid === 0) {
    return <div className="leaders waiting"><Empty>Aguardando os primeiros votos. Os candidatos aparecem abaixo assim que a apuração começar.</Empty></div>;
  }
  const gap = top.length > 1 ? top[0].pct - top[1].pct : 0;
  return (
    <div className="leaders" data-n={top.length}>
      {top.map((c, i) => (
        <button key={c.id} className={`leader ${i === 0 ? 'first' : ''}`} style={{ ['--c' as string]: slotVar(c.color) }} onClick={() => go({ cand: c.id })}>
          <span className="leader-rank">{i + 1}º</span>
          <Avatar name={c.name} photo={c.photo} color={c.color} size={i === 0 ? 76 : 60} elected={c.elected} />
          <span className="leader-body">
            <span className="leader-name">{titleCase(c.name)}</span>
            <span className="leader-meta">{c.party} · {c.number}{c.coalition ? ` · ${c.coalition}` : ''}</span>
            <span className="leader-pct num">{fmtPct(c.pct)}</span>
            <span className="leader-votes num">{fmtInt(c.votes)} votos</span>
            <StatusBadge status={c.status} projected={c.projected} />
          </span>
          <span className="leader-bar"><span style={{ width: `${c.pct}%` }} /></span>
        </button>
      ))}
      {top.length > 1 && r.cargo !== 'senador' && (
        <div className="leader-gap"><b className="num">{gap.toFixed(2).replace('.', ',')}</b> p.p. de vantagem · {fmtInt(top[0].votes - top[1].votes)} votos</div>
      )}
    </div>
  );
}

type StatusFilter = 'todos' | 'eleitos' | 'segundo' | 'projecao';

export function CandidateList({ r, limitDefault = 40 }: { r: Result; limitDefault?: number }) {
  const { go, route, palette } = useApp();
  const [q, setQ] = useState('');
  const [party, setParty] = useState('');
  const [st, setSt] = useState<StatusFilter>('todos');
  const [sort, setSort] = useState<'votos' | 'nome' | 'numero'>('votos');
  const [limit, setLimit] = useState(limitDefault);
  const prop = cargoInfo(r.cargo).proportional;
  const max = r.candidates[0]?.pct || 1;

  const list = useMemo(() => {
    const n = normalizeText(q);
    let l = r.candidates.filter((c) => (!n || normalizeText(c.name).includes(n) || normalizeText(c.fullName).includes(n) || c.number.startsWith(q.trim()))
      && (!party || c.party === party)
      && (st === 'todos' || (st === 'eleitos' && c.elected) || (st === 'segundo' && c.status.includes('2º turno')) || (st === 'projecao' && (c.projected || c.elected))));
    if (sort === 'nome') l = [...l].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (sort === 'numero') l = [...l].sort((a, b) => Number(a.number) - Number(b.number));
    return l;
  }, [r, q, party, st, sort]);

  const parties = useMemo(() => [...new Set(r.candidates.map((c) => c.party))].sort(), [r]);
  const rank = useMemo(() => new Map(r.candidates.map((c, i) => [c.id, i + 1])), [r]);
  const toggleCmp = (c: Candidate) => {
    const has = route.cmp.includes(c.id);
    go({ cmp: has ? route.cmp.filter((x) => x !== c.id) : [...route.cmp, c.id].slice(-4) });
  };
  const statusOptions: { id: StatusFilter; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    ...(prop ? [{ id: 'projecao' as const, label: r.status === 'encerrada' ? 'Eleitos' : 'Projeção' }] : [
      { id: 'eleitos' as const, label: 'Eleitos' },
      ...(r.cargo === 'senador' ? [] : [{ id: 'segundo' as const, label: '2º turno' }]),
    ]),
  ];

  return (
    <Card className="cand-card" title={<>Candidatos <span className="count">{fmtInt(r.candidates.length)}</span></>}
      actions={<Exportar montar={() => ({
        arquivo: `candidatos-${r.cargo}-${r.scope.uf ?? 'br'}${r.scope.mu ? '-' + r.scope.mu : ''}`,
        titulo: `${cargoLabel(r.cargo, r.scope.uf)} — resultado dos candidatos`,
        resumo: [
          { label: 'Votos válidos', valor: fmtInt(r.totals.valid) },
          { label: 'Comparecimento', valor: fmtPct(r.totals.turnoutPct, 2) },
          { label: 'Brancos', valor: fmtPct(r.totals.blankPct, 2) },
          { label: 'Nulos', valor: fmtPct(r.totals.nullPct, 2) },
        ],
        colunas: [{ titulo: 'Pos.', tipo: 'int' }, { titulo: '', tipo: 'foto' }, { titulo: 'Número' }, { titulo: 'Nome' }, { titulo: 'Partido' }, { titulo: 'Coligação / Federação' }, { titulo: 'Votos', tipo: 'int' }, { titulo: '% válidos', tipo: 'pct', barra: true }, { titulo: 'Situação' }],
        pessoas: r.candidates.map((c) => ({ nome: titleCase(c.name), foto: c.photo, cor: slotColor(palette, c.color) })),
        linhas: r.candidates.map((c, i) => [i + 1, null, c.number, titleCase(c.name), c.party, c.coalition ?? c.federation ?? '', c.votes, c.pct, c.status || (c.projected ? 'Projeção' : '')]),
      })} />}>
      <div className="filters">
        <input className="input" placeholder="Nome ou número…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(limitDefault); }} aria-label="Filtrar candidatos" />
        {parties.length > 1 && (
          <select className="input" value={party} onChange={(e) => setParty(e.target.value)} aria-label="Partido">
            <option value="">Todos os partidos</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar">
          <option value="votos">Mais votados</option><option value="nome">Nome (A–Z)</option><option value="numero">Número</option>
        </select>
        <Seg size="sm" label="Situação" value={st} onChange={setSt} options={statusOptions} />
      </div>
      {list.length === 0 ? <Empty>Nenhum candidato com esses filtros.</Empty> : (
        <ol className="cand-list">
          {list.slice(0, limit).map((c) => (
            <li key={c.id} className={`cand-row ${route.cand === c.id ? 'on' : ''} ${c.elected ? 'elected' : ''} ${c.projected ? 'projected' : ''} ${!c.valid ? 'invalid' : ''}`}>
              <span className="cr-rank num">{rank.get(c.id)}</span>
              <button className="cr-main" onClick={() => go({ cand: c.id })}>
                <Avatar name={c.name} photo={c.photo} color={c.color} size={38} elected={c.elected} />
                <span className="cr-name">
                  <span>{titleCase(c.name)}</span>
                  <small><b style={{ color: 'var(--text-secondary)' }}>{c.party}</b> · {c.number}{c.federation ? ` · ${c.federation}` : c.coalition ? ` · ${c.coalition}` : ''}</small>
                  <StatusBadge status={c.status} projected={c.projected} size="sm" />{!c.valid && <span className="badge out sm">Anulado</span>}
                </span>
                <span className="cr-bar"><Bar pct={c.pct} max={max} color={slotVar(c.color)} /></span>
                <span className="cr-votes num">{fmtInt(c.votes)}</span>
                <span className="cr-pct num">{fmtPct(c.pct)}</span>
              </button>
              <label className="cr-cmp" title="Adicionar ao comparativo">
                <input type="checkbox" checked={route.cmp.includes(c.id)} onChange={() => toggleCmp(c)} aria-label={`Comparar ${titleCase(c.name)}`} />
                <span>⇆</span>
              </label>
            </li>
          ))}
        </ol>
      )}
      {list.length > limit && <button className="more-btn" onClick={() => setLimit((l) => l + 60)}>Mostrar mais ({fmtInt(list.length - limit)} restantes)</button>}
      {route.cmp.length > 0 && (
        <div className="cmp-bar">
          <span>{route.cmp.length} selecionado(s) para comparar</span>
          <button className="primary-btn" onClick={() => go({ view: 'comparar' })}>Comparar ⇆</button>
          <button className="ghost-btn" onClick={() => go({ cmp: [] })}>Limpar</button>
        </div>
      )}
    </Card>
  );
}
