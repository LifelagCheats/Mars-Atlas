/**
 * Presupuesto de la salida: una ruta solo se aprueba si cabe. Todo se muestra como RANGO y con reserva.
 * Las cifras marcadas "supuesto" en assumptions.ts no tienen fuente; las "referencia" sí (se citan en la nota).
 */
import { A } from './assumptions';
import { windowStats } from './climate';
import type { Candidate, Stop } from './planning';

export interface Scenario { startHour: number; astronauts: number; rover: boolean; loaded: boolean; dust: 'bajo' | 'moderado' | 'alto'; spaceAlert: boolean; roughPref: boolean }
export const DEFAULT_SCENARIO: Scenario = { startHour: 9, astronauts: 2, rover: false, loaded: true, dust: 'bajo', spaceAlert: false, roughPref: false };

/** Paquete de misión: al aprobar, recorrido, paradas, tiempos y presupuesto quedan fijados. */
export interface Plan { approvedAt: string; cand: Candidate; sc: Scenario; stops: Stop[] }
/** Posición simulada del astronauta (Marte no tiene GPS; en la demostración se simula). */
export interface Sim { on: boolean; q: number; playing: boolean; pace: number }

export type Verdict = 'ok' | 'warn' | 'fail' | 'info';
export interface Line { id: string; label: string; value: string; limit: string; verdict: Verdict; note: string }
export interface Budget {
  lines: Line[]; ok: boolean; failed: string[]; kmhMin: number; kmhMax: number; hoursMin: number; hoursMax: number; usableH: number;
  doseMin: number; doseMax: number; winMeanC: number; winMinC: number; maxBackM: number;
}
const hh = (a: number, b: number) => `${a.toFixed(1)}–${b.toFixed(1)} h`;
export const VERDICT_SYM: Record<Verdict, string> = { ok: '●', warn: '◆', fail: '▲', info: '○' }; // forma + color
export const VERDICT_TXT: Record<Verdict, string> = { ok: 'Cabe', warn: 'Justo', fail: 'No cabe', info: 'Informativo' };

export const speedFactor = (sc: Scenario) => (sc.loaded ? A.loadFactor.value : 1);

export function evaluate(c: Candidate, sc: Scenario): Budget {
  const f = speedFactor(sc), kmhMin = A.speedMin.value * f, kmhMax = A.speedMax.value * f, km = c.lengthM / 1000, stopH = c.nStops * A.stopMin.value / 60;
  const hoursMin = km / kmhMax + stopH, hoursMax = km / kmhMin + stopH, res = A.reservePct.value / 100, usableH = A.suitHours.value * (1 - res);
  const maxBackM = Math.max(0, ...c.backM.filter(Number.isFinite)), backMinH = maxBackM / 1000 / kmhMax, backMaxH = maxBackM / 1000 / kmhMin, roverH = maxBackM / 1000 / A.roverKmh.value;
  const lines: Line[] = [];
  const add = (id: string, label: string, value: string, limit: string, verdict: Verdict, note: string) => lines.push({ id, label, value, limit, verdict, note });

  add('dur', 'Duración total', hh(hoursMin, hoursMax), `≤ ${usableH.toFixed(1)} h (autonomía ${A.suitHours.value} h − reserva ${A.reservePct.value} %)`,
    hoursMax <= usableH ? 'ok' : hoursMin <= usableH ? 'warn' : 'fail',
    `Caminata ${km.toFixed(2)} km a ${kmhMin.toFixed(1)}–${kmhMax.toFixed(1)} km/h + ${c.nStops} paradas de ${A.stopMin.value} min. Autonomía del traje = supuesto (sin especificación citada); aún no se deriva del gasto metabólico.`);

  const wUse = A.waterRateLh.value * hoursMax, wCap = A.waterCapL.value, wUsable = wCap * (1 - res);
  add('water', 'Agua por astronauta', `hasta ${wUse.toFixed(2)} L`, `≤ ${wUsable.toFixed(1)} L (de ${wCap} L, reserva ${A.reservePct.value} %)`,
    wUse <= wUsable ? 'ok' : wUse <= wCap ? 'warn' : 'fail', `Grupo de ${sc.astronauts}: hasta ${(wUse * sc.astronauts).toFixed(1)} L en total. Consumo y capacidad = supuestos.`);

  const doseMin = (A.doseDayMsv.value * hoursMin) / 24, doseMax = (A.doseDayMsv.value * hoursMax) / 24;
  add('dose', 'Dosis de radiación estimada', `${doseMin.toFixed(2)}–${doseMax.toFixed(2)} mSv`, `≪ ${A.doseSpe.value} mSv por evento · ${A.doseCareer.value} mSv de carrera`,
    doseMax <= 0.05 * A.doseSpe.value ? 'ok' : doseMax <= 0.5 * A.doseSpe.value ? 'warn' : 'fail',
    `Referencia: ${A.doseDayMsv.value} mSv/día medidos por RAD en Gale (no en Jezero) × horas ÷ 24. Es dosis de fondo; el riesgo real es un evento de partículas solares.`);

  const backLimit = A.alertReturnH.value, backEff = sc.rover ? Math.min(backMaxH, roverH) : backMaxH;
  add('space', 'Alerta de clima espacial', sc.spaceAlert ? `retorno máx ≈ ${backEff.toFixed(1)} h` : 'sin alerta (escenario)', sc.spaceAlert ? `retorno máx ≤ ${backLimit} h desde cualquier punto` : '—',
    sc.spaceAlert ? (backEff <= backLimit ? 'ok' : 'fail') : 'info',
    sc.spaceAlert ? 'Escenario activado por el usuario: la app no tiene fuente de clima espacial en vivo. RAD observó un solo evento solar, y débil.' : 'La app no recibe clima espacial en vivo; actívalo como escenario para ver si el plan sobreviviría a una alerta.');

  const retLim = (A.returnFracPct.value / 100) * usableH;
  add('ret', 'Tiempo máximo de retorno a la Base', hh(backMinH, backMaxH), `≤ ${retLim.toFixed(1)} h (${A.returnFracPct.value} % de la autonomía útil)`,
    backMaxH <= retLim ? 'ok' : backMinH <= retLim ? 'warn' : 'fail',
    `Distancia de regreso del punto más lejano (${(maxBackM / 1000).toFixed(2)} km) ÷ velocidad de caminata. Métrica de diseño propia, no de NASA.${sc.rover ? ` Con rover de apoyo: ≈ ${roverH.toFixed(2)} h (a ${A.roverKmh.value} km/h, supuesto).` : ''}`);

  const w = windowStats(sc.startHour, hoursMax);
  add('temp', 'Temperatura del suelo en la ventana', `media ${w.meanC.toFixed(0)} °C · mín ${w.minC.toFixed(0)} °C`, 'límites térmicos del traje: pendientes de verificar', 'info',
    'Curva diaria del suelo (ver gráfica). No se aplica ajuste por inercia térmica del terreno. El aire es menos frío que el suelo al amanecer y más estable (media ≈ −55 °C).');

  add('dust', 'Polvo y viento (escenario)', sc.dust, 'remolinos de 5 a 135 m de diámetro (estimados en Jezero)', sc.dust === 'alto' ? 'warn' : 'info',
    'Sin datos de polvo por hora: se trata como escenario. Con polvo alto cae la visibilidad y hay que considerar viento.');

  add('grp', 'Grupo', `${sc.astronauts} astronauta${sc.astronauts === 1 ? '' : 's'} · ${sc.rover ? 'con' : 'sin'} rover de apoyo · equipo ${sc.loaded ? 'cargado' : 'ligero'}`, '—', 'info',
    sc.loaded ? `Con equipo cargado la velocidad se reduce ×${A.loadFactor.value} (supuesto).` : 'Sin factor de carga.');

  const failed = lines.filter(l => l.verdict === 'fail').map(l => l.label);
  return { lines, ok: failed.length === 0, failed, kmhMin, kmhMax, hoursMin, hoursMax, usableH, doseMin, doseMax, winMeanC: w.meanC, winMinC: w.minC, maxBackM };
}

/** Horas transcurridas al llegar al punto q del camino a velocidad kmh (caminata + paradas ya hechas). */
export function elapsedAt(c: Candidate, q: number, kmh: number): number {
  let stops = 0; for (let i = 1; i <= c.nStops; i++) if (c.stopIdx[i] <= q) stops++;
  return c.cumM[Math.min(q, c.cumM.length - 1)] / 1000 / kmh + (stops * A.stopMin.value) / 60;
}

export interface Contingency { returnM: number; returnMinH: number; returnMaxH: number; elapsedH: number; remainingH: number; marginH: number; verdict: Verdict; roverH?: number }
/** Imprevisto en el punto q: se recalcula con los recursos que quedan y se prioriza regresar a la Base. */
export function contingency(c: Candidate, q: number, sc: Scenario, returnM: number, pace = 1): Contingency {
  const f = speedFactor(sc), kmhMin = A.speedMin.value * f, kmhMax = A.speedMax.value * f, elapsedH = elapsedAt(c, q, kmhMin) * pace, remainingH = A.suitHours.value - elapsedH;
  const returnMinH = returnM / 1000 / kmhMax, returnMaxH = returnM / 1000 / kmhMin, roverH = sc.rover ? returnM / 1000 / A.roverKmh.value : undefined, need = roverH !== undefined ? Math.min(returnMaxH, roverH) : returnMaxH;
  const marginH = remainingH - need, verdict: Verdict = marginH >= A.suitHours.value * (A.reservePct.value / 100) ? 'ok' : marginH >= 0 ? 'warn' : 'fail';
  return { returnM, returnMinH, returnMaxH, elapsedH, remainingH, marginH, verdict, roverH };
}
