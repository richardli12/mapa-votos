import { cargoLabel, CARGOS } from '../../shared/cargos';
import { fmtCompact, fmtInt, fmtPct, titleCase } from '../../shared/format';
import { ufName } from '../../shared/ufs';
import type { Result } from '../../shared/types';
import type { View } from '../hooks/useRoute';
import { useApp } from '../state';
import { Stat } from './ui';

export function ScopeHeader() {
  const { route, go, munis, meta } = useApp();
  const mu = route.mu ? munis.get(route.mu) : undefined;
  const place = mu ? titleCase(mu.name) : route.uf ? ufName(route.uf) : 'Brasil';
  const cargo = cargoLabel(route.cargo, route.uf);
  const plural: Record<string, string> = { governador: 'Governadores', senador: 'Senado', depfederal: 'Câmara dos Deputados', depestadual: 'Assembleias Legislativas' };
  const title = !route.uf && route.cargo !== 'presidente' ? plural[route.cargo] : cargo;
  return (
    <div className="scope-head">
      <nav className="crumbs" aria-label="Navegação geográfica">
        <button onClick={() => go({ uf: undefined, mu: undefined })} className={!route.uf ? 'on' : ''}>Brasil</button>
        {route.uf && <><span>›</span><button onClick={() => go({ mu: undefined })} className={!route.mu ? 'on' : ''}>{ufName(route.uf)}</button></>}
        {mu && <><span>›</span><button className="on">{titleCase(mu.name)}</button></>}
      </nav>
      <div className="scope-title">
        <h1><span className="cargo">{title}</span><span className="place">{place}</span></h1>
        {meta && meta.rounds.length > 1 && (
          <div className="seg sm" role="tablist" aria-label="Turno">
            {meta.rounds.map((r) => <button key={r} className={route.turno === r ? 'on' : ''} onClick={() => go({ turno: r })}>{r}º turno</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function CargoTabs() {
  const { route, go } = useApp();
  return (
    <div className="cargo-tabs" role="tablist" aria-label="Cargo">
      {CARGOS.map((c) => (
        <button key={c.id} role="tab" aria-selected={route.cargo === c.id} className={route.cargo === c.id ? 'on' : ''}
          onClick={() => go({ cargo: c.id, cand: undefined, cmp: [], mode: undefined })}>
          {cargoLabel(c.id, route.uf)}
        </button>
      ))}
    </div>
  );
}

export function ViewTabs() {
  const { route, go } = useApp();
  const views: { id: View; label: string; icon: string }[] = [
    { id: 'geral', label: 'Visão geral', icon: '◉' },
    { id: 'comparar', label: 'Comparar', icon: '⇆' },
    { id: 'partidos', label: 'Partidos', icon: '◔' },
    { id: 'perfil', label: 'Perfil do voto', icon: '▤' },
    { id: 'urnas', label: 'Urnas: zona, escola e seção', icon: '▦' },
  ];
  return (
    <div className="view-tabs" role="tablist" aria-label="Painel">
      {views.map((v) => (
        <button key={v.id} role="tab" aria-selected={route.view === v.id} className={route.view === v.id ? 'on' : ''} onClick={() => go({ view: v.id })}>
          <i aria-hidden>{v.icon}</i>{v.label}
        </button>
      ))}
    </div>
  );
}

function timeOf(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
}

export function ProgressStrip({ r }: { r: Result | null }) {
  if (!r) return <div className="progress-strip skeleton" />;
  const t = r.totals;
  const label = r.status === 'encerrada' ? 'Apuração encerrada' : r.status === 'apurando' ? 'Apuração em andamento' : 'Aguardando início da apuração';
  return (
    <div className={`progress-strip st-${r.status}`}>
      <div className="ps-main">
        <div className="ps-top">
          <span className="ps-label">{r.status === 'apurando' && <i className="pulse" />}{label}</span>
          <span className="ps-time">atualizado às {timeOf(r.updatedAt)}</span>
        </div>
        <div className="ps-pct"><b>{fmtPct(t.pctCounted)}</b><span>das seções totalizadas</span></div>
        <div className="ps-bar" role="progressbar" aria-valuenow={t.pctCounted} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${t.pctCounted}%` }} /></div>
        <div className="ps-sub">{fmtInt(t.sectionsCounted)} de {fmtInt(t.sections)} seções</div>
      </div>
      <div className="ps-stats">
        <Stat label="Eleitorado" value={fmtCompact(t.electorate)} sub={`${fmtInt(t.electorate)} eleitores`} />
        <Stat label="Comparecimento" value={fmtPct(t.turnoutPct)} sub={`${fmtInt(t.turnout)} votaram`} />
        <Stat label="Abstenção" value={fmtPct(t.abstentionPct)} sub={`${fmtInt(t.abstention)} faltaram`} />
        <Stat label="Válidos" value={fmtCompact(t.valid)} sub={t.legend ? `${fmtInt(t.legend)} de legenda` : `${fmtInt(t.valid)} votos`} />
        <Stat label="Brancos" value={fmtPct(t.blankPct)} sub={fmtInt(t.blank)} />
        <Stat label="Nulos" value={fmtPct(t.nullPct)} sub={fmtInt(t.nulls)} />
      </div>
    </div>
  );
}
