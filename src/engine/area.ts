/**
 * Zona de planeación. Sustituye al antiguo DTM local (HiRISE): ya no hace falta ningún archivo ni preparación previa.
 * El relieve de la zona sale de MOLA, el mismo dato que dibuja el terreno 3D, así que la app funciona en cualquier
 * punto de Marte sin configurar nada.
 *
 * AVISO IMPORTANTE, y la app lo repite en pantalla: MOLA tiene ≈ 650 m por píxel. Las pendientes y la rugosidad salen
 * de interpolar ese dato, así que describen la forma general del terreno, NO los obstáculos de una caminata
 * (rocas, zanjas, taludes de pocos metros). Las rutas son trazados orientativos, no un plan de EVA verificado.
 */
import { loadRect } from './elevation';

export interface Bounds { west: number; south: number; east: number; north: number }
/** Resolución real del dato de elevación (MOLA ClrShade de Trek, ≈ 463 m/px, filtrado: ≈ 650 m efectivos). */
export const MOLA_RES_M = 650;
/** Tamaño de celda de la rejilla de planeación. Más fino que el dato solo interpolaría: no se inventa detalle. */
export const PLAN_CELL_M = 150;
const R = 3396190, rad = Math.PI / 180;

/** Rectángulo que cubre todas las paradas fijadas, con margen (para que la ruta pueda rodear obstáculos). */
export function boundsOf(pts: { lon: number; lat: number }[], marginM = 2000): Bounds | null {
  if (!pts.length) return null;
  const lons = pts.map(p => p.lon), lats = pts.map(p => p.lat), midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / (rad * R), dLon = marginM / (rad * R * Math.max(0.05, Math.cos(midLat * rad)));
  return { west: Math.min(...lons) - dLon, south: Math.min(...lats) - dLat, east: Math.max(...lons) + dLon, north: Math.max(...lats) + dLat };
}
/** Descarga las teselas MOLA que cubren la zona (hasta que estén, muestrear daría la rejilla gruesa). */
export const prepareArea = (b: Bounds) => loadRect(b.west, b.south, b.east, b.north);

export type AreaState =
  | { status: 'none' }                                   // faltan paradas por fijar
  | { status: 'loading' }
  | { status: 'ready'; b: Bounds; cellM: number; w: number; h: number };
