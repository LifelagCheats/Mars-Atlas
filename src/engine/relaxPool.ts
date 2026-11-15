/**
 * Pool pequeño de Web Workers para `relax` (mediana + gaussianas + talud sobre ~113 000 muestras por tesela).
 * En el hilo principal cada tesela bloqueaba ~100-200 ms; así la cámara y la interfaz siguen fluidas.
 * Cola LIFO con un trabajo por worker: lo último que se pidió (lo que la cámara está mirando AHORA) se procesa primero,
 * en vez de esperar detrás de teselas por las que la cámara ya pasó.
 * Si los workers no se pueden crear/cargar, se cae al cálculo síncrono (misma salida, solo más lento).
 */
import { relax } from './filters';

interface Job { id: number; g: Float32Array; W: number; res: (r: Float32Array) => void }
const queue: Job[] = [];
const running = new Map<number, Job>();
let workers: Worker[] | null | undefined, idle: Worker[] = [], nextId = 1;

function fallback() {
  workers?.forEach(w => w.terminate()); workers = null; idle = [];
  const pend = [...running.values(), ...queue]; running.clear(); queue.length = 0;
  pend.forEach(j => j.res(relax(j.g, j.W)));
}
function pump() {
  while (idle.length && queue.length) {
    const w = idle.pop()!, j = queue.pop()!; // LIFO
    running.set(j.id, j);
    w.postMessage({ id: j.id, g: j.g, W: j.W }); // se copia (no se transfiere) para poder reintentar en síncrono
  }
}
function init(): Worker[] | null {
  if (workers !== undefined) return workers;
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    workers = Array.from({ length: n }, () => {
      const w = new Worker(new URL('./relax.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; r: Float32Array }>) => {
        const j = running.get(e.data.id); if (j) { running.delete(e.data.id); j.res(e.data.r); }
        idle.push(w); pump();
      };
      w.onerror = () => fallback();
      return w;
    });
    idle = [...workers];
  } catch { workers = null; }
  return workers;
}

export function relaxAsync(g: Float32Array, W: number): Promise<Float32Array> {
  return new Promise(res => {
    const pool = init();
    if (!pool) { res(relax(g, W)); return; }
    queue.push({ id: nextId++, g, W, res }); pump();
  });
}
