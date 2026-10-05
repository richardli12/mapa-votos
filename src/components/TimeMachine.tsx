import { useEffect } from 'react';

/** Máquina do tempo da simulação: arraste para reviver a noite da apuração (viradas incluídas). */
export function TimeMachine({ t, setT, playing, setPlaying }: { t?: number; setT: (t?: number) => void; playing: boolean; setPlaying: (p: boolean) => void }) {
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setT(Math.min(1, (t ?? 0) + 0.006));
      if ((t ?? 0) >= 1) setPlaying(false);
    }, 450);
    return () => window.clearInterval(id);
  }, [playing, t, setT, setPlaying]);

  const live = t === undefined;
  return (
    <div className="timemachine" role="group" aria-label="Máquina do tempo da apuração (simulação)">
      <button className="tm-play" onClick={() => { if (live || (t ?? 0) >= 1) setT(0); setPlaying(!playing); }} aria-label={playing ? 'Pausar' : 'Reproduzir a apuração'}>{playing ? '❚❚' : '▶'}</button>
      <div className="tm-body">
        <div className="tm-top">
          <b>Máquina do tempo</b>
          <span>{live ? 'acompanhando o relógio da simulação' : `momento da apuração: ${Math.round((t ?? 0) * 100)}%`}</span>
        </div>
        <input type="range" min={0} max={1000} value={Math.round((t ?? 0.5) * 1000)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }} aria-label="Momento da apuração" />
      </div>
      <button className={`tm-live ${live ? 'on' : ''}`} onClick={() => { setPlaying(false); setT(undefined); }}><i className="dot" />Relógio</button>
    </div>
  );
}
