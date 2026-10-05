import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import type { CandidateLite } from '../../shared/types';
import type { PinData, PinsEstado } from '../hooks/usePins';
import type { MapPin } from './MapView';
import { ramp, slotColor, type Palette } from '../lib/palette';
import { pad4 } from '../lib/urnas';
import { useApp } from '../state';
import { Avatar, Bar, Card, Seg, slotVar } from './ui';

export type PinFiltro = 'todos' | 'vence' | 'perde';

export function passaFiltro(p: PinData, f: PinFiltro) {
  if (f === 'vence') return p.pos === 1;
  if (f === 'perde') return p.share !== null && p.pos !== 1;
  return true;
}

/** Cores (força do candidato no local), tamanho (eleitorado) e atraso da animação (onda a partir do centro). */
export function montarPins(pins: PinData[], filtro: PinFiltro, cand: CandidateLite | undefined, palette: Palette) {
  const lista = pins.filter((p) => passaFiltro(p, filtro));
  const max = Math.max(0.05, ...pins.map((p) => p.share ?? 0));
  const step = max > 0.4 ? 0.1 : max > 0.2 ? 0.05 : max > 0.08 ? 0.02 : 0.01;
  const breaks: number[] = [];
  for (let x = step; x < max && breaks.length < 5; x += step) breaks.push(x);
  const cores = ramp(palette, slotColor(palette, cand?.color ?? 0), breaks.length + 1);
  const maxE = Math.max(1, ...pins.map((p) => p.eleitores));
  const cLon = lista.reduce((s, p) => s + p.lon, 0) / (lista.length || 1), cLat = lista.reduce((s, p) => s + p.lat, 0) / (lista.length || 1);
  const ordem = [...lista].sort((a, b) => Math.hypot(a.lon - cLon, a.lat - cLat) - Math.hypot(b.lon - cLon, b.lat - cLat));
  const atraso = new Map(ordem.map((p, i) => [p.id, Math.round((i / Math.max(1, ordem.length)) * 1100)]));
  const classe = (s: number) => { let i = 0; while (i < breaks.length && s >= breaks[i]) i++; return i; };
  const mapPins: MapPin[] = lista.map((p) => ({
    id: p.id, lon: p.lon, lat: p.lat,
    color: p.share === null ? palette.other : cores[classe(p.share)],
    hollow: p.share === null,
    star: p.pos === 1,
    scale: 0.82 + 0.6 * Math.sqrt(p.eleitores / maxE),
    delay: atraso.get(p.id) ?? 0,
  }));
  const legenda = cores.map((cor, i) => ({ cor, label: i === 0 ? `< ${fmtPct(breaks[0] * 100 || max * 100, 0)}` : i === breaks.length ? `≥ ${fmtPct(breaks[i - 1] * 100, 0)}` : `${fmtPct(breaks[i - 1] * 100, 0)}–${fmtPct(breaks[i] * 100, 0)}` }));
  return { mapPins, legenda };
}

export function resumoPins(pins: PinData[]) {
  const com = pins.filter((p) => p.share !== null);
  const vence = com.filter((p) => p.pos === 1).length;
  const votos = com.reduce((s, p) => s + p.votos, 0);
  const validos = com.reduce((s, p) => s + (p.soma ? p.soma.nom + p.soma.leg : 0), 0);
  return { total: pins.length, apurados: com.length, vence, media: validos ? votos / validos : null, votos };
}

/** Barra: candidato em foco + interruptor dos locais de votação. */
export function PinBar({ on, cand, cands, estado, pins, filtro, setFiltro, zonas, zona }: {
  on: boolean; cand?: CandidateLite; cands: CandidateLite[]; estado: PinsEstado; pins: PinData[];
  filtro: PinFiltro; setFiltro: (f: PinFiltro) => void; zonas: number[]; zona: number | null;
}) {
  const { go, route } = useApp();
  const r = resumoPins(pins);
  return (
    <div className={`pin-bar ${on ? 'on' : ''}`}>
      <div className="pin-cand">
        <Avatar name={cand?.name ?? '?'} photo={cand?.photo} color={cand?.color ?? -1} size={34} />
        <div className="pin-cand-sel">
          <label htmlFor="pin-cand">Candidato</label>
          <select id="pin-cand" value={cand?.id ?? ''} onChange={(e) => go({ fc: e.target.value })}>
            {cands.slice(0, 400).map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)} · {c.party} {c.number}</option>)}
          </select>
        </div>
      </div>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => go({ pins: !on || undefined })}>
        <span className="switch-track"><span className="switch-thumb" /></span>
        <span className="switch-label">📍 Locais de votação</span>
      </button>
      {on && estado === 'ok' && (
        <div className="pin-stats">
          <span><b className="num">{fmtInt(r.total)}</b> locais</span>
          <span className="star-chip">★ vence em <b className="num">{fmtInt(r.vence)}</b>{r.apurados < r.total ? <> de {fmtInt(r.apurados)} apurados</> : null}</span>
          {r.media !== null && <span>média <b className="num">{fmtPct(r.media * 100, 1)}</b></span>}
          <Seg size="sm" label="Filtrar locais" value={filtro} onChange={setFiltro} options={[{ id: 'todos', label: 'Todos' }, { id: 'vence', label: '★ Onde vence' }, { id: 'perde', label: 'Onde perde' }]} />
        </div>
      )}
      {on && zonas.length > 1 && (estado === 'ok' || estado === 'escolher-zona' || estado === 'carregando') && zona !== null && (
        <select className="input sm" value={zona} onChange={(e) => go({ z: Number(e.target.value) })} aria-label="Zona eleitoral">
          {zonas.map((z) => <option key={z} value={z}>Zona {pad4(z)}</option>)}
        </select>
      )}
      {on && estado === 'sem-municipio' && <span className="pin-hint">{route.uf ? 'Clique num município do mapa para ver as escolas.' : 'Escolha um estado e depois um município.'}</span>}
      {on && estado === 'carregando' && <span className="pin-hint"><span className="spinner" /> Buscando os locais de votação…</span>}
      {on && estado === 'sem-coordenadas' && <span className="pin-hint">Sem coordenadas dos locais deste município (gere o cadastro com <code>npm run locais</code>). Veja-os na aba Urnas.</span>}
      {on && estado === 'erro' && <span className="pin-hint erro">Não foi possível carregar os locais agora.</span>}
    </div>
  );
}

export function PinTip({ p, cand, porNumero }: { p?: PinData; cand?: CandidateLite; porNumero: Map<string, CandidateLite> }) {
  if (!p) return null;
  const s = p.soma;
  const validos = s ? s.nom + s.leg : 0;
  const top = s ? Object.entries(s.v).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  return (
    <div className="tip pin-tip">
      <strong>{titleCase(p.nome)}</strong>
      <div className="tip-muted">{[p.bairro && titleCase(p.bairro), `Zona ${pad4(p.zona)} · Local ${p.local}`].filter(Boolean).join(' · ')}</div>
      {p.share === null ? <div className="tip-muted">Aguardando os boletins deste local</div> : (
        <>
          <div className="pin-tip-big" style={{ ['--c' as string]: slotVar(cand?.color ?? -1) }}>
            <b className="num">{fmtPct(p.share * 100, 1)}</b>
            <span>{titleCase(cand?.name ?? '')}<small>{fmtInt(p.votos)} votos · {p.pos ? `${p.pos}º lugar` : '—'}{p.pos === 1 ? ' ★' : ''}</small></span>
          </div>
          <ul>{top.map(([n, q]) => { const c = porNumero.get(n); return <li key={n}><i style={{ background: slotVar(c?.color ?? -1) }} /><span>{titleCase(c?.name ?? n)} <small>{c?.party}</small></span><b className="num">{fmtPct((q / (validos || 1)) * 100, 1)}</b></li>; })}</ul>
          <div className="tip-muted">{s!.totalizadas}/{s!.secoes} seções · comparecimento {fmtPct((s!.comp / (s!.apt || 1)) * 100, 1)}</div>
        </>
      )}
    </div>
  );
}

/** Ficha do local de votação clicado. */
export function PinCard({ p, cand, porNumero, ranking, onClose }: { p: PinData; cand?: CandidateLite; porNumero: Map<string, CandidateLite>; ranking: number | null; onClose: () => void }) {
  const { go } = useApp();
  const s = p.soma;
  const validos = s ? s.nom + s.leg : 0;
  const top = s ? Object.entries(s.v).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  const max = top[0]?.[1] || 1;
  return (
    <div className="pin-card" role="dialog" aria-label={`Local de votação ${titleCase(p.nome)}`}>
      <button className="pin-card-x" onClick={onClose} aria-label="Fechar">×</button>
      <div className="pin-card-head">
        <span className="pin-card-icon" aria-hidden>📍</span>
        <div>
          <h3>{titleCase(p.nome)}</h3>
          <p>{[p.endereco && titleCase(p.endereco), p.bairro && titleCase(p.bairro)].filter(Boolean).join(' · ')}</p>
          <p className="muted">Zona {pad4(p.zona)} · Local {p.local} · {fmtInt(p.eleitores)} eleitores</p>
        </div>
      </div>
      {p.share !== null && cand ? (
        <div className="pin-card-cand" style={{ ['--c' as string]: slotVar(cand.color) }}>
          <Avatar name={cand.name} photo={cand.photo} color={cand.color} size={44} elected={p.pos === 1} />
          <div>
            <b className="num">{fmtPct(p.share * 100, 1)}</b>
            <span>{fmtInt(p.votos)} votos · {p.pos}º lugar no local{p.pos === 1 ? ' ★' : ''}</span>
            {ranking && <small>{ranking}ª melhor escola de {titleCase(cand.name)}</small>}
          </div>
        </div>
      ) : <p className="muted">Os boletins deste local ainda não foram totalizados.</p>}
      {top.length > 0 && (
        <ol className="pin-card-top">
          {top.map(([n, q]) => { const c = porNumero.get(n); return (
            <li key={n} className={n === cand?.number ? 'foco' : ''}>
              <span>{titleCase(c?.name ?? `Candidato ${n}`)} <small>{c?.party}</small></span>
              <Bar pct={q} max={max} color={slotVar(c?.color ?? -1)} height={5} />
              <b className="num">{fmtPct((q / (validos || 1)) * 100, 1)}</b>
            </li>
          ); })}
        </ol>
      )}
      <button className="primary-btn" onClick={() => go({ view: 'urnas', z: p.zona, esc: p.id, s: undefined })}>Ver seções e boletins de urna →</button>
    </div>
  );
}

/** Melhores e piores locais do candidato. */
export function PinRanking({ pins, cand, onPick }: { pins: PinData[]; cand?: CandidateLite; onPick: (id: string) => void }) {
  const com = pins.filter((p) => p.share !== null).sort((a, b) => b.share! - a.share!);
  if (!cand || com.length < 2) return null;
  const n = Math.min(6, Math.ceil(com.length / 2));
  const melhores = com.slice(0, n), piores = com.slice(-n).reverse();
  const max = melhores[0].share || 1;
  const Lista = ({ titulo, itens }: { titulo: string; itens: PinData[] }) => (
    <div className="pin-rank">
      <h3>{titulo}</h3>
      <ol>
        {itens.map((p) => (
          <li key={p.id} onClick={() => onPick(p.id)}>
            <span className="pr-nome">{titleCase(p.nome)}<small>{p.bairro ? titleCase(p.bairro) : `Zona ${pad4(p.zona)}`}{p.pos === 1 ? ' · ★ venceu' : ''}</small></span>
            <Bar pct={p.share!} max={max} color={slotVar(cand.color)} height={5} />
            <b className="num">{fmtPct(p.share! * 100, 1)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <Card title={<>Escolas de {titleCase(cand.name)}</>} sub="% dos votos válidos em cada local de votação · clique para localizar no mapa">
      <div className="pin-ranks"><Lista titulo="Onde vai melhor" itens={melhores} /><Lista titulo="Onde vai pior" itens={piores} /></div>
    </Card>
  );
}
