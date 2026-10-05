import { Fragment, useEffect, useMemo, useState } from 'react';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import { totalOf } from '../lib/mapcolor';
import { useApp } from '../state';
import { slotColor } from '../lib/palette';
import type { CapaCandidato, Relatorio } from '../lib/relatorio';
import { Exportar } from './Exportar';
import { Avatar, Bar, Seg, slotVar, StatusBadge } from './ui';

function age(birth?: string) {
  if (!birth || !/^\d{2}\/\d{2}\/\d{4}$/.test(birth)) return null;
  const [d, m, y] = birth.split('/').map(Number);
  const now = new Date(2026, 9, 4);
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}

const ROLE: Record<string, string> = { v: 'Vice', s1: '1º suplente', s2: '2º suplente' };

export function CandidateDrawer() {
  const { route, go, result, map, areaName, cands, palette } = useApp();
  const r = result.data;
  const c = r?.candidates.find((x) => x.id === route.cand);
  const lite = route.cand ? cands.get(route.cand) : undefined;

  useEffect(() => {
    if (!route.cand) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') go({ cand: undefined }); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [route.cand, go]);

  // Todas as áreas do mapa (estados ou municípios), com os votos do candidato em cada uma.
  // Enquanto o mapa é pedido de novo com o candidato em foco, os dados antigos podem não trazer os votos dele.
  const areas = useMemo(() => {
    if (!route.cand || !map.data || map.stale) return null;
    const list: AreaRow[] = map.data.areas.map((a) => {
      const v = a.votes[route.cand!] ?? 0;
      const total = totalOf(a);
      const lead = v > 0 && Object.entries(a.votes).sort((x, y) => y[1] - x[1])[0]?.[0] === route.cand;
      return { k: a.code, name: areaName(a.code), v, pct: total ? (v / total) * 100 : 0, lead, apurado: a.pctCounted };
    });
    return { list, led: list.filter((a) => a.lead).length, comVotos: list.filter((a) => a.v > 0).length, pending: map.data.pending, total: map.data.total };
  }, [route.cand, map.data, map.stale, areaName]);

  if (!route.cand) return null;
  const name = c?.name ?? lite?.name ?? '';
  const position = c && r ? r.candidates.indexOf(c) + 1 : null;
  const unit = route.uf ? 'municípios' : 'estados';
  const ag = age(c?.birth);

  /** Capa do PDF: foto, identificação, números e mapa de força com o % do candidato em cada área. */
  const capaPdf = (): CapaCandidato | undefined => {
    if (!areas) return undefined;
    const comVotos = areas.list.filter((a) => a.v > 0);
    const melhor = [...comVotos].sort((a, b) => b.pct - a.pct)[0];
    const maisVotos = [...comVotos].sort((a, b) => b.v - a.v)[0];
    return {
      pessoa: { nome: titleCase(name), foto: c?.photo ?? lite?.photo, cor: slotColor(palette, c?.color ?? lite?.color ?? -1) },
      numero: c?.number ?? lite?.number ?? '',
      partido: c?.party ?? lite?.party ?? '',
      partidoNome: c?.partyName,
      nomeCompleto: c ? `${titleCase(c.fullName)}${ag ? ` · ${ag} anos` : ''}` : undefined,
      coligacao: c?.coalition ? `${c.coalitionParties ? 'Coligação' : 'Federação'}: ${c.coalition}${c.coalitionParties ? ` (${c.coalitionParties})` : ''}` : c?.federation ? `Federação: ${c.federation}` : undefined,
      chapa: c?.runningMates.map((m) => `${ROLE[m.role] ?? 'Chapa'}: ${titleCase(m.name)} (${m.party})`),
      situacao: c?.status || (c?.projected ? 'Projeção' : undefined),
      kpis: [
        ...(c && r ? [
          { label: 'Votos', valor: fmtInt(c.votes) },
          { label: '% dos válidos', valor: fmtPct(c.pct, 2) },
          { label: 'Posição', valor: `${position}º`, sub: `de ${fmtInt(r.candidates.length)} candidatos` },
        ] : []),
        { label: `${unit} com votos`, valor: fmtInt(areas.comVotos), sub: `de ${fmtInt(areas.list.length)}` },
        { label: 'Lidera em', valor: fmtInt(areas.led), sub: unit },
      ],
      destaques: [
        ...(maisVotos ? [{ label: 'Mais votos', valor: `${maisVotos.name} (${fmtInt(maisVotos.v)})` }] : []),
        ...(melhor ? [{ label: 'Melhor desempenho', valor: `${melhor.name} (${fmtPct(melhor.pct, 1)})` }] : []),
      ],
      mapa: {
        geoKey: route.uf ?? (route.det === 'mu' ? 'br-mun' : 'uf'),
        valores: Object.fromEntries(areas.list.map((a) => [a.k, a.pct])),
        titulo: `Mapa de força — % dos válidos por ${route.uf ? 'município' : 'estado'}`,
      },
    };
  };

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
              <button className="primary-btn" onClick={() => go({ mode: 'forca', view: 'geral', fc: route.cand, cand: undefined })}>Mapa de força</button>
              {route.uf && <button className="ghost-btn" onClick={() => go({ view: 'geral', fc: route.cand, pins: true, cand: undefined })}>📍 Locais de votação</button>}
              <button className="ghost-btn" onClick={() => go({ cmp: route.cmp.includes(route.cand!) ? route.cmp.filter((x) => x !== route.cand) : [...route.cmp, route.cand!].slice(-4) })}>
                {route.cmp.includes(route.cand) ? '✓ No comparativo' : '+ Comparar'}
              </button>
              {r && r.candidates[0]?.id !== route.cand && r.seats === 1 && (
                <button className="ghost-btn" onClick={() => go({ mode: 'duelo', cmp: [r.candidates[0].id, route.cand!], view: 'geral', cand: undefined })}>Duelo com o líder</button>
              )}
            </div>
            {areas ? (
              <AreaRanking rows={areas.list} comVotos={areas.comVotos} unit={unit} pending={areas.pending} total={areas.total}
                relatorio={{
                  arquivo: `${name}-${route.cargo}-${route.uf ?? 'br'}`,
                  titulo: `Ficha do candidato — votos por ${route.uf ? 'município' : 'estado'}`,
                  capa: capaPdf(),
                }}
                onPick={(k) => go(route.uf ? { mu: k } : { uf: k })} />
            ) : map.loading || map.stale ? <div className="drawer-loading"><span className="spinner" /> Carregando os votos de {titleCase(name)} em cada {route.uf ? 'município' : 'estado'}…</div> : null}
          </>
        )}
      </aside>
    </>
  );
}

interface AreaRow { k: string; name: string; v: number; pct: number; lead: boolean; apurado: number }
type Ordem = 'votos' | 'melhor' | 'pior' | 'nome';
const ORDEM_LABEL: Record<Ordem, string> = { votos: 'mais votos', melhor: 'melhor %', pior: 'pior %', nome: 'A–Z' };

/** Lista completa: todos os estados/municípios, ordenável, com busca e exportação. */
function AreaRanking({ rows, comVotos, unit, pending, total, relatorio, onPick }: {
  rows: AreaRow[]; comVotos: number; unit: string; pending: number; total: number;
  relatorio: Omit<Relatorio, 'colunas' | 'linhas'>; onPick: (k: string) => void;
}) {
  const [ordem, setOrdem] = useState<Ordem>('votos');
  const [todos, setTodos] = useState(false);
  const [busca, setBusca] = useState('');
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const lista = useMemo(() => {
    const q = norm(busca.trim());
    const base = rows.filter((r) => (todos || r.v > 0) && (!q || norm(r.name).includes(q)));
    const cmp: Record<Ordem, (a: AreaRow, b: AreaRow) => number> = {
      votos: (a, b) => b.v - a.v || b.pct - a.pct,
      melhor: (a, b) => b.pct - a.pct || b.v - a.v,
      pior: (a, b) => a.pct - b.pct || a.v - b.v,
      nome: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    };
    return base.sort(cmp[ordem]);
  }, [rows, ordem, todos, busca]);
  // posição de cada área no ranking de votos (fixa, independe da ordenação escolhida)
  const rank = useMemo(() => new Map([...rows].filter((r) => r.v > 0).sort((a, b) => b.v - a.v || b.pct - a.pct).map((r, i) => [r.k, i + 1])), [rows]);
  const max = Math.max(...lista.map((r) => r.pct), 0.1);
  const somaVotos = rows.reduce((s, r) => s + r.v, 0);
  return (
    <div className="area-rank">
      <div className="ar-head">
        <h3>Votos em cada {unit === 'estados' ? 'estado' : 'município'}</h3>
        <p><b className="num">{fmtInt(comVotos)}</b> de <b className="num">{fmtInt(rows.length)}</b> {unit} com votos · <b className="num">{fmtInt(somaVotos)}</b> votos</p>
        {pending > 0 && <p className="ar-pend"><span className="spinner" /> ainda carregando {fmtInt(pending)} de {fmtInt(total)} {unit} — a lista completa aparece em instantes</p>}
      </div>
      <div className="ar-tools">
        <Seg size="sm" label="Ordenar" value={ordem} onChange={setOrdem} options={[
          { id: 'votos', label: 'Mais votos' }, { id: 'melhor', label: 'Melhor %' }, { id: 'pior', label: 'Pior %' }, { id: 'nome', label: 'A–Z' },
        ]} />
        <Seg size="sm" label="Quais áreas" value={todos ? 'todos' : 'com'} onChange={(v) => setTodos(v === 'todos')} options={[
          { id: 'com', label: `Com votos (${fmtInt(comVotos)})` }, { id: 'todos', label: `Todos (${fmtInt(rows.length)})` },
        ]} />
      </div>
      <div className="ar-tools">
        <input className="input sm ar-busca" type="search" placeholder={`Buscar ${unit === 'estados' ? 'estado' : 'município'}…`} value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Exportar montar={() => ({
          ...relatorio,
          // o arquivo segue a lista como está na tela: mesma ordem, filtro e busca
          subtitulo: [`Ordem: ${ORDEM_LABEL[ordem]}`, todos ? `todos os ${unit}` : `só ${unit} com votos`, busca.trim() && `busca: "${busca.trim()}"`].filter(Boolean).join(' · '),
          colunas: [{ titulo: 'Posição', tipo: 'int' }, { titulo: unit === 'estados' ? 'Estado' : 'Município' }, { titulo: 'Votos', tipo: 'int' }, { titulo: '% dos válidos', tipo: 'pct', barra: true }, { titulo: 'Lidera' }, { titulo: '% apurado', tipo: 'pct' }],
          linhas: lista.map((r) => [rank.get(r.k) ?? null, r.name, r.v, r.pct, r.lead ? 'sim' : '', r.apurado]),
        })} />
      </div>
      <ol className="area-list ar-list">
        {lista.map((r) => (
          <li key={r.k} onClick={() => onPick(r.k)} className={r.v === 0 ? 'zero' : ''}>
            <span className="ar-pos num">{rank.get(r.k) ? `${rank.get(r.k)}º` : '—'}</span>
            <span className="al-name">{r.name}{r.lead && <em className="ar-lead"> ★ lidera</em>}</span>
            <Bar pct={r.pct} max={max} color="var(--c)" height={5} />
            <span className="num">{fmtPct(r.pct, 1)}</span>
            <small className="num">{fmtInt(r.v)}</small>
          </li>
        ))}
        {!lista.length && <li className="ar-vazio">{busca ? 'Nenhum resultado para a busca.' : 'Sem votos registrados ainda.'}</li>}
      </ol>
    </div>
  );
}
