/** Worker: ejecuta el pipeline de filtros del relieve fuera del hilo principal (ver relaxPool.ts). */
import { relax } from './filters';

interface Msg { id: number; g: Float32Array; W: number }
const ctx = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
ctx.onmessage = e => {
  const { id, g, W } = e.data, r = relax(g, W);
  ctx.postMessage({ id, r }, [r.buffer as ArrayBuffer]);
};
