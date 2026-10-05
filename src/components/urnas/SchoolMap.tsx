import { geoCentroid, geoContains, geoMercator, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadGeo, type GeoFeature } from '../../lib/geo';

export interface Ponto { id: string; lon: number; lat: number; peso: number; cor: string; vazio: boolean; destaque?: boolean; apagado?: boolean }

const W = 1000;

/** Mapa do município com um ponto por local de votação. Pontos fora do contorno são puxados para dentro. */
export function SchoolMap({ uf, mu, pontos, selecionado, onPick, renderTip, overlay, vazioCor }: {
  uf: string; mu: string; pontos: Ponto[]; selecionado?: string; onPick: (id: string) => void;
  renderTip: (id: string) => ReactNode; overlay?: ReactNode; vazioCor: string;
}) {
  const [feature, setFeature] = useState<GeoFeature | null | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadGeo(uf).then((fs) => { if (alive) setFeature(fs.find((f) => f.properties.code === mu) ?? null); }).catch(() => alive && setFeature(null));
    return () => { alive = false; };
  }, [uf, mu]);

  const geo = useMemo(() => {
    if (feature === undefined) return null;
    const comCoord = pontos.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
    const alvo = feature ?? { type: 'FeatureCollection' as const, features: comCoord.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } })) };
    const probe = geoPath(geoMercator().scale(1).translate([0, 0])).bounds(alvo);
    const aspect = (probe[1][1] - probe[0][1]) / (probe[1][0] - probe[0][0] || 1);
    const H = Math.round(Math.min(1000, Math.max(520, W * (Number.isFinite(aspect) ? aspect : 0.7))));
    const proj = geoMercator().fitExtent([[30, 30], [W - 30, H - 30]], alvo);
    const path = geoPath(proj);
    const centro = feature ? geoCentroid(feature) : null;
    const maxPeso = Math.max(1, ...pontos.map((p) => p.peso));
    const pts = comCoord.map((p) => {
      let ll: [number, number] = [p.lon, p.lat];
      // coordenada fora do município (cadastro impreciso): aproxima do centro até cair dentro
      if (feature && centro && !geoContains(feature, ll)) {
        for (let k = 1; k <= 12 && !geoContains(feature, ll); k++) ll = [p.lon + (centro[0] - p.lon) * (k / 12), p.lat + (centro[1] - p.lat) * (k / 12)];
      }
      const xy = proj(ll) ?? [0, 0];
      return { ...p, x: xy[0], y: xy[1], r: 3.5 + 13 * Math.sqrt(p.peso / maxPeso) };
    }).sort((a, b) => b.r - a.r);
    return { H, d: feature ? path(feature) ?? '' : '', pts };
  }, [feature, pontos]);

  useEffect(() => {
    const svg = svgRef.current, g = gRef.current;
    if (!svg || !g || !geo) return;
    const z = zoom<SVGSVGElement, unknown>().scaleExtent([1, 30]).on('zoom', (ev) => {
      g.setAttribute('transform', ev.transform.toString());
      svg.style.setProperty('--ks', String(Math.sqrt(ev.transform.k)));
      svg.style.setProperty('--k', String(ev.transform.k));
    });
    zoomRef.current = z;
    select(svg).call(z).on('dblclick.zoom', null);
    select(svg).call(z.transform, zoomIdentity);
    return () => { select(svg).on('.zoom', null); };
  }, [geo?.H, uf, mu]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy, f); };
  const reset = () => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) select(svg).transition().duration(400).call(z.transform, zoomIdentity); };

  const onMove = (e: React.PointerEvent) => {
    const t = (e.target as Element).closest?.('[data-id]') as SVGElement | null;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!t || !box) { if (hover) setHover(null); return; }
    setHover({ id: t.dataset.id!, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  if (!geo) return <div className="map-wrap"><div className="map-msg"><span className="spinner" /> Carregando mapa…</div></div>;
  const tip = hover ? renderTip(hover.id) : null;
  const wrapW = wrapRef.current?.clientWidth ?? 600;
  return (
    <div className="map-wrap school-map" ref={wrapRef}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${geo.H}`} className="map-svg pickable" role="img" aria-label="Mapa dos locais de votação"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        onClick={(e) => { const t = (e.target as Element).closest?.('[data-id]') as SVGElement | null; if (t) onPick(t.dataset.id!); }}>
        <g ref={gRef}>
          {geo.d && <path className="muni-shape" d={geo.d} />}
          <g className="pts">
            {geo.pts.map((p) => (
              <circle key={p.id} data-id={p.id} cx={p.x} cy={p.y} fill={p.vazio ? vazioCor : p.cor}
                className={`${p.vazio ? 'vazio' : ''} ${p.apagado ? 'apagado' : ''} ${p.id === selecionado ? 'sel' : ''} ${p.id === hover?.id ? 'hov' : ''}`}
                style={{ r: `calc(${p.r.toFixed(1)}px / var(--ks, 1))` } as React.CSSProperties} />
            ))}
          </g>
        </g>
      </svg>
      <div className="map-zoom" role="group" aria-label="Zoom do mapa">
        <button onClick={() => zoomBy(1.7)} aria-label="Aproximar">+</button>
        <button onClick={() => zoomBy(1 / 1.7)} aria-label="Afastar">−</button>
        <button onClick={reset} aria-label="Enquadrar" className="fit">⤢</button>
      </div>
      {overlay}
      {tip && hover && <div className="map-tip" style={{ left: Math.min(hover.x + 16, wrapW - 290), top: hover.y + 14 }}>{tip}</div>}
    </div>
  );
}
