import { useEffect, useMemo, useState } from 'react';
import { cargoInfo } from '../../shared/cargos';
import { fmtInt, fmtPct, normalizeText, titleCase } from '../../shared/format';
import { ufName } from '../../shared/ufs';
import type { CandidateLite } from '../../shared/types';
import type { BoletimSecao, SecaoResumo, SecoesPayload, UrnaEstrutura } from '../../shared/urnas';
import { Boletim } from '../components/urnas/Boletim';
import { SchoolMap, type Ponto } from '../components/urnas/SchoolMap';
import { Avatar, Bar, Card, downloadCsv, Empty, Seg, slotVar } from '../components/ui';
import { useLocaisEstaticos } from '../hooks/useLocaisEstaticos';
import { usePoll } from '../hooks/usePoll';
import type { UrnaMode } from '../hooks/useRoute';
import { urls } from '../lib/api';
import { mix, ramp, slotColor } from '../lib/palette';
import { indiceCandidatos, montarLocais, pad4, ranking, somar, validos, type LocalView, type Soma } from '../lib/urnas';
import { useApp } from '../state';

const intensidade = (share: number) => (share < 0.35 ? 0.42 : share < 0.45 ? 0.58 : share < 0.55 ? 0.74 : share < 0.65 ? 0.88 : 1);

export function UrnasView() {
  const { route, munis, muniList, go } = useApp();
  if (!route.uf || !route.mu) {
    const capitais = muniList.filter((m) => m.capital && (!route.uf || m.uf === route.uf));
    return (
      <Card title="Apuração por urna" sub="Zona eleitoral, local de votação (escola) e seção — boletim por boletim">
        <div className="urna-pick">
          <p>Escolha um município no mapa da visão geral, pela busca (tecla <kbd>/</kbd>) ou numa das capitais abaixo.</p>
          <div className="urna-capitais">
            {capitais.map((m) => <button key={m.code} className="ghost-btn" onClick={() => go({ uf: m.uf, mu: m.code, z: undefined, esc: undefined, s: undefined })}>{titleCase(m.name)} <small>{m.uf.toUpperCase()}</small></button>)}
          </div>
        </div>
      </Card>
    );
  }
  return <UrnasMunicipio key={`${route.uf}-${route.mu}`} uf={route.uf} mu={route.mu} nome={munis.get(route.mu)?.name ?? route.mu} />;
}

function UrnasMunicipio({ uf, mu, nome }: { uf: string; mu: string; nome: string }) {
  const { route, go, result, palette, t, isDemo, meta } = useApp();
  const q = { cargo: route.cargo, uf, mu, turno: route.turno, t };
  const refresh = t !== undefined ? null : (meta?.refreshSeconds ?? 30) * 1000;
  const est = usePoll<UrnaEstrutura>(urls.urnasEstrutura(q), null);
  const e = est.data && est.data.mu === mu ? est.data : null;
  const estaticos = useLocaisEstaticos(uf, mu, !!e && !e.locais);
  const escolaRota = route.esc?.split('-').map(Number);
  const zona = route.z ?? escolaRota?.[0] ?? (e ? (e.municipioInteiro ? null : e.zonas[0]?.zona ?? null) : null);
  const prop = cargoInfo(route.cargo).proportional;
  const foco = route.fc && prop ? [result.data?.candidates.find((c) => c.id === route.fc)?.number].filter((x): x is string => !!x) : [];
  const sec = usePoll<SecoesPayload>(e ? urls.urnasSecoes(q, zona, foco) : null, refresh);
  useEffect(() => {
    if (!sec.data?.pending && !sec.data?.falhas) return;
    // carga em andamento: acompanha de perto; falhas de acesso: tenta de novo com calma
    const id = window.setTimeout(sec.refresh, sec.data.pending ? 2500 : 10_000);
    return () => window.clearTimeout(id);
  }, [sec.data, sec.refresh]);
  const payload = sec.data && sec.data.mu === mu && sec.data.zona === zona && sec.data.cargo === route.cargo ? sec.data : null;
  const secoes = payload?.secoes ?? [];
  const bol = usePoll<BoletimSecao>(route.s && (zona ?? escolaRota?.[0]) ? urls.urnasBoletim(q, (zona ?? escolaRota![0])!, route.s) : null, refresh);

  const cands = useMemo(() => (result.data?.candidates ?? []).map((c) => ({ id: c.id, name: c.name, number: c.number, party: c.party, color: c.color, photo: c.photo }) as CandidateLite), [result.data]);
  const { porNumero, partidos } = useMemo(() => indiceCandidatos(cands), [cands]);
  const locais = useMemo(() => montarLocais(e, estaticos, secoes), [e, estaticos, secoes]);
  const porSecao = useMemo(() => new Map(secoes.map((s) => [`${s.z}:${s.s}`, s])), [secoes]);
  const locaisDaZona = useMemo(() => locais.filter((l) => zona === null || l.zona === zona), [locais, zona]);
  const somaLocal = useMemo(() => new Map(locaisDaZona.map((l) => [l.id, somar(l.secoes.map((s) => porSecao.get(`${l.zona}:${s}`)).filter((x): x is SecaoResumo => !!x))])), [locaisDaZona, porSecao]);
  const escola = route.esc ? locais.find((l) => l.id === route.esc) : undefined;
  const secoesEscopo = useMemo(() => (escola ? escola.secoes.map((s) => porSecao.get(`${escola.zona}:${s}`)).filter((x): x is SecaoResumo => !!x) : secoes), [escola, secoes, porSecao]);
  const somaEscopo = useMemo(() => somar(secoesEscopo), [secoesEscopo]);
  const secAtual = route.s && (escola ? escola.zona : zona) !== null ? porSecao.get(`${escola?.zona ?? zona}:${route.s}`) : undefined;

  // ——— cores dos pontos ———
  const mode: UrnaMode = route.um ?? 'lider';
  const forcaNum = (route.fc ? cands.find((c) => c.id === route.fc) : cands[0])?.number;
  const forcaCand = forcaNum ? porNumero.get(forcaNum) : undefined;
  const { pontos, legenda } = useMemo(() => {
    const comp = locaisDaZona.map((l) => { const s = somaLocal.get(l.id)!; return s.apt ? s.comp / s.apt : null; }).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const qb = [0.2, 0.4, 0.6, 0.8].map((f) => comp[Math.floor(f * (comp.length - 1))] ?? 0);
    const seq = ramp(palette, palette.seq[4], 5);
    let maxF = 0;
    if (mode === 'forca' && forcaNum) for (const s of somaLocal.values()) { const v = validos(s); if (v) maxF = Math.max(maxF, (s.v[forcaNum] ?? 0) / v); }
    const fr = ramp(palette, slotColor(palette, forcaCand?.color ?? 0), 5);
    const contagem = new Map<string, number>();
    const pts: Ponto[] = locais.filter((l) => l.lat != null && l.lon != null).map((l) => {
      const s = somaLocal.get(l.id);
      const base = { id: l.id, lon: l.lon!, lat: l.lat!, peso: l.eleitores || l.secoes.length * 300, cor: palette.empty, vazio: true, apagado: !s };
      if (!s) return base;
      if (mode === 'apuracao') return { ...base, vazio: s.totalizadas === 0, cor: s.totalizadas === s.secoes ? seq[4] : seq[2] };
      if (!s.totalizadas) return base;
      if (mode === 'comparecimento') { const x = s.comp / (s.apt || 1); let b = 0; while (b < 4 && x >= qb[b]) b++; return { ...base, vazio: false, cor: seq[b] }; }
      const v = validos(s);
      if (mode === 'forca' && forcaNum) { const x = v ? (s.v[forcaNum] ?? 0) / v : 0; return { ...base, vazio: false, cor: fr[Math.min(4, Math.floor((x / (maxF || 1)) * 5))] }; }
      const top = ranking(s)[0];
      if (!top) return base;
      const c = porNumero.get(top[0]);
      contagem.set(top[0], (contagem.get(top[0]) ?? 0) + 1);
      return { ...base, vazio: false, cor: mix(palette.surface, slotColor(palette, c?.color ?? -1), intensidade(v ? top[1] / v : 0)) };
    });
    let leg: { cor: string; label: string; n?: number }[];
    if (mode === 'lider') leg = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([num, n]) => ({ cor: slotColor(palette, porNumero.get(num)?.color ?? -1), label: titleCase(porNumero.get(num)?.name ?? num), n }));
    else if (mode === 'forca') leg = fr.map((cor, i) => ({ cor, label: `${fmtPct(((i / 5) * maxF) * 100, 0)}–${fmtPct((((i + 1) / 5) * maxF) * 100, 0)}` }));
    else if (mode === 'comparecimento') leg = seq.map((cor, i) => ({ cor, label: i === 0 ? `< ${fmtPct(qb[0] * 100, 0)}` : i === 4 ? `≥ ${fmtPct(qb[3] * 100, 0)}` : `${fmtPct(qb[i - 1] * 100, 0)}–${fmtPct(qb[i] * 100, 0)}` }));
    else leg = [{ cor: palette.empty, label: 'Aguardando' }, { cor: seq[2], label: 'Parcial' }, { cor: seq[4], label: 'Todas as seções' }];
    return { pontos: pts, legenda: leg };
  }, [locais, locaisDaZona, somaLocal, mode, palette, porNumero, forcaNum, forcaCand]);

  if (est.error && !e) return <Card title="Apuração por urna"><Empty>{est.error}</Empty></Card>;
  if (!e) return <Card title="Apuração por urna"><Empty>Carregando zonas e seções de {titleCase(nome)}…</Empty></Card>;

  const nLocais = locais.length || null;
  const escolher = (patch: Partial<typeof route>) => go(patch);
  const nomeEscola = (l?: LocalView) => (l ? titleCase(l.nome) : '');
  const tituloEscopo = route.s ? `Seção ${pad4(route.s)}` : escola ? nomeEscola(escola) : zona !== null ? `Zona eleitoral ${pad4(zona)}` : `${titleCase(nome)} — todas as zonas`;
  const totalTot = payload ? payload.secoes.filter((s) => s.st === 'totalizada').length : 0;

  return (
    <div className="stack urnas">
      <Card className="urna-top">
        <div className="urna-head">
          <div>
            <h2>Apuração por urna · {titleCase(nome)} <small>{ufName(uf)}</small></h2>
            <p className="card-sub">{e.zonas.length} zona(s) eleitoral(is) · {nLocais ? `${fmtInt(nLocais)} locais de votação · ` : ''}{fmtInt(e.totalSecoes)} seções{payload ? ` · ${fmtInt(totalTot)} de ${fmtInt(payload.total)} boletins ${zona !== null ? 'da zona ' : ''}totalizados` : ''}</p>
          </div>
          <div className="urna-zona">
            <label htmlFor="sel-zona">Zona</label>
            <select id="sel-zona" className="input" value={zona ?? ''} onChange={(ev) => escolher({ z: ev.target.value ? Number(ev.target.value) : undefined, esc: undefined, s: undefined })}>
              {e.municipioInteiro && <option value="">Todas as zonas</option>}
              {e.zonas.map((z) => <option key={z.zona} value={z.zona}>Zona {pad4(z.zona)} · {fmtInt(z.secoes.length)} seções</option>)}
            </select>
          </div>
        </div>
        {!e.municipioInteiro && <p className="urna-aviso">Município grande: a soma é feita por zona eleitoral ({fmtInt(e.totalSecoes)} boletins no total). O resultado oficial do município inteiro está na visão geral.</p>}
        {payload && payload.pending > 0 && <div className="urna-carga"><span className="spinner" /> lendo boletins: {fmtInt(payload.total - payload.pending)} de {fmtInt(payload.total)}<span className="urna-carga-bar"><span style={{ width: `${((payload.total - payload.pending) / payload.total) * 100}%` }} /></span></div>}
        {payload && !!payload.falhas && (
          <p className="urna-aviso erro">
            ⚠ {fmtInt(payload.falhas)} de {fmtInt(payload.total)} boletins não puderam ser lidos agora{payload.aviso ? `: ${payload.aviso}` : ''}. O sistema tenta de novo automaticamente.
          </p>
        )}
        {payload && !payload.pending && !payload.falhas && payload.total > 0 && secoes.every((x) => x.st !== 'totalizada') && (
          <p className="urna-aviso">Nenhum boletim desta {zona === null ? 'cidade' : 'zona'} foi publicado ainda pelo TSE — eles aparecem aqui conforme as urnas são totalizadas.</p>
        )}
        {sec.error && <p className="urna-aviso erro">{sec.error}</p>}
      </Card>

      <div className="grid-geral">
        <div className="stack">
          <Card className="map-card" title="Locais de votação" sub="Cada ponto é uma escola (ou outro local de votação), do tamanho do seu eleitorado"
            actions={<Seg size="sm" label="Cor dos pontos" value={mode} onChange={(m) => go({ um: m })} options={[{ id: 'lider', label: 'Líder' }, { id: 'forca', label: 'Força' }, { id: 'comparecimento', label: 'Comparecimento' }, { id: 'apuracao', label: 'Apuração' }]} />}>
            {mode === 'forca' && cands.length > 0 && (
              <div className="map-pick"><span>Candidato:</span>
                <select value={forcaCand?.id ?? ''} onChange={(ev) => go({ fc: ev.target.value })} aria-label="Candidato do mapa de força">
                  {cands.slice(0, 300).map((c) => <option key={c.id} value={c.id}>{titleCase(c.name)} ({c.party} {c.number})</option>)}
                </select>
              </div>
            )}
            {pontos.length ? (
              <SchoolMap uf={uf} mu={mu} pontos={pontos} selecionado={escola?.id} vazioCor={palette.empty}
                onPick={(id) => escolher({ esc: id === route.esc ? undefined : id, z: Number(id.split('-')[0]), s: undefined })}
                renderTip={(id) => <LocalTip l={locais.find((x) => x.id === id)} s={somaLocal.get(id)} porNumero={porNumero} />}
                overlay={<div className="legend"><div className="legend-title">{mode === 'lider' ? 'Quem lidera em cada local' : mode === 'forca' ? `Força de ${titleCase(forcaCand?.name ?? '')}` : mode === 'comparecimento' ? 'Comparecimento' : 'Boletins totalizados'}</div>
                  <ul className={`legend-items ${mode === 'lider' ? 'cat' : 'seq'}`}>{legenda.map((it) => <li key={it.label}><i style={{ background: it.cor }} /><span>{it.label}</span>{it.n !== undefined && <b className="num">{it.n}</b>}</li>)}</ul></div>} />
            ) : (
              <Mosaico locais={locaisDaZona} soma={somaLocal} porNumero={porNumero} palette={palette} selecionado={escola?.id} onPick={(id) => escolher({ esc: id, s: undefined })} />
            )}
          </Card>
          <SecoesTabela secoes={secoesEscopo} locais={locais} porNumero={porNumero} titulo={escola ? `Seções de ${nomeEscola(escola)}` : zona !== null ? `Seções da zona ${pad4(zona)}` : 'Seções do município'}
            selecionada={route.s} onPick={(z, s) => escolher({ z, s })} />
        </div>

        <div className="stack">
          <nav className="urna-crumbs" aria-label="Navegação na apuração por urna">
            <button onClick={() => escolher({ z: undefined, esc: undefined, s: undefined })} className={!route.z && !route.esc && !route.s ? 'on' : ''}>{titleCase(nome)}</button>
            {zona !== null && <><span>›</span><button onClick={() => escolher({ z: zona, esc: undefined, s: undefined })} className={!route.esc && !route.s ? 'on' : ''}>Zona {pad4(zona)}</button></>}
            {escola && <><span>›</span><button onClick={() => escolher({ s: undefined })} className={!route.s ? 'on' : ''}>{nomeEscola(escola)}</button></>}
            {route.s && <><span>›</span><button className="on">Seção {pad4(route.s)}</button></>}
          </nav>
          {route.s ? (
            bol.data && bol.data.secao === route.s ? (
              <Boletim b={bol.data} municipio={nome} demo={isDemo} turno={route.turno} escola={escola?.nome ?? locais.find((l) => l.zona === bol.data!.zona && l.local === bol.data!.local)?.nome}
                onCand={(id) => go({ cand: id })} />
            ) : <Card><Empty>{bol.error ?? 'Carregando o boletim de urna…'}</Empty></Card>
          ) : (
            <Resumo titulo={tituloEscopo} sub={escola ? [escola.endereco, escola.bairro].filter(Boolean).map((x) => titleCase(x!)).join(' · ') : undefined}
              s={somaEscopo} porNumero={porNumero} partidos={partidos} prop={prop} onCand={(id) => go({ cand: id })} />
          )}
          {escola && !route.s && <SecoesGrade escola={escola} porSecao={porSecao} porNumero={porNumero} palette={palette} onPick={(s) => escolher({ s, z: escola.zona })} />}
          {!escola && !route.s && <ListaEscolas locais={locaisDaZona} soma={somaLocal} porNumero={porNumero} onPick={(id) => escolher({ esc: id, z: Number(id.split('-')[0]) })} />}
          {secAtual && route.s && <p className="muted small">Seção {pad4(route.s)} · {secAtual.st === 'totalizada' ? `${fmtInt(secAtual.comp)} votantes de ${fmtInt(secAtual.apt)} aptos` : secAtual.st}</p>}
        </div>
      </div>
      {!locais.some((l) => !l.semNome) && !isDemo && locais.length > 0 && (
        <p className="muted small">Os nomes das escolas vêm do cadastro de locais de votação do TSE (dados abertos), gerado no build com <code>npm run locais</code>. Sem ele, os locais aparecem pelo número.</p>
      )}
    </div>
  );
}

function LocalTip({ l, s, porNumero }: { l?: LocalView; s?: Soma; porNumero: Map<string, CandidateLite> }) {
  if (!l) return null;
  const v = s ? validos(s) : 0;
  return (
    <div className="tip">
      <strong>{titleCase(l.nome)}</strong>
      <div className="tip-muted">{[l.bairro && titleCase(l.bairro), `Zona ${pad4(l.zona)} · Local ${l.local}`].filter(Boolean).join(' · ')}</div>
      <div className="tip-muted">{s ? `${s.totalizadas}/${s.secoes} seções totalizadas · ${fmtInt(l.eleitores ?? s.apt)} eleitores` : 'Fora da zona carregada'}</div>
      {s && v > 0 && <ul>{ranking(s).slice(0, 3).map(([n, q]) => { const c = porNumero.get(n); return <li key={n}><i style={{ background: slotVar(c?.color ?? -1) }} /><span>{titleCase(c?.name ?? n)} <small>{c?.party}</small></span><b className="num">{fmtPct((q / v) * 100, 1)}</b></li>; })}</ul>}
    </div>
  );
}

function Resumo({ titulo, sub, s, porNumero, partidos, prop, onCand }: { titulo: string; sub?: string; s: Soma; porNumero: Map<string, CandidateLite>; partidos: Map<string, { sigla: string; cor: number }>; prop: boolean; onCand: (id: string) => void }) {
  const v = validos(s);
  const total = v + s.bra + s.nul;
  const top = ranking(s).slice(0, prop ? 8 : 6);
  const max = top[0]?.[1] || 1;
  const parts = prop ? Object.entries(s.p).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  return (
    <Card title={titulo} sub={sub}>
      <div className="urna-prog"><span style={{ width: `${s.secoes ? (s.totalizadas / s.secoes) * 100 : 0}%` }} /></div>
      <div className="urna-stats">
        <div><span>Seções</span><b className="num">{fmtInt(s.totalizadas)}<small>/{fmtInt(s.secoes)}</small></b></div>
        <div><span>Aptos</span><b className="num">{fmtInt(s.apt)}</b></div>
        <div><span>Comparecimento</span><b className="num">{s.apt ? fmtPct((s.comp / s.apt) * 100, 1) : '—'}</b></div>
        <div><span>Brancos</span><b className="num">{total ? fmtPct((s.bra / total) * 100, 1) : '—'}</b></div>
        <div><span>Nulos</span><b className="num">{total ? fmtPct((s.nul / total) * 100, 1) : '—'}</b></div>
      </div>
      {!s.totalizadas ? <Empty>Nenhum boletim totalizado aqui ainda.</Empty> : (
        <ol className="urna-cands">
          {top.map(([n, q], i) => {
            const c = porNumero.get(n);
            return (
              <li key={n} className={c ? 'clickable' : ''} onClick={c ? () => onCand(c.id) : undefined}>
                <span className="num rk">{i + 1}</span>
                <Avatar name={c?.name ?? n} photo={c?.photo} color={c?.color ?? -1} size={30} />
                <span className="nm">{titleCase(c?.name ?? `Candidato ${n}`)}<small>{c?.party} · {n}</small></span>
                <Bar pct={q} max={max} color={slotVar(c?.color ?? -1)} />
                <span className="num vt">{fmtInt(q)}</span>
                <b className="num">{fmtPct((q / (v || 1)) * 100, 1)}</b>
              </li>
            );
          })}
        </ol>
      )}
      {parts.length > 0 && (
        <div className="urna-partidos">
          <h3>Votos por partido (nominais + legenda)</h3>
          <div className="h2h">
            {parts.map(([pn, q]) => { const p = partidos.get(pn); const pct = (q / (v || 1)) * 100; return <span key={pn} style={{ width: `${pct}%`, background: slotVar(p?.cor ?? -1) }} title={`${p?.sigla ?? pn}: ${fmtPct(pct, 1)}`}>{pct > 8 && <b className="num">{p?.sigla ?? pn}</b>}</span>; })}
          </div>
        </div>
      )}
    </Card>
  );
}

type Ordem = 'eleitores' | 'nome' | 'lider' | 'comparecimento';
function ListaEscolas({ locais, soma, porNumero, onPick }: { locais: LocalView[]; soma: Map<string, Soma>; porNumero: Map<string, CandidateLite>; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('eleitores');
  const [limite, setLimite] = useState(25);
  const lista = useMemo(() => {
    const n = normalizeText(q);
    const l = locais.filter((x) => !n || normalizeText(`${x.nome} ${x.bairro ?? ''} ${x.local}`).includes(n));
    const lider = (x: LocalView) => { const s = soma.get(x.id); const r = s ? ranking(s)[0] : undefined; return r && s ? r[1] / (validos(s) || 1) : 0; };
    return [...l].sort((a, b) => ordem === 'nome' ? a.nome.localeCompare(b.nome, 'pt-BR') : ordem === 'lider' ? lider(b) - lider(a)
      : ordem === 'comparecimento' ? ((soma.get(b.id)?.comp ?? 0) / (soma.get(b.id)?.apt || 1)) - ((soma.get(a.id)?.comp ?? 0) / (soma.get(a.id)?.apt || 1)) : (b.eleitores ?? 0) - (a.eleitores ?? 0));
  }, [locais, soma, q, ordem]);
  if (!locais.length) return null;
  return (
    <Card title={<>Locais de votação <span className="count">{fmtInt(locais.length)}</span></>}
      actions={<select className="input sm" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar locais"><option value="eleitores">Mais eleitores</option><option value="lider">Maior vitória</option><option value="comparecimento">Maior comparecimento</option><option value="nome">Nome (A–Z)</option></select>}>
      <input className="input" style={{ width: '100%', marginBottom: 8 }} placeholder="Buscar escola, bairro ou número do local…" value={q} onChange={(e) => { setQ(e.target.value); setLimite(25); }} aria-label="Buscar local de votação" />
      <ul className="escolas">
        {lista.slice(0, limite).map((l) => {
          const s = soma.get(l.id);
          const r = s ? ranking(s) : [];
          const c = r[0] ? porNumero.get(r[0][0]) : undefined;
          const v = s ? validos(s) : 0;
          return (
            <li key={l.id}>
              <button onClick={() => onPick(l.id)}>
                <i className="dot-c" style={{ background: c ? slotVar(c.color) : 'var(--map-empty)' }} />
                <span className="es-nome">{titleCase(l.nome)}<small>{[l.bairro && titleCase(l.bairro), `Zona ${pad4(l.zona)} · Local ${l.local}`, `${l.secoes.length} seções`].filter(Boolean).join(' · ')}</small></span>
                <span className="es-res">{c && v ? <><b className="num">{fmtPct((r[0][1] / v) * 100, 1)}</b><small>{titleCase(c.name)}</small></> : <small>{s ? `${s.totalizadas}/${s.secoes} seções` : '—'}</small>}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > limite && <button className="more-btn" onClick={() => setLimite((x) => x + 50)}>Mostrar mais ({fmtInt(lista.length - limite)})</button>}
    </Card>
  );
}

function SecoesGrade({ escola, porSecao, porNumero, palette, onPick }: { escola: LocalView; porSecao: Map<string, SecaoResumo>; porNumero: Map<string, CandidateLite>; palette: ReturnType<typeof useApp>['palette']; onPick: (s: number) => void }) {
  return (
    <Card title={`Seções deste local (${escola.secoes.length})`} sub="Clique numa seção para abrir o boletim de urna">
      <div className="secoes-grade">
        {escola.secoes.map((n) => {
          const s = porSecao.get(`${escola.zona}:${n}`);
          const r = s && s.st === 'totalizada' ? ranking(somar([s])) : [];
          const c = r[0] ? porNumero.get(r[0][0]) : undefined;
          const v = s ? s.nom + s.leg : 0;
          return (
            <button key={n} className={`secao ${s?.st ?? 'aguardando'}`} onClick={() => onPick(n)} style={{ ['--c' as string]: c ? slotColor(palette, c.color) : 'var(--map-empty)' }}>
              <b className="num">{pad4(n)}</b>
              {s?.st === 'totalizada' && c ? <><span>{titleCase(c.name)}</span><small className="num">{fmtPct((r[0][1] / (v || 1)) * 100, 1)} · {fmtInt(s.comp)} votos</small></> : <small>{s?.st === 'agregada' ? 'agregada' : 'aguardando'}</small>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function Mosaico({ locais, soma, porNumero, palette, selecionado, onPick }: { locais: LocalView[]; soma: Map<string, Soma>; porNumero: Map<string, CandidateLite>; palette: ReturnType<typeof useApp>['palette']; selecionado?: string; onPick: (id: string) => void }) {
  if (!locais.length) return <Empty>Os locais aparecem conforme os boletins são lidos.</Empty>;
  const zonas = [...new Set(locais.map((l) => l.zona))];
  return (
    <div className="mosaico">
      <p className="muted small">Sem coordenadas dos locais: cada quadrado é um local de votação, agrupado por zona.</p>
      {zonas.map((z) => (
        <div key={z} className="mosaico-zona">
          <h4>Zona {pad4(z)}</h4>
          <div>
            {locais.filter((l) => l.zona === z).map((l) => {
              const s = soma.get(l.id);
              const r = s ? ranking(s)[0] : undefined;
              const c = r ? porNumero.get(r[0]) : undefined;
              return <button key={l.id} title={`${titleCase(l.nome)}${c ? ` — ${titleCase(c.name)}` : ''}`} className={l.id === selecionado ? 'sel' : ''} style={{ background: c ? slotColor(palette, c.color) : palette.empty }} onClick={() => onPick(l.id)}>{l.local}</button>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

type OrdemSec = 'secao' | 'aptos' | 'comp' | 'lider' | 'margem';
function SecoesTabela({ secoes, locais, porNumero, titulo, selecionada, onPick }: { secoes: SecaoResumo[]; locais: LocalView[]; porNumero: Map<string, CandidateLite>; titulo: string; selecionada?: number; onPick: (z: number, s: number) => void }) {
  const [ordem, setOrdem] = useState<{ k: OrdemSec; desc: boolean }>({ k: 'secao', desc: false });
  const [limite, setLimite] = useState(30);
  const nomeLocal = useMemo(() => new Map(locais.map((l) => [`${l.zona}-${l.local}`, l.nome])), [locais]);
  const linhas = useMemo(() => secoes.filter((s) => s.st !== 'agregada').map((s) => {
    const r = Object.entries(s.v).sort((a, b) => b[1] - a[1]);
    const v = s.nom + s.leg || 1;
    return { s, l1: r[0], l2: r[1], p1: r[0] ? (r[0][1] / v) * 100 : 0, p2: r[1] ? (r[1][1] / v) * 100 : 0 };
  }), [secoes]);
  const ord = useMemo(() => {
    const val = (x: (typeof linhas)[number]) => ordem.k === 'secao' ? x.s.z * 10000 + x.s.s : ordem.k === 'aptos' ? x.s.apt : ordem.k === 'comp' ? x.s.comp / (x.s.apt || 1) : ordem.k === 'lider' ? x.p1 : x.p1 - x.p2;
    return [...linhas].sort((a, b) => (ordem.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [linhas, ordem]);
  if (!linhas.length) return null;
  const th = (k: OrdemSec, label: string, cls = '') => <th className={`${cls} sortable ${ordem.k === k ? 'on' : ''}`} onClick={() => setOrdem((o) => ({ k, desc: o.k === k ? !o.desc : k !== 'secao' }))}>{label}{ordem.k === k ? (ordem.desc ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <Card title={titulo} sub={`${fmtInt(linhas.length)} seções · clique para abrir o boletim`}
      actions={<button className="ghost-btn" onClick={() => downloadCsv('secoes.csv', [['Zona', 'Seção', 'Local', 'Escola', 'Situação', 'Aptos', 'Compareceram', 'Brancos', 'Nulos', 'Líder', '% líder', '2º', '% 2º'],
        ...ord.map((x) => [x.s.z, x.s.s, x.s.l ?? '', nomeLocal.get(`${x.s.z}-${x.s.l}`) ?? '', x.s.st, x.s.apt, x.s.comp, x.s.bra, x.s.nul, porNumero.get(x.l1?.[0] ?? '')?.name ?? x.l1?.[0] ?? '', x.p1.toFixed(2).replace('.', ','), porNumero.get(x.l2?.[0] ?? '')?.name ?? x.l2?.[0] ?? '', x.p2.toFixed(2).replace('.', ',')])])}>⭳ CSV</button>}>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>{th('secao', 'Seção')}<th className="hide-sm">Local de votação</th>{th('aptos', 'Aptos', 'r hide-sm')}{th('comp', 'Compar.', 'r')}{th('lider', 'Líder')}<th className="hide-sm">2º</th>{th('margem', 'Margem', 'r')}</tr></thead>
          <tbody>
            {ord.slice(0, limite).map((x) => {
              const c1 = porNumero.get(x.l1?.[0] ?? ''), c2 = porNumero.get(x.l2?.[0] ?? '');
              return (
                <tr key={`${x.s.z}:${x.s.s}`} className={selecionada === x.s.s ? 'on' : ''} onClick={() => onPick(x.s.z, x.s.s)}>
                  <td className="strong num">{pad4(x.s.z)}/{pad4(x.s.s)}</td>
                  <td className="hide-sm">{titleCase(nomeLocal.get(`${x.s.z}-${x.s.l}`) ?? (x.s.l ? `Local ${x.s.l}` : '—'))}</td>
                  <td className="r num hide-sm">{x.s.st === 'totalizada' ? fmtInt(x.s.apt) : '—'}</td>
                  <td className="r num">{x.s.st === 'totalizada' ? fmtPct((x.s.comp / (x.s.apt || 1)) * 100, 1) : <span className="badge out sm">aguardando</span>}</td>
                  <td>{c1 || x.l1 ? <span className="who"><i className="dot-c" style={{ background: slotVar(c1?.color ?? -1) }} /><span>{titleCase(c1?.name ?? x.l1![0])}</span><b className="num">{fmtPct(x.p1, 1)}</b></span> : '—'}</td>
                  <td className="hide-sm">{c2 || x.l2 ? <span className="who dim"><span>{titleCase(c2?.name ?? x.l2![0])}</span><b className="num">{fmtPct(x.p2, 1)}</b></span> : '—'}</td>
                  <td className="r num">{x.l1 ? (x.p1 - x.p2).toFixed(1).replace('.', ',') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ord.length > limite && <button className="more-btn" onClick={() => setLimite((l) => l + 60)}>Mostrar mais ({fmtInt(ord.length - limite)})</button>}
    </Card>
  );
}
