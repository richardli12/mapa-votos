import { useEffect, useMemo, useState } from 'react';
import { fmtPct, titleCase } from '../../shared/format';
import type { Result } from '../../shared/types';
import { useWidth } from '../hooks/useWidth';
import { getJson, urls } from '../lib/api';
import { useApp } from '../state';
import { Card, slotVar } from './ui';

interface Point { p: number; v: Record<string, number> }

/** Série "% dos votos × % apurado". Ao vivo: acumula a cada atualização. Simulação: reconstrói a noite inteira. */
function useEvolution(r: Result | null): Point[] {
  const { isDemo, route } = useApp();
  const key = r ? `agora-evo:${r.cargo}:${r.scope.uf ?? 'br'}:${r.scope.mu ?? ''}:${r.round}:${isDemo ? 'demo' : 'live'}` : '';
  const [series, setSeries] = useState<{ key: string; pts: Point[] }>({ key: '', pts: [] });

  useEffect(() => {
    if (!r || !isDemo) return;
    let alive = true;
    const steps = Array.from({ length: 24 }, (_, i) => 0.06 + (i * 0.94) / 23);
    Promise.all(steps.map((t) => getJson<Result>(urls.resultado({ cargo: r.cargo, uf: r.scope.uf, mu: r.scope.mu, turno: route.turno, t })).catch(() => null)))
      .then((rs) => {
        if (!alive) return;
        const pts = rs.filter((x): x is Result => !!x && x.totals.valid > 0).map((x) => ({ p: x.totals.pctCounted, v: Object.fromEntries(x.candidates.slice(0, 8).map((c) => [c.id, c.pct])) }));
        setSeries({ key, pts });
      });
    return () => { alive = false; };
  }, [key, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!r || isDemo || r.totals.valid === 0) return;
    setSeries((s) => {
      let pts = s.key === key ? s.pts : (() => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') as Point[]; } catch { return []; } })();
      const last = pts.at(-1);
      if (!last || Math.abs(last.p - r.totals.pctCounted) > 0.01) {
        pts = [...pts.filter((x) => x.p < r.totals.pctCounted), { p: r.totals.pctCounted, v: Object.fromEntries(r.candidates.slice(0, 8).map((c) => [c.id, c.pct])) }].slice(-400);
        try { localStorage.setItem(key, JSON.stringify(pts)); } catch { /* sem armazenamento */ }
      }
      return { key, pts };
    });
  }, [r, key, isDemo]);

  return series.key === key ? series.pts : [];
}

export function Evolution({ r }: { r: Result }) {
  const pts = useEvolution(r);
  const { t, isDemo } = useApp();
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const lines = r.candidates.slice(0, 4);
  const H = W < 560 ? 220 : 260, L = 38, R = W < 560 ? 92 : 132, T = 12, B = 28;
  const yMax = useMemo(() => Math.min(100, Math.ceil((Math.max(10, ...pts.flatMap((p) => lines.map((c) => p.v[c.id] ?? 0))) + 4) / 10) * 10), [pts, lines]);
  if (pts.length < 2) {
    return (
      <Card title="Evolução da apuração" sub="Como as porcentagens mudam conforme as urnas são totalizadas">
        <div ref={box} />
        <div className="empty sm">{isDemo ? 'Calculando a série…' : 'A curva aparece a partir da segunda atualização recebida nesta sessão.'}</div>
      </Card>
    );
  }
  const x = (p: number) => L + (p / 100) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const visible = t !== undefined ? pts.filter((p) => p.p <= r.totals.pctCounted + 0.01) : pts;
  const hp = hover !== null ? visible.reduce((best, p) => (Math.abs(p.p - hover) < Math.abs(best.p - hover) ? p : best), visible[0]) : null;
  const ends = lines.map((c) => ({ c, v: visible.at(-1)?.v[c.id] ?? 0 })).sort((a, b) => b.v - a.v);
  let lastY = -99;
  const labelY = ends.map((e) => { let yy = y(e.v); if (yy - lastY < 15) yy = lastY + 15; lastY = yy; return { ...e, yy }; });
  // Viradas: troca de liderança entre pontos consecutivos
  const flips = visible.slice(1).filter((p, i) => {
    const a = Object.entries(visible[i].v).sort((m, n) => n[1] - m[1])[0]?.[0];
    const b = Object.entries(p.v).sort((m, n) => n[1] - m[1])[0]?.[0];
    return a && b && a !== b;
  });
  return (
    <Card title="Evolução da apuração" sub={flips.length ? `${flips.length} virada(s) na liderança até agora` : 'Como as porcentagens mudam conforme as urnas são totalizadas'}>
      <div className="evo" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Gráfico de linhas: porcentagem dos votos válidos por porcentagem de seções apuradas"
          onPointerMove={(e) => { const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - b.left) / b.width) * W; setHover(Math.max(0, Math.min(100, ((px - L) / (W - L - R)) * 100))); }}
          onPointerLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(f * yMax)} y2={y(f * yMax)} /><text className="axis" x={L - 6} y={y(f * yMax) + 4} textAnchor="end">{Math.round(f * yMax)}%</text></g>)}
          {[0, 25, 50, 75, 100].map((p) => <text key={p} className="axis" x={x(p)} y={H - 8} textAnchor="middle">{p}%</text>)}
          <text className="axis" x={W - R} y={H - 8} dx={22}>apurado</text>
          {flips.map((f) => <line key={f.p} className="flip" x1={x(f.p)} x2={x(f.p)} y1={T} y2={H - B} />)}
          {lines.map((c) => (
            <polyline key={c.id} fill="none" stroke={slotVar(c.color)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={visible.filter((p) => p.v[c.id] !== undefined).map((p) => `${x(p.p)},${y(p.v[c.id])}`).join(' ')} />
          ))}
          {labelY.map(({ c, v, yy }) => (
            <g key={c.id}>
              <circle cx={x(visible.at(-1)!.p)} cy={y(v)} r={4} fill={slotVar(c.color)} stroke="var(--surface-1)" strokeWidth={2} />
              <text className="end-label" x={x(visible.at(-1)!.p) + 10} y={yy + 4}>{titleCase(c.name).split(' ')[0]} {fmtPct(v, 1)}</text>
            </g>
          ))}
          {hp && (
            <g>
              <line className="cross" x1={x(hp.p)} x2={x(hp.p)} y1={T} y2={H - B} />
              {lines.map((c) => hp.v[c.id] !== undefined && <circle key={c.id} cx={x(hp.p)} cy={y(hp.v[c.id])} r={4} fill={slotVar(c.color)} stroke="var(--surface-1)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hp && (
          <div className="evo-tip" style={{ left: `${(x(hp.p) / W) * 100}%` }}>
            <b>{fmtPct(hp.p, 1)} apurado</b>
            {lines.map((c) => <span key={c.id}><i style={{ background: slotVar(c.color) }} />{titleCase(c.name)} <b className="num">{fmtPct(hp.v[c.id] ?? 0)}</b></span>)}
          </div>
        )}
        <div className="evo-legend">{lines.map((c) => <span key={c.id}><i style={{ background: slotVar(c.color) }} />{titleCase(c.name)}</span>)}</div>
      </div>
    </Card>
  );
}
