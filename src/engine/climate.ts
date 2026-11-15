/**
 * Temperatura del suelo a lo largo del sol.
 *  - Si existe public/jezero/meda_hourly.json (24 valores en °C, uno por hora solar local, de MEDA) se usa ese dato.
 *  - Si no, se dibuja una curva MODELADA que solo une los dos extremos citados por NASA (−83 °C antes del amanecer,
 *    5 °C al mediodía) con una forma suave. Las horas de mínimo y máximo son un supuesto. NO es la curva medida.
 * El ajuste por inercia térmica del terreno no está implementado: no hay datos de inercia por celda.
 */
import { A } from './assumptions';

export interface MedaHourly { source: string; date?: string; hours: number[] }
let meda: MedaHourly | null = null;
export const medaInfo = () => meda;
export const isModeled = () => meda === null;

export async function initMeda(base = '/jezero'): Promise<MedaHourly | null> {
  try {
    const r = await fetch(`${base}/meda_hourly.json`); if (!r.ok) return null;
    const j = (await r.json()) as MedaHourly;
    if (Array.isArray(j.hours) && j.hours.length === 24 && j.hours.every(Number.isFinite)) meda = j;
    return meda;
  } catch { return null; }
}

export function groundTemp(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (meda) { const i = Math.floor(h), f = h - i; return meda.hours[i] * (1 - f) + meda.hours[(i + 1) % 24] * f; }
  const lo = A.groundMin.value, hi = A.groundMax.value, t0 = A.tMinHour.value, up = (A.tMaxHour.value - t0 + 24) % 24, down = 24 - up, dt = (h - t0 + 24) % 24;
  return dt <= up ? lo + ((hi - lo) * (1 - Math.cos((Math.PI * dt) / up))) / 2 : hi - ((hi - lo) * (1 - Math.cos((Math.PI * (dt - up)) / down))) / 2;
}
export const curve = (step = 0.5) => Array.from({ length: Math.round(24 / step) + 1 }, (_, i) => ({ h: i * step, t: groundTemp(i * step) }));

export interface WinStats { start: number; durH: number; meanC: number; minC: number }
export function windowStats(start: number, durH: number): WinStats {
  let sum = 0, n = 0, mn = Infinity;
  for (let t = 0; t <= durH + 1e-9; t += 0.25) { const v = groundTemp(start + t); sum += v; n++; mn = Math.min(mn, v); }
  return { start, durH, meanC: sum / n, minC: mn };
}
/** Hora de inicio que maximiza la temperatura media del suelo durante `durH` (las horas menos frías). */
export function bestWindow(durH: number): WinStats {
  let best = windowStats(0, durH);
  for (let s = 0.5; s < 24; s += 0.5) { const w = windowStats(s, durH); if (w.meanC > best.meanC) best = w; }
  return best;
}
export const hourLabel = (h: number) => { const x = ((h % 24) + 24) % 24, hh = Math.floor(x), mm = Math.round((x - hh) * 60); return `${String(mm === 60 ? hh + 1 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`; };
