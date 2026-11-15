import { A } from './assumptions';
import { MARS } from './config';
import { elevationAt } from './elevation';

export interface WP { lon: number; lat: number }
/**
 * Modo de desplazamiento. opHours = horas operativas por sol; shield = factor de blindaje contra radiación;
 * maxSlope = pendiente máxima (°) que admite; crewed = lleva tripulación (si no, no hay O₂, dosis ni cabina).
 */
export interface Vehicle { id: string; name: string; kmh: number; opHours: number; shield: number; foot: boolean; crewed: boolean; maxSlope: number }
export const VEHICLES: Vehicle[] = [
  { id: 'vehicle', name: 'En vehículo (rover presurizado)', kmh: 10, opHours: 10, shield: 0.5, foot: false, crewed: true, maxSlope: 20 },
  { id: 'foot', name: 'A pie (EVA)', kmh: 3, opHours: 6, shield: 1, foot: true, crewed: true, maxSlope: 20 },
  { id: 'robot', name: 'Rover robótico (sin tripulación)', kmh: 0.14, opHours: 6, shield: 1, foot: false, crewed: false, maxSlope: 25 },
];
const R = MARS.a, rad = Math.PI / 180;

export const haversine = (a: WP, b: WP) => {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Modelos simplificados (NO son datos medidos): presión barométrica, temperatura por latitud/altura/hora. */
export const pressurePa = (h: number) => 636 * Math.exp(-h / 11100);
export const tempK = (lat: number, h: number, day: boolean) =>
  (day ? 255 : 185) - 0.35 * Math.abs(lat) - 2.5 * (h / 1000) + (day ? 0 : -0.1 * Math.abs(lat));
/**
 * Dosis diaria en superficie por rayos cósmicos galácticos. Mismo método que el mapa de NASA de 2002 (PIA03480):
 * la atmósfera es el único escudo, así que la dosis depende de la masa de aire encima, es decir de la altura.
 *  - Anclada en los 0.64 mSv/día que midió RAD (Curiosity) en Gale, a −4.4 km sobre el datum.
 *  - Techo = dosis sin atmósfera encima, tomada de la razón entre lo que midió MARIE en órbita (0.25 mGy/día)
 *    y lo que midió RAD en superficie (0.21 mGy/día): un 19 % más. El blindaje atmosférico de Marte es modesto.
 * No incluye eventos de partículas solares, que son el riesgo real y no dependen de la altura de esta forma.
 */
const GALE_H = -4400, ORBIT_RATIO = 0.25 / 0.21;
export const radiationMsvDay = (h: number) => {
  const surf = A.doseDayMsv.value, orbit = surf * ORBIT_RATIO;
  return orbit - (orbit - surf) * (pressurePa(h) / pressurePa(GALE_H));
};
export const windMs = (lat: number, h: number) => 6 + 0.04 * Math.abs(lat) + Math.max(0, h) / 4000;
export const o2PartialPa = (h: number) => pressurePa(h) * 0.0013; // 0.13 % de O₂ en la atmósfera marciana

export type Risk = 'Bajo' | 'Medio' | 'Alto' | 'Crítico';
/** Umbral a partir del cual la app NO deja crear la ruta sin confirmación explícita. */
export const BLOCK_SCORE = 80;
export type Level = 'major' | 'medium' | 'minor';
export interface Hazard { level: Level; title: string; detail: string; pts: number }
const levelOf = (pts: number): Level => (pts >= 15 ? 'major' : pts >= 7 ? 'medium' : 'minor');

export interface Analysis {
  km: number; hours: number; sols: number; kmPerSol: number; ascent: number; descent: number; minH: number; maxH: number;
  /** Pendiente máxima / media entre muestras de la ruta (°). NaN si no hay elevación suficiente. Es aproximada: depende del espaciado de muestreo. */
  maxSlope: number; avgSlope: number; terrain: string;
  /** Fracción (0–1) de los puntos de la ruta con elevación disponible. Si < 1, los datos de relieve son parciales. */
  elevCoverage: number;
  risk: Risk; riskScore: number; hazards: Hazard[]; climate: string;
  tempDay: number; tempNight: number; pressure: number; o2Pa: number; wind: number; dustRisk: Risk; radiation: number; dose: number;
  o2Kg: number; profile: { d: number; h: number }[];
}

/** Espera `p` como máximo `ms`; si falla o tarda más, devuelve `fb` (así una tesela caída no deja el panel vacío para siempre). */
const withTimeout = <T,>(p: Promise<T>, ms: number, fb: T) => new Promise<T>(res => {
  const t = setTimeout(() => res(fb), ms);
  p.then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fb); });
});
/** Altura (m) desde MOLA. NaN si no se pudo obtener. */
async function heightAt(lon: number, lat: number): Promise<number> {
  const m = await withTimeout(elevationAt(lon, lat), 15000, NaN);
  return Number.isFinite(m) ? m : NaN;
}

/** Nunca rechaza por falta de elevación: calcula todo lo que no la necesita y marca `elevCoverage`. */
export async function analyze(wps: WP[], v: Vehicle, crew: number): Promise<Analysis | null> {
  if (wps.length < 2) return null;
  const pts: { p: WP; d: number }[] = []; let dist = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1], seg = haversine(a, b), n = Math.max(2, Math.ceil(seg / 20000));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n; pts.push({ p: { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }, d: dist + seg * t });
    }
    dist += seg;
  }
  const hs = await Promise.all(pts.map(q => heightAt(q.p.lon, q.p.lat)));
  const okH = hs.filter(Number.isFinite), coverage = okH.length / hs.length;
  let asc = 0, desc = 0, maxS = 0, sumS = 0, nS = 0;
  for (let i = 1; i < hs.length; i++) {
    if (!Number.isFinite(hs[i]) || !Number.isFinite(hs[i - 1])) continue;
    const dh = hs[i] - hs[i - 1], dd = pts[i].d - pts[i - 1].d;
    dh > 0 ? (asc += dh) : (desc -= dh);
    if (dd > 0) { const s = Math.abs(Math.atan2(dh, dd)) / rad; maxS = Math.max(maxS, s); sumS += s; nS++; }
  }
  const avgS = nS ? sumS / nS : NaN, haveS = nS > 0;
  const mid = pts[Math.floor(pts.length / 2)].p;
  const minH = okH.length ? Math.min(...okH) : 0, maxH = okH.length ? Math.max(...okH) : 0, mh = okH.length ? okH.reduce((a, b) => a + b, 0) / okH.length : 0;

  // Velocidad y tiempo dependen SOLO del modo elegido
  const km = dist / 1000, hours = km / v.kmh, sols = Math.max(1, Math.ceil(hours / v.opHours));
  const tempDay = tempK(mid.lat, mh, true) - 273.15, tempNight = tempK(mid.lat, mh, false) - 273.15;
  const wind = windMs(mid.lat, mh), radiation = radiationMsvDay(mh), dose = radiation * sols * v.shield;
  const dust: Risk = mid.lat < 0 && mh < 2000 ? 'Alto' : mh < 4000 ? 'Medio' : 'Bajo';

  // Peligros: cada uno aporta puntos (0-100 en total); el nivel sale de sus puntos
  const hz: Hazard[] = [];
  const add = (pts: number, title: string, detail: string) => { pts = Math.round(pts); if (pts > 0) hz.push({ level: levelOf(pts), title, detail, pts }); };
  if (v.foot) {
    if (km > 10) add(Math.min(35, 8 + (km - 10) * 0.4), 'Distancia de regreso a pie', `${km.toFixed(0)} km superan el límite de ~10 km de regreso a pie hasta un hábitat o rover (walk-back).`);
    if (sols > 1) add(Math.min(15, sols * 2), 'Campamento / múltiples EVA', `${sols} jornadas EVA de ~${v.opHours} h; hace falta refugio y reposición de soporte vital entre jornadas.`);
    if (tempDay < -50) add(8, 'Frío extremo en el traje', `Temperatura diurna ~${tempDay.toFixed(0)} °C: alto consumo de energía de calefacción del traje.`);
    if (wind > 12) add(4, 'Viento', `Viento estimado ~${wind.toFixed(0)} m/s que dificulta el avance y levanta polvo.`);
  } else if (v.crewed) {
    if (km > 20) add(Math.min(25, km / 20), 'Distancia de rescate', `${km.toFixed(0)} km: una avería lejos de la base dificulta el rescate.`);
    if (sols > 14) add(Math.min(25, (sols - 14) * 1.5), 'Consumibles del rover', `${sols} sols de viaje superan la autonomía asumida de 14 sols de consumibles.`);
    if (crew > 4) add(8, 'Capacidad de la cabina', `${crew} tripulantes exceden la capacidad asumida de 4 del rover presurizado.`);
  } else {
    if (sols > 200) add(Math.min(25, (sols - 200) / 20), 'Duración de la misión robótica', `${sols} sols de conducción: desgaste y degradación de energía del rover.`);
  }
  if (haveS && maxS > v.maxSlope) add(Math.min(20, 8 + (maxS - v.maxSlope)), 'Pendiente máxima', `${maxS.toFixed(0)}° entre muestras supera el límite de ${v.maxSlope}° del modo elegido (estimada con muestreo grueso).`);
  if (tempNight < -90) add(v.foot ? 10 : 4, 'Frío nocturno', `Noche ~${tempNight.toFixed(0)} °C${v.foot ? ': riesgo si se pernocta a la intemperie.' : ': exige calefacción continua del vehículo.'}`);
  if (dust === 'Alto') add(v.foot ? 10 : 6, 'Tormentas de polvo', 'Región con alta probabilidad de tormentas (modelo estacional simplificado).');
  else if (dust === 'Medio') add(v.foot ? 5 : 3, 'Polvo en suspensión', 'Probabilidad moderada de polvo: visibilidad y desgaste del equipo.');
  if (v.crewed && dose >= 1) add(Math.min(15, dose * 1.5), 'Radiación acumulada', `Dosis estimada ${dose.toFixed(1)} mSv en la ruta (${v.foot ? 'sin blindaje' : 'con blindaje del rover'}).`);
  if (Math.abs(mid.lat) > 60) add(10, 'Latitud alta', 'Temperaturas extremas y posible hielo de CO₂ en la superficie.');
  if (maxH > 12000) add(6, 'Gran altitud', `Hasta ${(maxH / 1000).toFixed(1)} km sobre el datum: menor presión y mayor radiación.`);
  hz.sort((a, b) => b.pts - a.pts);

  const score = Math.min(100, hz.reduce((s, h) => s + h.pts, 0));
  const risk: Risk = score < 25 ? 'Bajo' : score < 50 ? 'Medio' : score < BLOCK_SCORE ? 'Alto' : 'Crítico';
  return {
    km, hours, sols, kmPerSol: v.kmh * v.opHours, ascent: asc, descent: desc, minH, maxH,
    maxSlope: haveS ? maxS : NaN, avgSlope: avgS,
    terrain: !haveS ? 'Sin datos de elevación' : avgS < 3 ? 'Llanura / regolito suelto' : avgS < 8 ? 'Ondulado / campos de rocas' : avgS < 15 ? 'Accidentado / cráteres' : 'Montañoso / escarpado',
    elevCoverage: coverage, risk, riskScore: score, hazards: hz,
    climate: mid.lat > 50 || mid.lat < -50 ? 'Polar frío' : Math.abs(mid.lat) < 20 ? 'Ecuatorial árido' : 'Templado frío',
    tempDay, tempNight, pressure: pressurePa(mh), o2Pa: o2PartialPa(mh), wind, dustRisk: dust, radiation, dose,
    o2Kg: v.crewed ? 0.84 * crew * sols * 1.3 : 0, // 0.84 kg/persona/día + 30 % margen
    profile: pts.map((q, i) => ({ d: q.d / 1000, h: hs[i] })).filter(p => Number.isFinite(p.h)),
  };
}
