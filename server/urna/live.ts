// Apuração por seção a partir dos arquivos oficiais de urna (área "arquivo-urna" da divulgação):
//   config/<uf>/<uf>-p<pleito>-cs        EA16 — municípios → zonas → seções
//   dados/<uf>/<mu>/<zona>/<seção>/p<pleito>-<uf>-m<mu>-z<zona>-s<seção>-aux   índice dos arquivos da urna
//   dados/<uf>/<mu>/<zona>/<seção>/<hash>/<arquivo>.bu   boletim de urna (ASN.1)
import { num } from '../../shared/format.ts';
import type { CargoId } from '../../shared/types.ts';
import type { BoletimSecao, SecaoResumo, SecaoStatus, UrnaEstrutura, UrnaZona } from '../../shared/urnas.ts';
import type { LiveProvider } from '../tse/live.ts';
import { BROWSER_UA, Upstream, UpstreamError, type Fetched } from '../tse/upstream.ts';
import { decodeBU, type BoletimUrna } from './bu.ts';
import { Progressive } from './progressive.ts';
import type { UrnasProvider } from './provider.ts';
import { agregarPorLocal, boletimCompleto, resumir } from './resumo.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;
const pad = (s: string | number, n: number) => String(s).padStart(n, '0');

interface SecaoCarregada { bu: BoletimUrna | null; st: SecaoStatus; hash?: string; arquivo?: string; at: number }

const ehBU = (b: Uint8Array) => { try { decodeBU(b); return true; } catch { return false; } };
function motivoDe(e: unknown): string {
  if (e instanceof UpstreamError) {
    if (e.status === 403 || e.status === 429) return `o servidor do TSE recusou o acesso (HTTP ${e.status}) — muitas consultas seguidas ou bloqueio do provedor`;
    if (e.status === 422) return 'a fonte respondeu algo que não é o índice da urna';
    return `a fonte respondeu HTTP ${e.status}`;
  }
  return (e as Error)?.message || 'falha de rede';
}

/** Escolhe, no índice da seção, a urna válida mais recente que tenha boletim. */
export function escolherUrna(aux: Raw): { hash: string; arquivo: string } | null {
  const hashes: Raw[] = Array.isArray(aux?.hashes) ? aux.hashes : [];
  const validas = hashes.filter((h) => h.hash && String(h.hash) !== '0' && !/exclu|anulad|cancel|substitu/i.test(String(h.st ?? h.ds ?? '')));
  for (const h of validas.reverse()) {
    const nomes: string[] = Array.isArray(h.arq) ? h.arq.map((a: Raw) => String(a.nm ?? a)) : Array.isArray(h.nmarq) ? h.nmarq.map(String) : [];
    const bu = nomes.find((n) => /\.bu$/i.test(n)) ?? nomes.find((n) => /\.busa$/i.test(n));
    if (bu) return { hash: String(h.hash), arquivo: bu };
  }
  return null;
}

export class LiveUrnas implements UrnasProvider {
  private secoesCache = new Map<string, SecaoCarregada>();
  private progressive: Progressive<SecaoCarregada>;
  private maxMunicipio: number;
  /** Arquivos de urna saem direto do TSE (a "arquivo-urna" é publicada só por ele); espelhos ficam de reserva. */
  readonly up: Upstream;
  /** extensão que a fonte está usando (.jws assinado ou .json), aprendida na primeira resposta */
  private ext: Record<'cs' | 'aux', string[]> = { cs: ['jws', 'json'], aux: ['jws', 'json'] };
  private ultimaFalha: { motivo: string; at: number } | null = null;

  constructor(private p: LiveProvider, env = process.env) {
    const conc = Number(env.URNA_CONCURRENCY ?? 12);
    // mesmas fontes do provedor ao vivo, reordenadas (padrão: TSE primeiro)
    const ordem = (env.URNA_SOURCES ?? 'tse,bp').split(',').map((x) => x.trim());
    const rank = (k: string) => (ordem.indexOf(k) + 100) % 100;
    this.up = new Upstream([...p.up.sources].sort((a, b) => rank(a.kind) - rank(b.kind)), conc, env);
    this.progressive = new Progressive(conc, 15_000, Number(env.AGORA_MAP_WAIT_MS ?? 4000));
    this.maxMunicipio = Number(env.URNA_MAX_SECOES ?? 1200);
  }

  /** Busca `<base>.jws` ou `<base>.json`, aceitando só conteúdo que passe em `ok`. Erros 404 perdem para os demais. */
  private async arquivo(kind: 'cs' | 'aux', base: string, ttl: number, ok: (v: Raw) => boolean): Promise<Fetched> {
    const order = this.ext[kind];
    let err: unknown;
    for (const e of order) {
      try {
        const got = await this.up.get(`${base}.${e}`, ttl, (v) => !!v && typeof v === 'object' && ok(v as Raw));
        if (order[0] !== e) this.ext[kind] = [e, ...order.filter((x) => x !== e)];
        return got;
      } catch (x) {
        if (!err || (err instanceof UpstreamError && err.status === 404)) err = x;
      }
    }
    throw err;
  }

  private falhou(motivo: string) { this.ultimaFalha = { motivo, at: Date.now() }; }
  private aviso(): string | undefined {
    return this.ultimaFalha && Date.now() - this.ultimaFalha.at < 120_000 ? this.ultimaFalha.motivo : undefined;
  }

  private async ctx(round: number) {
    const ctx = await this.p.context();
    return { ctx, r: this.p.roundCtx(ctx, round) };
  }

  async estrutura(uf: string, mu: string, round: number): Promise<UrnaEstrutura> {
    const { ctx, r } = await this.ctx(round);
    const base = `${this.p.dir(ctx, 'cs', '', uf, r.pleito)}/${uf}-p${pad(r.pleito, 6)}-cs`;
    const got = await this.arquivo('cs', base, 3_600_000, (v) => Array.isArray(v.abr));
    const raw = got.value as Raw;
    const abr: Raw = (raw.abr ?? []).find((a: Raw) => String(a.cd).toLowerCase() === uf) ?? raw.abr?.[0];
    const m: Raw | undefined = (abr?.mu ?? []).find((x: Raw) => pad(x.cd, 5) === mu);
    if (!m) throw new Error('Município não encontrado na configuração de seções do TSE.');
    const zonas: UrnaZona[] = (m.zon ?? []).map((z: Raw) => ({
      zona: num(z.cd),
      secoes: (z.sec ?? []).map((s: Raw) => {
        const ns = num(s.ns), nsp = s.nsp !== undefined ? num(s.nsp) : ns;
        const local = s.nl ?? s.lv ?? s.loc ?? s.local;
        return { s: ns, ...(nsp && nsp !== ns ? { principal: nsp } : {}), ...(local !== undefined ? { local: num(local) } : {}) };
      }),
    })).sort((a: UrnaZona, b: UrnaZona) => a.zona - b.zona);
    const total = zonas.reduce((s, z) => s + z.secoes.length, 0);
    return { uf, mu, nome: String(m.nm ?? mu), zonas, locais: null, totalSecoes: total, municipioInteiro: total <= this.maxMunicipio, source: got.source };
  }

  private async carregar(round: number, uf: string, mu: string, z: number, s: number): Promise<SecaoCarregada> {
    const key = `${round}:${uf}:${mu}:${z}:${s}`;
    const hit = this.secoesCache.get(key);
    if (hit && (hit.bu || Date.now() - hit.at < (hit.st === 'erro' ? 8_000 : 30_000))) return hit;
    const { ctx, r } = await this.ctx(round);
    const dir = this.p.dir(ctx, 'aux', '', uf, r.pleito, { municipio: mu, zona: pad(z, 4), secao: pad(s, 4) });
    const file = `p${pad(r.pleito, 6)}-${uf}-m${mu}-z${pad(z, 4)}-s${pad(s, 4)}-aux`;
    let out: SecaoCarregada = { bu: null, st: 'aguardando', at: Date.now() };
    try {
      const aux = (await this.arquivo('aux', `${dir}/${file}`, 30_000, (v) => Array.isArray(v.hashes))).value as Raw;
      const urna = escolherUrna(aux);
      if (urna) {
        const bytes = await this.up.getBinary(`${dir}/${urna.hash}/${urna.arquivo}`, ehBU);
        if (bytes) out = { bu: decodeBU(bytes), st: 'totalizada', hash: urna.hash, arquivo: urna.arquivo, at: Date.now() };
        else { out = { bu: null, st: 'erro', at: Date.now() }; this.falhou('o arquivo do boletim (.bu) não pôde ser baixado'); }
      }
    } catch (e) {
      // 404: índice da seção ainda não publicado (aguardando). Qualquer outra coisa é falha de acesso.
      if (!(e instanceof UpstreamError && e.status === 404)) { out = { bu: null, st: 'erro', at: Date.now() }; this.falhou(motivoDe(e)); }
    }
    this.secoesCache.set(key, out);
    if (this.secoesCache.size > 8000) this.secoesCache.delete(this.secoesCache.keys().next().value!);
    return out;
  }

  async secoes(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], round: number) {
    const est = await this.estrutura(uf, mu, round);
    if (zona === null && !est.municipioInteiro) throw new Error(`Este município tem ${est.totalSecoes} seções — escolha uma zona eleitoral.`);
    const zonas = est.zonas.filter((z) => zona === null || z.zona === zona);
    if (!zonas.length) throw new Error('Zona eleitoral não encontrada neste município.');
    const items: string[] = [];
    const agregadas: SecaoResumo[] = [];
    for (const z of zonas) for (const s of z.secoes) {
      if (s.principal) agregadas.push(resumir(null, z.zona, s.s, cargo, uf, new Set(), 'agregada', s.local ?? null));
      else items.push(`${z.zona}:${s.s}`);
    }
    const { done, pending } = await this.progressive.get(`${round}:${uf}:${mu}:${zona ?? 'todas'}`, items, (k) => {
      const [z, s] = k.split(':').map(Number);
      return this.carregar(round, uf, mu, z, s);
    });
    const fset = new Set(focus);
    const secoes = items.map((k) => {
      const [z, s] = k.split(':').map(Number);
      const c = done.get(k);
      return resumir(c?.bu ?? null, z, s, cargo, uf, fset, c?.st ?? 'aguardando');
    });
    const src = this.up.sources[0].kind;
    const falhas = secoes.filter((x) => x.st === 'erro').length;
    return { cargo, uf, mu, zona, secoes: [...secoes, ...agregadas], pending, total: items.length, source: src, ...(falhas ? { falhas, aviso: this.aviso() } : {}) };
  }

  async locais(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], round: number) {
    const s = await this.secoes(cargo, uf, mu, zona, focus, round);
    return { cargo, uf, mu, zona, locais: agregarPorLocal(s.secoes, focus), pending: s.pending, total: s.total, source: s.source, ...(s.falhas ? { falhas: s.falhas, aviso: s.aviso } : {}) };
  }

  /** Passo a passo de uma seção, consultando cada fonte sem cache — para descobrir por que um boletim não aparece. */
  async diagnostico(uf: string, mu: string, zona: number, secao: number, round: number) {
    const passos: { etapa: string; url: string; status: number | string; bytes?: number; nota?: string }[] = [];
    const bruto = async (etapa: string, path: string) => {
      for (const src of this.up.sources) {
        const url = src.base + path;
        try {
          const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' }, signal: AbortSignal.timeout(10_000) });
          const b = new Uint8Array(await res.arrayBuffer());
          passos.push({ etapa, url, status: res.status, bytes: b.length, nota: res.ok ? new TextDecoder().decode(b.subarray(0, 160)).replace(/[\x00-\x08\x0e-\x1f\x7f]+/g, '·') : undefined });
          if (res.ok) return b;
        } catch (e) { passos.push({ etapa, url, status: (e as Error).message }); }
      }
      return null;
    };
    let ctx;
    try { ctx = await this.ctx(round); } catch (e) { return { ok: false, erro: `configuração oficial (ele-c) indisponível: ${(e as Error).message}`, passos }; }
    const { r } = ctx;
    const cs = `${this.p.dir(ctx.ctx, 'cs', '', uf, r.pleito)}/${uf}-p${pad(r.pleito, 6)}-cs`;
    for (const e of ['jws', 'json']) if (await bruto('configuração de seções', `${cs}.${e}`)) break;
    const dir = this.p.dir(ctx.ctx, 'aux', '', uf, r.pleito, { municipio: mu, zona: pad(zona, 4), secao: pad(secao, 4) });
    const file = `p${pad(r.pleito, 6)}-${uf}-m${mu}-z${pad(zona, 4)}-s${pad(secao, 4)}-aux`;
    let aux: Raw | null = null;
    for (const e of ['jws', 'json']) {
      const b = await bruto('índice da seção', `${dir}/${file}.${e}`);
      if (!b) continue;
      try { const t = new TextDecoder().decode(b).trim(); aux = t.startsWith('{') ? JSON.parse(t) : JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); } catch { passos.push({ etapa: 'índice da seção', url: `${dir}/${file}.${e}`, status: 'conteúdo ilegível' }); }
      if (aux) break;
    }
    const urna = aux ? escolherUrna(aux) : null;
    let bu: string | null = null;
    if (urna) {
      const b = await bruto('boletim de urna', `${dir}/${urna.hash}/${urna.arquivo}`);
      if (b) { try { const d = decodeBU(b); bu = `ok: zona ${d.zona}, seção ${d.secao}, ${d.eleicoes.reduce((s, x) => s + x.cargos.length, 0)} cargos`; } catch (e) { bu = `ilegível: ${(e as Error).message}`; } }
    }
    return { ok: !!bu?.startsWith('ok'), pleito: r.pleito, fontes: this.up.sources.map((x) => x.base), indice: aux ? { hashes: (aux.hashes ?? []).length, urna } : null, boletim: bu, ultimaFalha: this.ultimaFalha, passos };
  }

  async boletim(uf: string, mu: string, zona: number, secao: number, round: number): Promise<BoletimSecao> {
    const c = await this.carregar(round, uf, mu, zona, secao);
    const src = this.up.sources[0].kind;
    if (!c.bu) {
      return { uf, mu, zona, secao, local: null, status: c.st, fase: '', aptos: 0, comparecimento: 0, emissao: null, abertura: null, encerramento: null, urna: null, biometria: null, liberadosCodigo: null, apuracaoSA: false, cargos: [], source: src };
    }
    return boletimCompleto(c.bu, uf, mu, zona, secao, src, new Map(), { hash: c.hash, arquivo: c.arquivo });
  }
}
