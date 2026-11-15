/**
 * Nivel de confianza por zona. Regla del documento: mayor cerca de la traza de Perseverance (mediciones directas) y menor lejos.
 *  - Necesita public/jezero/traverse.json  → { "source": "…", "points": [[lon, lat], …] }  (traza real del rover; NO se inventa).
 *  - Sin ese archivo la confianza por distancia es «sin traza» (no verificable), nunca «alta».
 *  - Las celdas de la rejilla sin pendiente calculable son «sin dato».
 * Aviso permanente: las rocas < ~1 m no se distinguen con certeza desde la órbita, ni siquiera con confianza alta.
 */
import { A } from './assumptions';
import { slopeAt } from './planning';
import type { Candidate, Grid, LL } from './planning';

export interface Trace { source: string; points: LL[] }
let trace: Trace | null = null;
export const traceInfo = () => trace;
export async function initTrace(base = '/jezero'): Promise<Trace | null> {
  try {
    const r = await fetch(`${base}/traverse.json`); if (!r.ok) return null;
    const j = (await r.json()) as { source?: string; points?: [number, number][] };
    if (!Array.isArray(j.points) || j.points.length < 2) return null;
    trace = { source: j.source ?? '(sin fuente indicada)', points: j.points.map(([lon, lat]) => ({ lon, lat })) }; return trace;
  } catch { return null; }
}

export type ConfLevel = 'alta' | 'media' | 'baja' | 'sin traza' | 'sin dato';
export const CONF: Record<ConfLevel, { sym: string; label: string }> = {
  alta: { sym: '■', label: 'Alta' }, media: { sym: '◆', label: 'Media' }, baja: { sym: '▲', label: 'Baja' }, 'sin traza': { sym: '○', label: 'No verificable (falta la traza)' }, 'sin dato': { sym: '✕', label: 'Sin dato de terreno' },
};
const R = 3396190, rad = Math.PI / 180;
export function distToTrace(p: LL): number | undefined {
  if (!trace) return undefined;
  const kx = rad * R * Math.cos(p.lat * rad), ky = rad * R, pts = trace.points; let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i].lon - p.lon) * kx, ay = (pts[i].lat - p.lat) * ky, bx = (pts[i + 1].lon - p.lon) * kx, by = (pts[i + 1].lat - p.lat) * ky, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0; best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
export function confidenceAt(p: LL, g: Grid | null): { level: ConfLevel; distM?: number } {
  if (g && !Number.isFinite(slopeAt(g, p))) return { level: 'sin dato' };
  const d = distToTrace(p); if (d === undefined) return { level: 'sin traza' };
  return { level: d <= A.confHighM.value ? 'alta' : d <= A.confMidM.value ? 'media' : 'baja', distM: d };
}
/** % de la ruta en cada nivel (muestreo de ~150 puntos). */
export function routeConfidence(c: Candidate, g: Grid | null): Record<ConfLevel, number> {
  const out: Record<ConfLevel, number> = { alta: 0, media: 0, baja: 0, 'sin traza': 0, 'sin dato': 0 }, step = Math.max(1, Math.floor(c.path.length / 150)); let n = 0;
  for (let i = 0; i < c.path.length; i += step) { out[confidenceAt(c.path[i], g).level]++; n++; }
  (Object.keys(out) as ConfLevel[]).forEach(k => (out[k] = (100 * out[k]) / Math.max(1, n))); return out;
}
