// Mantém trabalho em segundo plano vivo depois da resposta, quando a plataforma permite.
// Na Vercel, o runtime Node expõe `waitUntil` no contexto da requisição (o mesmo usado por @vercel/functions);
// no servidor local o processo já continua vivo e isto não faz nada.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CTX = Symbol.for('@vercel/request-context');

export function emSegundoPlano(p: Promise<unknown>): void {
  try {
    const ctx = (globalThis as any)[CTX]?.get?.();
    ctx?.waitUntil?.(p.catch(() => undefined));
  } catch { /* sem suporte: segue normalmente */ }
}
