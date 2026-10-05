import { useCallback, useRef, useState } from 'react';

/** Largura real do elemento — gráficos desenhados em pixels reais, sem esticar texto.
 *  Ref por callback: volta a medir quando o elemento é trocado (ex.: estado vazio → gráfico). */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const [w, setW] = useState(initial);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  return [ref, w] as const;
}
