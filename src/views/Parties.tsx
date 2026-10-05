import { useMemo } from 'react';
import { cargoInfo, cargoLabel } from '../../shared/cargos';
import { fmtInt, fmtPct, titleCase } from '../../shared/format';
import { Hemicycle } from '../components/Hemicycle';
import { NationalPanorama } from '../components/National';
import { Exportar } from '../components/Exportar';
import { Bar, Card, Empty, slotVar } from '../components/ui';
import { useApp } from '../state';

export function PartiesView() {
  const { route, result } = useApp();
  if (!route.uf && route.cargo !== 'presidente') return <div className="stack"><NationalPanorama /></div>;
  const r = result.data;
  if (!r) return <Empty>Carregando…</Empty>;
  return <PartyDetail />;
}

function PartyDetail() {
  const { result, go } = useApp();
  const r = result.data!;
  const prop = cargoInfo(r.cargo).proportional;
  const seatParts = r.parties.filter((p) => p.seats).sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0));
  const seatTotal = seatParts.reduce((s, p) => s + (p.seats ?? 0), 0);
  const max = r.parties[0]?.votes || 1;
  const topByParty = useMemo(() => {
    const m = new Map<string, (typeof r.candidates)[number]>();
    for (const c of r.candidates) if (!m.has(c.party)) m.set(c.party, c);
    return m;
  }, [r]);
  const finalCount = r.status === 'encerrada';

  return (
    <div className="stack">
      {prop && r.scope.level === 'uf' && (
        <Card title={`${finalCount ? 'Bancada eleita' : 'Projeção de cadeiras'} — ${r.seats} vagas`}
          sub={finalCount ? 'Distribuição oficial das vagas' : 'Se a apuração terminasse agora (quociente eleitoral + sobras pelas maiores médias)'}>
          {seatTotal ? (
            <div className="composition">
              <Hemicycle parts={seatParts.map((p) => ({ key: p.party, label: p.party, seats: p.seats ?? 0, color: slotVar(p.color) }))} total={r.seats} />
              <div className="qe-box">
                <div><span>Quociente eleitoral</span><b className="num">{r.quotient ? fmtInt(r.quotient) : '—'}</b><small>votos válidos ÷ vagas</small></div>
                <div><span>Votos de legenda</span><b className="num">{fmtInt(r.totals.legend)}</b><small>{fmtPct(r.totals.valid ? (r.totals.legend / r.totals.valid) * 100 : 0)} dos válidos</small></div>
                <div><span>Partidos com cadeira</span><b className="num">{seatParts.length}</b><small>de {r.parties.length} na disputa</small></div>
              </div>
            </div>
          ) : <Empty>A projeção aparece com os primeiros votos.</Empty>}
        </Card>
      )}
      <Card title="Votos por partido" sub={prop ? 'Nominais + legenda' : 'Soma dos votos dos candidatos de cada partido'}
        actions={<Exportar montar={() => ({
          arquivo: `partidos-${r.cargo}-${r.scope.uf ?? 'br'}${r.scope.mu ? '-' + r.scope.mu : ''}`,
          titulo: `${cargoLabel(r.cargo, r.scope.uf)} — votos por partido`,
          resumo: [
            { label: 'Votos válidos', valor: fmtInt(r.totals.valid) },
            { label: 'Votos de legenda', valor: fmtInt(r.totals.legend) },
            { label: 'Partidos', valor: fmtInt(r.parties.length) },
            ...(prop ? [{ label: 'Quociente eleitoral', valor: r.quotient ? fmtInt(r.quotient) : '—' }] : []),
          ],
          colunas: [{ titulo: 'Partido' }, { titulo: 'Nome' }, { titulo: 'Federação' }, { titulo: 'Votos', tipo: 'int' }, { titulo: '%', tipo: 'pct', barra: true }, { titulo: 'Legenda', tipo: 'int' }, { titulo: 'Candidatos', tipo: 'int' }, ...(prop ? [{ titulo: 'Cadeiras', tipo: 'int' as const }] : [])],
          linhas: r.parties.map((p) => [p.party, p.name, p.federation ?? '', p.votes, p.pct, p.legend, p.candidates, ...(prop ? [p.seats ?? 0] : [])]),
        })} />}>
        <div className="table-wrap">
          <table className="tbl parties">
            <thead><tr><th>Partido</th><th className="hide-sm">Mais votado</th><th className="r">Votos</th><th className="bar-col" /><th className="r">%</th>{prop && <th className="r hide-sm">Legenda</th>}<th className="r hide-sm">Cand.</th>{prop && <th className="r">Cadeiras</th>}</tr></thead>
            <tbody>
              {r.parties.map((p) => {
                const top = topByParty.get(p.party);
                return (
                  <tr key={p.party}>
                    <td><span className="who"><i className="dot-c" style={{ background: slotVar(p.color) }} /><span><b>{p.party}</b><small>{p.federation ? `Federação ${p.federation}` : titleCase(p.name)}</small></span></span></td>
                    <td className="hide-sm">{top && <button className="link" onClick={() => go({ cand: top.id })}>{titleCase(top.name)} <small className="num">{fmtInt(top.votes)}</small></button>}</td>
                    <td className="r num">{fmtInt(p.votes)}</td>
                    <td className="bar-col"><Bar pct={p.votes} max={max} color={slotVar(p.color)} /></td>
                    <td className="r num">{fmtPct(p.pct)}</td>
                    {prop && <td className="r num hide-sm">{fmtInt(p.legend)}</td>}
                    <td className="r num hide-sm">{p.candidates}</td>
                    {prop && <td className="r num strong">{p.seats ?? 0}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
