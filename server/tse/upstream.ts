// Cliente das fontes de dados ao vivo.
// Ordem padrão: API Brasil Paralelo (espelho dos arquivos de divulgação) → TSE oficial.
// Aceita JSON puro ou JWS assinado (formato oficial 2026), com verificação Ed25519 da chave pública do TSE.
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { SourceKind } from '../../shared/types.ts';

export interface SourceDef { kind: SourceKind; base: string; label: string }

export function sourcesFromEnv(env = process.env): SourceDef[] {
  const bp = (env.BP_API_URL ?? 'https://apuracao-api.brasilparalelo.com.br').replace(/\/$/, '');
  const tse = (env.TSE_URL ?? 'https://resultados.tse.jus.br').replace(/\/$/, '');
  const order = (env.AGORA_SOURCES ?? 'bp,tse').split(',').map((s) => s.trim()).filter(Boolean);
  const all: Record<string, SourceDef> = {
    bp: { kind: 'bp', base: bp, label: 'API Brasil Paralelo' },
    tse: { kind: 'tse', base: tse, label: 'TSE — Justiça Eleitoral' },
  };
  return order.map((k) => all[k]).filter(Boolean);
}

// Chave pública de verificação publicada pelo TSE (manual de verificação JWS, Apêndice B, 2026).
const TSE_KEY = { kty: 'OKP', crv: 'Ed25519', x: 'kWlpNHjuws1csyQZwzn3Fhzbi3RD435RbpThtSr4hMc' };
const TSE_KID = 'sNbt9Q_fLS65zE1_ZLNV-XRRwPY';
let key: KeyObject | null = null;
try { key = createPublicKey({ key: TSE_KEY, format: 'jwk' }); } catch { key = null; }

export interface Decoded { value: unknown; verified: boolean | null }

export function decodePayload(text: string): Decoded {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return { value: JSON.parse(t), verified: null };
  const parts = t.split('.');
  if (parts.length !== 3) throw new Error('Conteúdo não é JSON nem JWS.');
  const value = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  let verified = false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    verified = !!key && header.alg === 'EdDSA' && header.kid === TSE_KID &&
      verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch { verified = false; }
  return { value, verified };
}

export class UpstreamError extends Error {
  constructor(public status: number, public path: string) { super(`Fonte respondeu HTTP ${status} para ${path}`); }
}

interface Entry { value: unknown; verified: boolean | null; source: SourceKind; expires: number; etag?: string | null; modified?: string | null; sourceIndex: number }

export interface Fetched { value: unknown; verified: boolean | null; source: SourceKind }

export class Upstream {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Fetched>>();
  private cooldown = new Map<string, { until: number; status: number }>();
  private sourceDown = new Map<number, number>();
  private active = 0;
  private queue: (() => void)[] = [];
  private strict: boolean;

  constructor(public sources: SourceDef[], private concurrency = 6, env = process.env) {
    this.strict = env.STRICT_SIGNATURE === '1';
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    else this.active++;
    try { return await fn(); } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    }
  }

  /** Busca um caminho (ex.: /oficial/ele2026/6257/dados/br/br-c0001-e006257-u.jws) com cache e fallback entre fontes. */
  get(path: string, ttlMs = 15_000): Promise<Fetched> {
    const hit = this.cache.get(path);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit);
    const cool = this.cooldown.get(path);
    if (cool && cool.until > Date.now()) {
      if (hit) return Promise.resolve(hit);
      return Promise.reject(new UpstreamError(cool.status, path));
    }
    const pending = this.inflight.get(path);
    if (pending) return pending;
    const task = this.slot(() => this.fetchAll(path, ttlMs, hit)).finally(() => this.inflight.delete(path));
    this.inflight.set(path, task);
    return task;
  }

  private async fetchAll(path: string, ttlMs: number, hit?: Entry): Promise<Fetched> {
    let lastStatus = 0;
    for (let i = 0; i < this.sources.length; i++) {
      const down = this.sourceDown.get(i);
      if (down && down > Date.now() && i < this.sources.length - 1) continue;
      const src = this.sources[i];
      try {
        const headers: Record<string, string> = { Accept: 'application/json, application/jose, text/plain, */*', 'User-Agent': 'agora26/1.0' };
        if (hit && hit.sourceIndex === i) {
          if (hit.etag) headers['If-None-Match'] = hit.etag;
          if (hit.modified) headers['If-Modified-Since'] = hit.modified;
        }
        const res = await fetch(src.base + path, { headers, signal: AbortSignal.timeout(10_000) });
        if (res.status === 304 && hit) { hit.expires = Date.now() + ttlMs; return hit; }
        if (!res.ok) {
          lastStatus = res.status;
          if (res.status >= 500 || res.status === 403 || res.status === 429) this.sourceDown.set(i, Date.now() + 60_000);
          continue;
        }
        const decoded = decodePayload(await res.text());
        if (this.strict && src.kind === 'tse' && decoded.verified === false) throw new Error('Assinatura TSE inválida.');
        const entry: Entry = { ...decoded, source: src.kind, expires: Date.now() + ttlMs, etag: res.headers.get('etag'), modified: res.headers.get('last-modified'), sourceIndex: i };
        this.cache.set(path, entry);
        if (this.cache.size > 4000) this.cache.delete(this.cache.keys().next().value!);
        this.cooldown.delete(path);
        return entry;
      } catch {
        this.sourceDown.set(i, Date.now() + 30_000);
      }
    }
    // Evita martelar arquivos ausentes ou estender bloqueios temporários da fonte.
    const wait = lastStatus === 404 ? 45_000 : lastStatus === 403 || lastStatus === 429 ? 600_000 : 10_000;
    this.cooldown.set(path, { until: Date.now() + wait, status: lastStatus || 502 });
    if (hit) return hit; // último dado válido preservado
    throw new UpstreamError(lastStatus || 502, path);
  }
}
