import { geoMercator, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadGeo, type GeoFeature } from '../lib/geo';

interface Shape { code: string; d: string; c: [number, number]; area: number; name: string }

const W = 1000;

const Paths = memo(function Paths({ shapes, fill, empty }: { shapes: Shape[]; fill: Map<string, string>; empty: string }) {
  return (
    <>
      {shapes.map((s) => <path key={s.code} d={s.d} data-code={s.code} fill={fill.get(s.code) ?? empty} />)}
    </>
  );
});

export interface MapViewProps {
  geoKey: string;
  fill: Map<string, string>;
  emptyColor: string;
  selected?: string;
  highlight?: Set<string>;
  labels?: boolean;
  onPick?: (code: string) => void;
  renderTip?: (code: string, name: string) => ReactNode;
  overlay?: ReactNode;
  ariaLabel: string;
  /** pins (locais de votação) desenhados por cima das áreas */
  pins?: MapPin[];
  pinSelected?: string;
  onPinPick?: (id: string) => void;
  renderPinTip?: (id: string) => ReactNode;
  /** zoom mais fundo na área selecionada (para ver os pins) */
  deepZoom?: boolean;
}

export interface MapPin { id: string; lon: number; lat: number; color: string; scale: number; star: boolean; hollow: boolean; delay: number }

// Pin em gota, com a ponta em (0,0) e a cabeça centrada em (0,-16.5)
const PIN = 'M0 0C-2.4-4.8-9.5-9.4-9.5-16.5a9.5 9.5 0 1 1 19 0C9.5-9.4 2.4-4.8 0 0Z';
const STAR = 'M0-21.6l1.5 3.1 3.4.5-2.5 2.4.6 3.4L0-13.8l-3 1.6.6-3.4-2.5-2.4 3.4-.5z';

const PinsLayer = memo(function PinsLayer({ pins, selected }: { pins: (MapPin & { x: number; y: number })[]; selected?: string }) {
  return (
    <g className="pins">
      {pins.map((p) => (
        <g key={p.id} data-pin={p.id} className={`pin ${p.id === selected ? 'sel' : ''} ${p.hollow ? 'hollow' : ''}`}
          style={{ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(calc(${(p.id === selected ? p.scale * 1.35 : p.scale).toFixed(2)} / var(--k, 1)))` }}>
          <g className="pin-drop" style={{ animationDelay: `${p.delay}ms` }}>
            <ellipse className="pin-shadow" cx="0" cy="0" rx="4.5" ry="1.6" />
            <path d={PIN} fill={p.color} />
            {p.star ? <path className="pin-star" d={STAR} /> : <circle className="pin-dot" cx="0" cy="-16.5" r="3.6" />}
          </g>
        </g>
      ))}
    </g>
  );
});

export function MapView({ geoKey, fill, emptyColor, selected, highlight, labels, onPick, renderTip, overlay, ariaLabel, pins, pinSelected, onPinPick, renderPinTip, deepZoom }: MapViewProps) {
  const [features, setFeatures] = useState<{ key: string; list: GeoFeature[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [pinHover, setPinHover] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadGeo(geoKey).then((list) => { if (alive) setFeatures({ key: geoKey, list }); }).catch(() => alive && setError('Não foi possível carregar o mapa.'));
    return () => { alive = false; };
  }, [geoKey]);

  const { shapes, H, proj } = useMemo(() => {
    if (!features) return { shapes: [] as Shape[], H: 860, proj: null };
    const fc = { type: 'FeatureCollection' as const, features: features.list };
    const probe = geoPath(geoMercator().scale(1).translate([0, 0])).bounds(fc);
    const aspect = (probe[1][1] - probe[0][1]) / (probe[1][0] - probe[0][0] || 1);
    const H = Math.round(Math.min(1150, Math.max(560, W * aspect)));
    const proj = geoMercator().fitExtent([[14, 14], [W - 14, H - 14]], fc);
    const path = geoPath(proj);
    const shapes = features.list.map((f) => ({ code: f.properties.code, name: f.properties.name, d: path(f) ?? '', c: path.centroid(f) as [number, number], area: path.area(f) }));
    return { shapes, H, proj };
  }, [features]);
  const pinsXY = useMemo(() => {
    if (!pins?.length || !proj) return [];
    return pins.map((p) => { const xy = proj([p.lon, p.lat]) ?? [-999, -999]; return { ...p, x: xy[0], y: xy[1] }; })
      // de cima para baixo, para os pins de baixo ficarem na frente; o selecionado por último
      .sort((a, b) => (a.id === pinSelected ? 1 : b.id === pinSelected ? -1 : a.y - b.y));
  }, [pins, proj, pinSelected]);
  const byCode = useMemo(() => new Map(shapes.map((s) => [s.code, s])), [shapes]);

  // Zoom e arrasto
  useEffect(() => {
    const svg = svgRef.current, g = gRef.current;
    if (!svg || !g) return;
    const z = zoom<SVGSVGElement, unknown>().scaleExtent([1, 24]).translateExtent([[-200, -200], [W + 200, H + 200]])
      .on('zoom', (ev) => { g.setAttribute('transform', ev.transform.toString()); svg.style.setProperty('--k', String(ev.transform.k)); });
    zoomRef.current = z;
    select(svg).call(z).on('dblclick.zoom', null);
    select(svg).call(z.transform, zoomIdentity);
    return () => { select(svg).on('.zoom', null); };
  }, [H, geoKey]);

  // Aproxima a área selecionada
  useEffect(() => {
    const svg = svgRef.current, z = zoomRef.current;
    if (!svg || !z) return;
    const s = selected ? byCode.get(selected) : undefined;
    if (!s || (shapes.length < 40 && !deepZoom)) { select(svg).transition().duration(500).call(z.transform, zoomIdentity); return; }
    const el = svg.querySelector<SVGPathElement>(`path[data-code="${selected}"]`);
    if (!el) return;
    const b = el.getBBox();
    const k = deepZoom ? Math.min(24, 0.78 / Math.max(b.width / W, b.height / H)) : Math.min(10, 0.35 / Math.max(b.width / W, b.height / H));
    if (k <= 1.3 && !deepZoom) return;
    select(svg).transition().duration(deepZoom ? 900 : 650).call(z.transform, zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(b.x + b.width / 2), -(b.y + b.height / 2)));
  }, [selected, byCode, shapes.length, H, deepZoom]);

  // Centraliza o pin escolhido (clique ou ranking), mantendo o zoom
  useEffect(() => {
    const svg = svgRef.current, z = zoomRef.current;
    const p = pinSelected ? pinsXY.find((x) => x.id === pinSelected) : undefined;
    if (svg && z && p) select(svg).transition().duration(600).call(z.translateTo, p.x, p.y);
  }, [pinSelected]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy, f); };
  const reset = () => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(400).call(z.transform, zoomIdentity); };

  const onMove = (e: React.PointerEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    const pin = (e.target as Element).closest?.('[data-pin]') as SVGGElement | null;
    if (pin && box) { setPinHover({ id: pin.dataset.pin!, x: e.clientX - box.left, y: e.clientY - box.top }); if (hover) setHover(null); return; }
    if (pinHover) setPinHover(null);
    const t = (e.target as Element).closest?.('path[data-code]') as SVGPathElement | null;
    if (!t || !box) { if (hover) setHover(null); return; }
    setHover({ code: t.dataset.code!, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const onClick = (e: React.MouseEvent) => {
    const pin = (e.target as Element).closest?.('[data-pin]') as SVGGElement | null;
    if (pin) { onPinPick?.(pin.dataset.pin!); return; }
    const t = (e.target as Element).closest?.('path[data-code]') as SVGPathElement | null;
    if (t && onPick) onPick(t.dataset.code!);
  };

  const sel = selected ? byCode.get(selected) : undefined;
  const hov = hover ? byCode.get(hover.code) : undefined;
  const tip = pinHover && renderPinTip ? renderPinTip(pinHover.id) : hover && hov && renderTip ? renderTip(hover.code, hov.name) : null;
  const tipAt = pinHover ?? hover;
  const wrapW = wrapRef.current?.clientWidth ?? 600;

  return (
    <div className="map-wrap" ref={wrapRef}>
      {error && <div className="map-msg">{error}</div>}
      {!features && !error && <div className="map-msg"><span className="spinner" /> Carregando mapa…</div>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`map-svg ${onPick ? 'pickable' : ''} ${pinsXY.length ? 'with-pins' : ''}`} role="img" aria-label={ariaLabel}
        onPointerMove={onMove} onPointerLeave={() => { setHover(null); setPinHover(null); }} onClick={onClick}>
        {pinsXY.length > 0 && selected && <style>{`.map-svg.with-pins .areas path[data-code="${selected}"]{opacity:1;fill:var(--surface-1)}`}</style>}
        <g ref={gRef}>
          <g className="areas"><Paths shapes={shapes} fill={fill} empty={emptyColor} /></g>
          {highlight && <g className="hl">{shapes.filter((s) => highlight.has(s.code)).map((s) => <path key={s.code} d={s.d} />)}</g>}
          {hov && <path className="hover-outline" d={hov.d} />}
          {sel && <path className="sel-outline" d={sel.d} />}
          {labels && (
            <g className="labels" aria-hidden>
              {shapes.map((s) => <text key={s.code} x={s.c[0]} y={s.c[1]} className={s.area < 900 ? 'small' : ''}>{s.name}</text>)}
            </g>
          )}
          {pinsXY.length > 0 && <PinsLayer pins={pinsXY} selected={pinSelected} />}
        </g>
      </svg>
      <div className="map-zoom" role="group" aria-label="Zoom do mapa">
        <button onClick={() => zoomBy(1.6)} aria-label="Aproximar">+</button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Afastar">−</button>
        <button onClick={reset} aria-label="Enquadrar" className="fit">⤢</button>
      </div>
      {overlay}
      {tip && tipAt && (
        <div className="map-tip" style={{ left: Math.min(tipAt.x + 16, wrapW - 290), top: tipAt.y + 14 }}>{tip}</div>
      )}
    </div>
  );
}
