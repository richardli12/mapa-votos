// Decodificador do Boletim de Urna (arquivo .bu) — ASN.1 BER com tags implícitas,
// conforme a especificação oficial do TSE (ModuloBU, bu.asn1). Sem dependências.
//
// O arquivo .bu é um EntidadeEnvelopeGenerico cujo campo `conteudo` (OCTET STRING)
// contém a EntidadeBoletimUrna com os votos de todos os cargos da seção.

interface Node { tag: number; constructed: boolean; cls: number; start: number; end: number; children?: Node[] }

function readNode(buf: Uint8Array, pos: number): Node {
  if (pos >= buf.length) throw new Error('BU truncado.');
  const first = buf[pos++];
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) { // tag de vários bytes
    tag = 0;
    let b: number;
    do { b = buf[pos++]; tag = (tag << 7) | (b & 0x7f); } while (b & 0x80);
  }
  let len = buf[pos++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('Comprimento BER não suportado.');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++];
  }
  const end = pos + len;
  if (end > buf.length) throw new Error('BU truncado.');
  const node: Node = { tag, constructed, cls, start: pos, end };
  if (constructed) {
    node.children = [];
    let p = pos;
    while (p < end) { const c = readNode(buf, p); node.children.push(c); p = c.end; }
  }
  return node;
}

const UNIV = 0, CTX = 2;
const T = { INTEGER: 2, OCTET: 4, ENUM: 10, SEQ: 16, GENSTR: 27 };

function int(buf: Uint8Array, n: Node): number {
  let v = 0;
  const neg = buf[n.start] & 0x80;
  for (let i = n.start; i < n.end; i++) v = v * 256 + buf[i];
  if (neg) v -= 2 ** (8 * (n.end - n.start));
  return v;
}
const str = (buf: Uint8Array, n: Node) => new TextDecoder('latin1').decode(buf.subarray(n.start, n.end));
const hex = (buf: Uint8Array, n: Node) => Array.from(buf.subarray(n.start, n.end), (b) => b.toString(16).padStart(2, '0')).join('');
const kids = (n?: Node) => n?.children ?? [];
const find = (n: Node | undefined, cls: number, tag: number) => kids(n).find((c) => c.cls === cls && c.tag === tag);

export type TipoVoto = 'nominal' | 'branco' | 'nulo' | 'legenda' | 'semCandidato';
const TIPO_VOTO: Record<number, TipoVoto> = { 1: 'nominal', 2: 'branco', 3: 'nulo', 4: 'legenda', 5: 'semCandidato' };
const FASE: Record<number, string> = { 1: 'simulado', 2: 'oficial', 3: 'treinamento' };
const TIPO_URNA: Record<number, string> = { 1: 'seção', 3: 'contingência', 4: 'reserva de seção', 6: 'reserva encerrando seção' };
const TIPO_CARGO: Record<number, 'majoritario' | 'proporcional' | 'consulta'> = { 1: 'majoritario', 2: 'proporcional', 3: 'consulta' };

export interface VotoBU { tipo: TipoVoto; qtd: number; partido?: number; numero?: number }
export interface CargoBU { codigo: number; livre: boolean; tipo: 'majoritario' | 'proporcional' | 'consulta'; comparecimento: number; ordem: number; votos: VotoBU[] }
export interface EleicaoBU { idEleicao: number; aptos: number; cargos: CargoBU[] }
export interface BoletimUrna {
  fase: string;
  municipio: number; zona: number; local: number; secao: number;
  emissao: string | null; abertura: string | null; encerramento: string | null;
  tipoUrna: string; versao: string | null; numeroInterno: number | null; codigoCarga: string | null; serieFlash: string | null;
  apuracaoSA: boolean;
  liberadosCodigo: number | null; biometria: number | null;
  eleicoes: EleicaoBU[];
}

/** "20261004T170843" → "2026-10-04T17:08:43" (horário local da urna). */
export function dataHoraJE(s: string | null): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

export function decodeBU(input: Uint8Array): BoletimUrna {
  const env = readNode(input, 0);
  if (!env.constructed) throw new Error('Arquivo não é um envelope de BU.');
  const conteudo = [...kids(env)].reverse().find((c) => c.cls === UNIV && c.tag === T.OCTET);
  if (!conteudo) throw new Error('Envelope sem conteúdo.');
  const buf = input.subarray(conteudo.start, conteudo.end);
  const bu = readNode(buf, 0);
  const c = kids(bu);
  // posições fixas da EntidadeBoletimUrna: cabecalho, fase, urna, identificacaoSecao, dataHoraEmissao, dadosSecaoSA
  const fase = c[1] && c[1].tag === T.ENUM ? FASE[int(buf, c[1])] ?? '?' : '?';
  const urna = c[2];
  const ident = c[3];
  const mz = kids(ident)[0];
  const emissao = c[4] && c[4].tag === T.GENSTR ? str(buf, c[4]) : null;
  const dadosSecaoSA = c[5];
  let abertura: string | null = null, encerramento: string | null = null;
  const apuracaoSA = dadosSecaoSA?.cls === CTX && dadosSecaoSA.tag === 1;
  if (dadosSecaoSA?.cls === CTX && dadosSecaoSA.tag === 0) {
    const d = kids(dadosSecaoSA);
    abertura = d[0] ? str(buf, d[0]) : null;
    encerramento = d[1] ? str(buf, d[1]) : null;
  }
  const u = kids(urna);
  const carga = kids(u[2]).find((x) => x.cls === UNIV && x.tag === T.SEQ);
  const cg = kids(carga);
  const lib = find(bu, CTX, 1), bio = find(bu, CTX, 2);
  const eleicoes: EleicaoBU[] = kids(find(bu, CTX, 3)).map((rpe) => {
    const r = kids(rpe);
    return {
      idEleicao: int(buf, r[0]),
      aptos: int(buf, r[1]),
      cargos: kids(r[2]).flatMap((rv) => {
        const v = kids(rv);
        const tipo = TIPO_CARGO[int(buf, v[0])] ?? 'majoritario';
        const comparecimento = int(buf, v[1]);
        return kids(v[2]).map((tvc) => {
          const t = kids(tvc);
          const cod = t[0]; // CHOICE: [1] cargoConstitucional | [2] numeroCargoConsultaLivre
          const votos = kids(t[2]).map((tvv) => {
            const tipoV = TIPO_VOTO[int(buf, find(tvv, CTX, 1)!)] ?? 'nulo';
            const qtd = int(buf, find(tvv, CTX, 2)!);
            const idv = find(tvv, CTX, 3);
            const iv = kids(idv);
            return idv ? { tipo: tipoV, qtd, partido: int(buf, iv[0]), numero: int(buf, iv[1]) } : { tipo: tipoV, qtd };
          });
          return { codigo: int(buf, cod), livre: cod.tag === 2, tipo, comparecimento, ordem: t[1] ? int(buf, t[1]) : 0, votos } satisfies CargoBU;
        });
      }),
    };
  });
  return {
    fase,
    municipio: mz ? int(buf, kids(mz)[0]) : 0, zona: mz ? int(buf, kids(mz)[1]) : 0,
    local: kids(ident)[1] ? int(buf, kids(ident)[1]) : 0, secao: kids(ident)[2] ? int(buf, kids(ident)[2]) : 0,
    emissao: dataHoraJE(emissao), abertura: dataHoraJE(abertura), encerramento: dataHoraJE(encerramento),
    tipoUrna: u[0] ? TIPO_URNA[int(buf, u[0])] ?? 'outra' : '?',
    versao: u[1] && u[1].tag === T.GENSTR ? str(buf, u[1]) : null,
    numeroInterno: cg[0] ? int(buf, cg[0]) : null,
    serieFlash: cg[1] ? hex(buf, cg[1]) : null,
    codigoCarga: cg[3] ? str(buf, cg[3]) : null,
    apuracaoSA,
    liberadosCodigo: lib ? int(buf, lib) : null,
    biometria: bio ? int(buf, bio) : null,
    eleicoes,
  };
}
