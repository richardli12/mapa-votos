import { useEffect, useMemo, useState } from 'react';
import { cargoInfo } from '../../shared/cargos';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import type { MapArea } from '../../shared/types';
import type { MapMode } from '../hooks/useRoute';
import { colorAreas, partySlots, ranked, totalOf } from '../lib/mapcolor';
import { slotColor } from '../lib/palette';
import { useApp } from '../state';
import { MapView } from './MapView';
import { montarPins, PinBar, PinCard, PinRanking, PinTip, type PinFiltro } from './Pins';
import { usePins } from '../hooks/usePins';
import { Card, Seg, slotVar } from './ui';

const MODE_LABEL: Record<MapMode, string> = {
  lider: 'Líder', partido: 'Partido', forca: 'Força', duelo: 'Duelo', margem: 'Margem',
  comparecimento: 'Comparecimento', brancosnulos: 'Brancos e nulos', apuracao: 'Apuração',
};

export function useMapModes() {
  const { route } = useApp();
  const prop = cargoInfo(route.cargo).proportional;
  const multi = !route.uf && route.cargo !== 'presidente';
  const modes: MapMode[] = multi ? [prop ? 'partido' : 'lider', 'comparecimento', 'apuracao']
    : prop ? ['partido', 'forca', 'comparecimento', 'brancosnulos', 'apuracao']
    : ['lider', 'forca', 'duelo', 'margem', 'comparecimento', 'brancosnulos', 'apuracao'];
  const mode = route.mode && modes.includes(route.mode) ? route.mode : modes[0];
  return { modes, mode, multi, prop };
}

export function MapPanel({ compact }: { compact?: boolean }) {
  const { route, go, map, palette, cands, result, areaName, munis } = useApp();
  const { modes, mode, multi } = useMapModes();
  const top = result.data?.candidates ?? [];
  const forca = route.fc ?? top[0]?.id;
  const duel: [string, string] | undefined = route.cmp.length >= 2 ? [route.cmp[0], route.cmp[1]] : top.length >= 2 ? [top[0].id, top[1].id] : undefined;
  const payload = map.data;
  const coloring = useMemo(() => colorAreas(payload, { mode, palette, cands, byParty: multi, forca, duel }), [payload, mode, palette, cands, multi, forca, duel?.[0], duel?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const areaByCode = useMemo(() => new Map((payload?.areas ?? []).map((a) => [a.code, a])), [payload]);
  const geoKey = route.uf ? route.uf : route.det === 'mu' ? 'br-mun' : 'uf';
  const partyColor = useMemo(() => partySlots((payload?.areas ?? []).flatMap((a) => Object.keys(a.partyVotes ?? {}))), [payload]);

  // ——— Locais de votação (pins) ———
  const pinsOn = !!route.pins;
  const candLista = useMemo(() => top.map((c) => cands.get(c.id)!).filter(Boolean), [top, cands]);
  const focoCand = (route.fc ? cands.get(route.fc) : undefined) ?? candLista[0];
  const pinsData = usePins(pinsOn, focoCand);
  const [filtro, setFiltro] = useState<PinFiltro>('todos');
  const [pinSel, setPinSel] = useState<string | undefined>();
  useEffect(() => { setPinSel(undefined); }, [route.mu, route.cargo]);
  const porNumero = useMemo(() => new Map(candLista.map((c) => [c.number, c])), [candLista]);
  const { mapPins, legenda: pinLegenda } = useMemo(() => montarPins(pinsData.pins, filtro, focoCand, palette), [pinsData.pins, filtro, focoCand, palette]);
  const pinById = useMemo(() => new Map(pinsData.pins.map((p) => [p.id, p])), [pinsData.pins]);
  const rankingDe = useMemo(() => {
    const ord = pinsData.pins.filter((p) => p.share !== null).sort((a, b) => b.share! - a.share!);
    return new Map(ord.map((p, i) => [p.id, i + 1]));
  }, [pinsData.pins]);
  const comPins = pinsOn && pinsData.estado === 'ok' && mapPins.length > 0;
  const selPin = pinSel ? pinById.get(pinSel) : undefined;

  const pick = (code: string) => {
    if (!route.uf) {
      if (route.det === 'mu') go({ uf: munis.get(code)?.uf, mu: code, det: undefined });
      else go({ uf: code, mu: undefined });
    } else go({ mu: route.mu === code ? undefined : code });
  };

  const tip = (code: string, name: string) => {
    const a = areaByCode.get(code);
    const title = route.uf || route.det === 'mu' ? `${titleCase(munis.get(code)?.name ?? name)}${!route.uf ? ` · ${munis.get(code)?.uf.toUpperCase() ?? ''}` : ''}` : areaName(code);
    return <AreaTip title={title} area={a} prop={!!a?.partyVotes && (mode === 'partido' || multi)} partyColor={partyColor} />;
  };

  const legend = coloring.legend;
  const loading = payload && payload.pending > 0;
  return (
    <Card className={`map-card ${compact ? 'compact' : ''}`}
      title={<>Mapa {route.uf ? 'por município' : route.det === 'mu' ? 'por município' : 'por estado'}</>}
      sub={comPins ? 'Cada pin é um local de votação — cor pela força do candidato, clique para ver a ficha' : MODE_HINT[mode]}
      actions={!route.uf && route.cargo === 'presidente' ? (
        <Seg size="sm" label="Detalhe do mapa" value={route.det ?? 'uf'} onChange={(v) => go({ det: v === 'mu' ? 'mu' : undefined })}
          options={[{ id: 'uf', label: 'Estados' }, { id: 'mu', label: 'Municípios' }]} />
      ) : undefined}>
      <div className="map-modes">
        <Seg size="sm" label="Modo do mapa" value={mode} onChange={(m) => go({ mode: m })} options={modes.map((m) => ({ id: m, label: MODE_LABEL[m] }))} />
      </div>
      {mode === 'forca' && top.length > 0 && (
        <div className="map-pick">
          <span>Candidato:</span>
          <select value={forca} onChange={(e) => go({ fc: e.target.value })} aria-label="Candidato do mapa de força">
            {top.slice(0, 300).map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)} ({c.party} {c.number})</option>)}
          </select>
        </div>
      )}
      {mode === 'duelo' && duel && (
        <div className="map-pick">
          {[0, 1].map((i) => (
            <select key={i} value={duel[i]} aria-label={`Candidato ${i + 1} do duelo`} onChange={(e) => { const n = [...duel]; n[i] = e.target.value; go({ cmp: n }); }}>
              {top.slice(0, 40).map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)} ({c.party})</option>)}
            </select>
          ))}
        </div>
      )}
      {(route.uf || pinsOn) && (
        <PinBar on={pinsOn} cand={focoCand} cands={candLista} estado={pinsData.estado} pins={pinsData.pins} filtro={filtro} setFiltro={setFiltro}
          zonas={pinsData.estrutura?.zonas.map((z) => z.zona) ?? []} zona={pinsData.zona} />
      )}
      <MapView geoKey={geoKey} fill={coloring.fill} emptyColor={palette.empty} selected={route.mu ?? undefined}
        labels={geoKey === 'uf' && !comPins} onPick={pick} renderTip={tip}
        ariaLabel={`Mapa: ${comPins ? 'locais de votação' : legend.title}`}
        pins={comPins ? mapPins : undefined} pinSelected={pinSel} onPinPick={(id) => setPinSel(id === pinSel ? undefined : id)} deepZoom={pinsOn && !!route.mu}
        renderPinTip={(id) => <PinTip p={pinById.get(id)} cand={focoCand} porNumero={porNumero} />}
        overlay={
          <>
            {loading && <div className="map-loading"><span className="spinner" /> carregando áreas {fmtInt(payload!.total - payload!.pending)}/{fmtInt(payload!.total)}</div>}
            {pinsOn && route.uf && !route.mu && <div className="pin-callout">📍 Clique num município para ver as escolas de {titleCase(focoCand?.name ?? '')}</div>}
            {pinsData.payload && pinsData.payload.pending > 0 && <div className="map-loading"><span className="spinner" /> lendo boletins {fmtInt(pinsData.payload.total - pinsData.payload.pending)}/{fmtInt(pinsData.payload.total)}</div>}
            {selPin && <PinCard p={selPin} cand={focoCand} porNumero={porNumero} ranking={rankingDe.get(selPin.id) ?? null} onClose={() => setPinSel(undefined)} />}
            {comPins ? (
              <div className="legend">
                <div className="legend-title">% de {titleCase(focoCand?.name ?? '')} em cada local</div>
                <ul className="legend-items seq">{pinLegenda.map((it) => <li key={it.label}><i style={{ background: it.cor }} /><span>{it.label}</span></li>)}</ul>
                <div className="legend-note pin-legend-note"><span className="lg-star">★</span> venceu no local · <span className="lg-hollow" /> aguardando boletins · tamanho = eleitorado</div>
              </div>
            ) : (
            <div className="legend">
              <div className="legend-title">{legend.title}</div>
              {legend.ends && <div className="legend-ends"><span>{legend.ends[0]}</span><span>{legend.ends[1]}</span></div>}
              <ul className={`legend-items ${legend.kind}`}>
                {legend.items.slice(0, 9).map((it) => (
                  <li key={it.label} onClick={it.id ? () => go({ fc: it.id, mode: 'forca' }) : undefined} className={it.id ? 'clickable' : ''}>
                    <i style={{ background: it.color }} />
                    <span>{it.label}</span>
                    {it.count !== undefined && <b className="num">{fmtInt(it.count)}</b>}
                  </li>
                ))}
              </ul>
              {legend.note && <div className="legend-note">{legend.note}</div>}
            </div>
            )}
          </>
        } />
      {comPins && <PinRanking pins={pinsData.pins} cand={focoCand} onPick={setPinSel} />}
    </Card>
  );
}

const MODE_HINT: Record<MapMode, string> = {
  lider: 'Cor do candidato que lidera em cada área — clique para detalhar',
  partido: 'Partido com mais votos em cada área',
  forca: 'Onde o candidato escolhido vai melhor',
  duelo: 'Quem vence o confronto direto em cada área',
  margem: 'Onde a disputa está mais apertada',
  comparecimento: 'Participação dos eleitores',
  brancosnulos: 'Voto de protesto',
  apuracao: 'Andamento da totalização',
};

export function AreaTip({ title, area, prop, partyColor }: { title: string; area?: MapArea; prop?: boolean; partyColor: Map<string, number> }) {
  const { cands, palette } = useApp();
  if (!area) return <div className="tip"><strong>{title}</strong><div className="tip-muted">Sem dados</div></div>;
  const total = totalOf(area);
  const rows = prop && area.partyVotes
    ? Object.entries(area.partyVotes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, v]) => ({ key: p, name: p, sub: area.partySeats?.[p] ? `${area.partySeats[p]} cadeira(s)` : '', v, color: slotColor(palette, partyColor.get(p) ?? -1) }))
    : ranked(area).slice(0, 4).map(([id, v]) => { const c = cands.get(id); return { key: id, name: titleCase(c?.name ?? id), sub: c?.party ?? '', v, color: slotVar(c?.color ?? -1) }; });
  const denom = prop && area.partyVotes ? Object.values(area.partyVotes).reduce((s, v) => s + v, 0) : total;
  return (
    <div className="tip">
      <strong>{title}</strong>
      <div className="tip-muted">{fmtPct(area.pctCounted, 1)} apurado · comparecimento {fmtPct(area.turnoutPct, 1)}</div>
      {total > 0 ? (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <i style={{ background: r.color }} />
              <span>{r.name} <small>{r.sub}</small>{area.statuses?.[r.key] && <em> · {area.statuses[r.key]}</em>}</span>
              <b className="num">{fmtPct(denom ? (r.v / denom) * 100 : 0, 1)}</b>
            </li>
          ))}
        </ul>
      ) : <div className="tip-muted">Aguardando votos</div>}
    </div>
  );
}
