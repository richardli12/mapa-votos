import { useEffect, useState } from 'react';
import type { UrnaLocal } from '../../shared/urnas';

/** Locais de votação com nome/endereço/coordenadas gerados no build a partir dos dados abertos do TSE (opcional). */
export function useLocaisEstaticos(uf?: string, mu?: string, ativo = true): UrnaLocal[] | null {
  const [state, setState] = useState<{ key: string; data: UrnaLocal[] | null }>({ key: '', data: null });
  const key = `${uf}/${mu}`;
  useEffect(() => {
    if (!uf || !mu || !ativo) return;
    let alive = true;
    fetch(`/locais/${uf}/${mu}.json`).then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null)).catch(() => null)
      .then((d) => { if (alive) setState({ key, data: Array.isArray(d) ? d : null }); });
    return () => { alive = false; };
  }, [key, ativo]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state.data : null;
}
