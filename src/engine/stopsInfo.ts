/**
 * Fichas de las paradas. El texto científico sale del documento Mars Route Guide (fuentes allí citadas).
 * Los nombres de las paradas son informales del equipo de la misión, no nombres oficiales.
 * Las imágenes en primera persona (Mastcam-Z / SuperCam) NO vienen incluidas: se cargan desde
 *   public/jezero/stops/<id>/manifest.json  →  [{ "file": "img1.jpg", "caption": "…", "credit": "NASA/JPL-Caltech/ASU", "sol": 123, "instrument": "Mastcam-Z" }, …]
 * con los .jpg al lado. Sin manifest, la ficha dice que faltan imágenes.
 */
export interface StopInfo { science: string; source?: string }

/**
 * Posiciones precargadas de las paradas (lon este, lat planetocéntrica, grados).
 * Enchanted Lake, Hogwallow Flats y Skrinkle Haven = posición REAL de Perseverance en los soles en que trabajó allí,
 * tomada del archivo oficial de waypoints de la misión (NASA/JPL MMGIS: mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json).
 * Es dónde estuvo el rover, no el centro geométrico del afloramiento (que está a decenas de metros).
 * Kodiak no tiene waypoint (el rover nunca subió): su posición se DERIVA de dos distancias publicadas y es aproximada (±200 m).
 */
export const STOP_POS: Record<string, { at: { lon: number; lat: number }; src: string }> = {
  kodiak: { at: { lon: 77.4045, lat: 18.4410 }, src: 'Aproximada (±200 m): 2.6 km al oeste del aterrizaje de Perseverance (AAPG) y ~1 km al SSE del frente del delta (Caravaca et al. 2024, JGR Planets). Verifícala sobre HiRISE.' },
  enchanted: { at: { lon: 77.40144, lat: 18.45050 }, src: 'Perseverance en Enchanted Lake, sol 421 (M20_waypoints.json, NASA/JPL).' },
  hogwallow: { at: { lon: 77.40610, lat: 18.45886 }, src: 'Perseverance en Hogwallow Flats, sol 474 (M20_waypoints.json, NASA/JPL).' },
  skrinkle: { at: { lon: 77.38982, lat: 18.47444 }, src: 'Perseverance en Skrinkle Haven, soles 721–727 (M20_waypoints.json, NASA/JPL).' },
};
export const STOP_INFO: Record<string, StopInfo> = {
  base: { science: 'Punto de salida y de regreso. El documento la sitúa en el suelo del cráter, cerca del frente del delta, porque Kodiak queda a 2.6 km al oeste de la zona de aterrizaje de Perseverance. Three Forks (depósito de muestras planeado por Perseverance) es un candidato; no hay coordenadas cargadas: fíjala tú y verifícala.', source: 'AAPG; NASA NTRS 20230000588' },
  kodiak: { science: 'Remanente aislado del delta occidental (mesa de ~150 m de ancho y ~20 m de alto) cuyos afloramientos muestran sus unidades estratigráficas.', source: 'Documento Mars Route Guide; Mastcam-Z (ASU)' },
  enchanted: { science: 'Capas finas de los depósitos más bajos del delta y contacto con el suelo del cráter.', source: 'Documento Mars Route Guide' },
  hogwallow: { science: 'Rocas de grano muy fino con sulfato, de mayor interés astrobiológico.', source: 'Documento Mars Route Guide' },
  skrinkle: { science: 'Parada opcional en la parte alta del delta: da una ruta más ambiciosa. El documento no detalla su aporte científico.', source: 'Documento Mars Route Guide' },
};
export interface StopImage { file: string; caption: string; credit: string; sol?: number; instrument?: string }
export async function loadStopImages(id: string, base = '/jezero/stops'): Promise<StopImage[]> {
  try { const r = await fetch(`${base}/${id}/manifest.json`); if (!r.ok) return []; const j = (await r.json()) as StopImage[]; return Array.isArray(j) ? j.filter(x => x && x.file) : []; } catch { return []; }
}
export const stopImageUrl = (id: string, file: string) => `/jezero/stops/${id}/${file}`;
