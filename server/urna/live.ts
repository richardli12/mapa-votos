// Apuração por seção a partir dos arquivos oficiais de urna (área "arquivo-urna" da divulgação):
//   config/<uf>/<uf>-p<pleito>-cs        EA16 — municípios → zonas → seções
//   dados/<uf>/<mu>/<zona>/<seção>/p<pleito>-<uf>-m<mu>-z<zona>-s<seção>-aux   índice dos arquivos da urna
//   dados/<uf>/<mu>/<zona>/<seção>/<hash>/<arquivo>.bu   boletim de urna (ASN.1)
import { num } from '../../shared/format.ts';
import type { CargoId } from '../../shared/types.ts';
import type { BoletimSecao, SecaoResumo, SecaoStatus, UrnaEstrutura, UrnaZona } from '../../shared/urnas.ts';
import type { LiveProvider } from '../tse/live.ts';
import { decodeBU, type BoletimUrna } from './bu.ts';
import { Progressive } from './progressive.ts';
import type { UrnasProvider } from './provider.ts';
import { agregarPorLocal, boletimCompleto, resumir } from './resumo.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;
const pad = (s: string | number, n: number) => String(s).padStart(n, '0');

interface SecaoCarregada { bu: BoletimUrna | null; st: SecaoStatus; hash?: string; arquivo?: string; at: number }

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

  constructor(private p: LiveProvider, env = process.env) {
    this.progressive = new Progressive(Number(env.AGORA_CONCURRENCY ?? 6), 45_000, Number(env.AGORA_MAP_WAIT_MS ?? 4000));
    this.maxMunicipio = Number(env.URNA_MAX_SECOES ?? 1200);
  }

  private async ctx(round: number) {
    const ctx = await this.p.context();
    return { ctx, r: this.p.roundCtx(ctx, round) };
  }

  async estrutura(uf: string, mu: string, round: number): Promise<UrnaEstrutura> {
    const { ctx, r } = await this.ctx(round);
    const base = `${this.p.dir(ctx, 'cs', '', uf, r.pleito)}/${uf}-p${pad(r.pleito, 6)}-cs`;
    const got = await this.p.getAny([`${base}.jws`, `${base}.json`], 3_600_000);
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
    if (hit && (hit.bu || Date.now() - hit.at < 40_000)) return hit;
    const { ctx, r } = await this.ctx(round);
    const dir = this.p.dir(ctx, 'aux', '', uf, r.pleito, { municipio: mu, zona: pad(z, 4), secao: pad(s, 4) });
    const file = `p${pad(r.pleito, 6)}-${uf}-m${mu}-z${pad(z, 4)}-s${pad(s, 4)}-aux`;
    let out: SecaoCarregada = { bu: null, st: 'aguardando', at: Date.now() };
    try {
      const aux = (await this.p.getAny([`${dir}/${file}.jws`, `${dir}/${file}.json`], 30_000)).value as Raw;
      const urna = escolherUrna(aux);
      if (urna) {
        const bytes = await this.p.up.getBinary(`${dir}/${urna.hash}/${urna.arquivo}`);
        if (bytes) {
          try { out = { bu: decodeBU(bytes), st: 'totalizada', hash: urna.hash, arquivo: urna.arquivo, at: Date.now() }; } catch { out = { bu: null, st: 'erro', at: Date.now() }; }
        }
      }
    } catch { /* índice da seção ainda não publicado */ }
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
    const src = this.p.up.sources[0].kind;
    return { cargo, uf, mu, zona, secoes: [...secoes, ...agregadas], pending, total: items.length, source: src };
  }

  async locais(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], round: number) {
    const s = await this.secoes(cargo, uf, mu, zona, focus, round);
    return { cargo, uf, mu, zona, locais: agregarPorLocal(s.secoes, focus), pending: s.pending, total: s.total, source: s.source };
  }

  async boletim(uf: string, mu: string, zona: number, secao: number, round: number): Promise<BoletimSecao> {
    const c = await this.carregar(round, uf, mu, zona, secao);
    const src = this.p.up.sources[0].kind;
    if (!c.bu) {
      return { uf, mu, zona, secao, local: null, status: c.st, fase: '', aptos: 0, comparecimento: 0, emissao: null, abertura: null, encerramento: null, urna: null, biometria: null, liberadosCodigo: null, apuracaoSA: false, cargos: [], source: src };
    }
    return boletimCompleto(c.bu, uf, mu, zona, secao, src, new Map(), { hash: c.hash, arquivo: c.arquivo });
  }
}
