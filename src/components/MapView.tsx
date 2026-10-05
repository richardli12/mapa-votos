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
}

export function MapView({ geoKey, fill, emptyColor, selected, highlight, labels, onPick, renderTip, overlay, ariaLabel }: MapViewProps) {
  const [features, setFeatures] = useState<{ key: string; list: GeoFeature[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadGeo(geoKey).then((list) => { if (alive) setFeatures({ key: geoKey, list }); }).catch(() => alive && setError('Não foi possível carregar o mapa.'));
    return () => { alive = false; };
  }, [geoKey]);

  const { shapes, H } = useMemo(() => {
    if (!features) return { shapes: [] as Shape[], H: 860 };
    const fc = { type: 'FeatureCollection' as const, features: features.list };
    const probe = geoPath(geoMercator().scale(1).translate([0, 0])).bounds(fc);
    const aspect = (probe[1][1] - probe[0][1]) / (probe[1][0] - probe[0][0] || 1);
    const H = Math.round(Math.min(1150, Math.max(560, W * aspect)));
    const proj = geoMercator().fitExtent([[14, 14], [W - 14, H - 14]], fc);
    const path = geoPath(proj);
    const shapes = features.list.map((f) => ({ code: f.properties.code, name: f.properties.name, d: path(f) ?? '', c: path.centroid(f) as [number, number], area: path.area(f) }));
    return { shapes, H };
  }, [features]);
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
    if (!s || shapes.length < 40) { select(svg).transition().duration(500).call(z.transform, zoomIdentity); return; }
    const el = svg.querySelector<SVGPathElement>(`path[data-code="${selected}"]`);
    if (!el) return;
    const b = el.getBBox();
    const k = Math.min(10, 0.35 / Math.max(b.width / W, b.height / H));
    if (k <= 1.3) return;
    select(svg).transition().duration(650).call(z.transform, zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(b.x + b.width / 2), -(b.y + b.height / 2)));
  }, [selected, byCode, shapes.length, H]);

  const zoomBy = (f: number) => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy, f); };
  const reset = () => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(400).call(z.transform, zoomIdentity); };

  const onMove = (e: React.PointerEvent) => {
    const t = (e.target as Element).closest?.('path[data-code]') as SVGPathElement | null;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!t || !box) { if (hover) setHover(null); return; }
    setHover({ code: t.dataset.code!, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const onClick = (e: React.MouseEvent) => {
    const t = (e.target as Element).closest?.('path[data-code]') as SVGPathElement | null;
    if (t && onPick) onPick(t.dataset.code!);
  };

  const sel = selected ? byCode.get(selected) : undefined;
  const hov = hover ? byCode.get(hover.code) : undefined;
  const tip = hover && hov && renderTip ? renderTip(hover.code, hov.name) : null;
  const wrapW = wrapRef.current?.clientWidth ?? 600;

  return (
    <div className="map-wrap" ref={wrapRef}>
      {error && <div className="map-msg">{error}</div>}
      {!features && !error && <div className="map-msg"><span className="spinner" /> Carregando mapa…</div>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`map-svg ${onPick ? 'pickable' : ''}`} role="img" aria-label={ariaLabel}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}>
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
        </g>
      </svg>
      <div className="map-zoom" role="group" aria-label="Zoom do mapa">
        <button onClick={() => zoomBy(1.6)} aria-label="Aproximar">+</button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Afastar">−</button>
        <button onClick={reset} aria-label="Enquadrar" className="fit">⤢</button>
      </div>
      {overlay}
      {tip && hover && (
        <div className="map-tip" style={{ left: Math.min(hover.x + 16, wrapW - 270), top: hover.y + 14 }}>{tip}</div>
      )}
    </div>
  );
}
