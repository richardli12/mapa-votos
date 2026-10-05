import { useState } from 'react';
import { fmtInt, fmtPct, titleCase } from '../../../shared/format';
import type { BoletimCargo, BoletimSecao } from '../../../shared/urnas';
import { pad4 } from '../../lib/urnas';
import { Avatar, slotVar } from '../ui';

const hora = (iso: string | null) => (iso ? iso.slice(11, 19) : '—');
const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function CargoBloco({ c, onCand }: { c: BoletimCargo; onCand?: (id: string) => void }) {
  const [todos, setTodos] = useState(false);
  const total = c.nominal + c.legenda + c.brancos + c.nulos;
  const validos = c.nominal + c.legenda;
  const max = c.votos[0]?.qtd || 1;
  const lista = todos ? c.votos : c.votos.slice(0, c.tipo === 'proporcional' ? 8 : 12);
  return (
    <section className="bu-cargo">
      <header><b>{c.label.toUpperCase()}</b><span>{c.tipo === 'proporcional' ? 'proporcional' : 'majoritário'} · comparecimento {fmtInt(c.comparecimento)}</span></header>
      <ol>
        {lista.map((v) => (
          <li key={`${v.tipo}-${v.numero}`} className={v.id ? 'clickable' : ''} onClick={v.id && onCand ? () => onCand(v.id!) : undefined}>
            {v.tipo === 'nominal' ? <Avatar name={v.nome ?? String(v.numero)} photo={v.foto} color={v.cor ?? -1} size={22} /> : <i className="bu-leg" style={{ background: slotVar(v.cor ?? -1) }} />}
            <span className="bu-num num">{v.numero}</span>
            <span className="bu-nome">{v.tipo === 'legenda' ? `Legenda ${v.sigla ?? v.numero}` : v.nome ? titleCase(v.nome) : `Candidato ${v.numero}`}{v.sigla && v.tipo === 'nominal' ? <small> {v.sigla}</small> : null}</span>
            <span className="bu-bar"><span style={{ width: `${(v.qtd / max) * 100}%`, background: slotVar(v.cor ?? -1) }} /></span>
            <b className="num">{fmtInt(v.qtd)}</b>
            <small className="num">{validos ? fmtPct((v.qtd / validos) * 100, 1) : ''}</small>
          </li>
        ))}
      </ol>
      {c.votos.length > lista.length && <button className="bu-mais" onClick={() => setTodos(true)}>+ {c.votos.length - lista.length} votáveis com voto nesta seção</button>}
      <dl className="bu-totais">
        <div><dt>Nominais</dt><dd className="num">{fmtInt(c.nominal)}</dd></div>
        {c.tipo === 'proporcional' && <div><dt>Legenda</dt><dd className="num">{fmtInt(c.legenda)}</dd></div>}
        <div><dt>Brancos</dt><dd className="num">{fmtInt(c.brancos)}</dd></div>
        <div><dt>Nulos</dt><dd className="num">{fmtInt(c.nulos)}</dd></div>
        <div><dt>Total</dt><dd className="num">{fmtInt(total)}</dd></div>
      </dl>
    </section>
  );
}

/** Código de barras decorativo derivado do hash do arquivo (cada boletim tem o seu). */
function Barras({ seed }: { seed: string }) {
  const bits = Array.from(seed.padEnd(48, '0').slice(0, 48)).map((ch) => parseInt(ch, 16) || 0);
  let x = 0;
  return (
    <svg className="bu-barcode" viewBox="0 0 300 34" aria-hidden>
      {bits.map((b, i) => { const w = 1 + (b % 4); const r = <rect key={i} x={x} y={0} width={w} height={34} />; x += w + 1 + ((b >> 2) % 3); return x < 300 ? r : null; })}
    </svg>
  );
}

export function Boletim({ b, escola, municipio, demo, turno = 1, onCand }: { b: BoletimSecao; escola?: string; municipio: string; demo: boolean; turno?: number; onCand?: (id: string) => void }) {
  if (b.status !== 'totalizada') {
    return (
      <div className="bu bu-wait">
        <div className="bu-head"><b>BOLETIM DE URNA</b><span>Zona {pad4(b.zona)} · Seção {pad4(b.secao)}</span></div>
        <p>{b.status === 'agregada' ? 'Esta seção foi agregada a outra: seus votos estão no boletim da seção principal.' : b.status === 'erro' ? 'Não foi possível ler o arquivo do boletim desta seção.' : 'O boletim desta seção ainda não foi publicado. Ele aparece aqui assim que a urna for totalizada.'}</p>
      </div>
    );
  }
  const falt = Math.max(0, b.aptos - b.comparecimento);
  return (
    <article className={`bu ${demo ? 'bu-demo' : ''}`} aria-label={`Boletim de urna da zona ${b.zona}, seção ${b.secao}`}>
      {demo && <div className="bu-marca" aria-hidden>SIMULAÇÃO</div>}
      <div className="bu-head">
        <b>BOLETIM DE URNA</b>
        <span>Eleições Gerais 2026 · {turno}º turno · {data(b.emissao)}</span>
      </div>
      <dl className="bu-id">
        <div><dt>Município</dt><dd>{b.mu} · {titleCase(municipio)}</dd></div>
        <div><dt>Zona</dt><dd className="num">{pad4(b.zona)}</dd></div>
        <div><dt>Local</dt><dd className="num">{b.local ?? '—'}</dd></div>
        <div><dt>Seção</dt><dd className="num">{pad4(b.secao)}</dd></div>
        {escola && <div className="wide"><dt>Local de votação</dt><dd>{titleCase(escola)}</dd></div>}
      </dl>
      <div className="bu-comp">
        <div><span>Eleitores aptos</span><b className="num">{fmtInt(b.aptos)}</b></div>
        <div><span>Compareceram</span><b className="num">{fmtInt(b.comparecimento)}</b><small className="num">{b.aptos ? fmtPct((b.comparecimento / b.aptos) * 100, 1) : ''}</small></div>
        <div><span>Faltaram</span><b className="num">{fmtInt(falt)}</b></div>
        {b.biometria !== null && <div><span>Biometria</span><b className="num">{fmtInt(b.biometria)}</b></div>}
      </div>
      {b.cargos.map((c) => <CargoBloco key={c.codigo} c={c} onCand={onCand} />)}
      <footer className="bu-foot">
        <div className="bu-meta">
          <span>Abertura <b className="num">{hora(b.abertura)}</b></span>
          <span>Encerramento <b className="num">{hora(b.encerramento)}</b></span>
          <span>Emissão <b className="num">{hora(b.emissao)}</b></span>
          {b.urna && <span>Urna nº <b className="num">{b.urna.numeroInterno ? fmtInt(b.urna.numeroInterno) : '—'}</b> · {b.urna.tipo}</span>}
          {b.urna?.versao && <span>Software <b>{b.urna.versao}</b></span>}
          {b.urna?.codigoCarga && <span className="mono">Carga {b.urna.codigoCarga}</span>}
          {b.hash && <span className="mono">Arquivo {b.arquivo} · hash {b.hash}</span>}
        </div>
        <Barras seed={b.hash ?? `${b.zona}${b.secao}`} />
        <p className="bu-fonte">{demo ? 'Boletim simulado (dados fictícios).' : 'Lido do arquivo oficial do boletim de urna (.bu, ASN.1) publicado pela Justiça Eleitoral.'}</p>
      </footer>
    </article>
  );
}
