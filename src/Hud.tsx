/**
 * Maqueta del HUD de la visera (fase de ejecución). La posición y el consumo son SIMULADOS: Marte no tiene GPS y esto es una demostración.
 * Diseño: alto contraste, botones grandes, riesgo con forma + color, información por capas (solo las 3 alertas más prioritarias).
 */
import { A } from './engine/assumptions';
import { Budget, Scenario, elapsedAt } from './engine/budget';
import { haversine } from './engine/analysis';
import { slopeAt } from './engine/planning';
import type { Candidate, Grid, LL, Stop } from './engine/planning';

export interface HudAlert { pri: 1 | 2 | 3; text: string }
export interface HudData { arrived: boolean; target: string; distM: number; relDeg: number; plannedH: number; realH: number; waterPlanned: number; waterReal: number; alerts: HudAlert[]; progressPct: number }

const brg = (a: LL, b: LL) => { const dy = b.lat - a.lat, dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180); return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; };

export function computeHud(c: Candidate, stops: Stop[], q: number, bud: Budget, sc: Scenario, pace: number, grid: Grid | null): HudData {
  const n = stops.length, last = c.path.length - 1, pos = c.path[Math.min(q, last)], arrived = q >= c.stopIdx[n];
  let i = 1; while (i < n && c.stopIdx[i] <= q) i++;
  const name = i < n ? stops[i].name : 'Base (regreso)', tgt = (i < n ? stops[i].at : stops[0].at) ?? pos;
  const heading = brg(pos, c.path[Math.min(last, q + 8)]), rel = ((brg(pos, tgt) - heading + 540) % 360) - 180;
  const vmid = (bud.kmhMin + bud.kmhMax) / 2, plannedH = elapsedAt(c, q, vmid), realH = plannedH * pace;
  const wp = A.waterRateLh.value * plannedH, wr = A.waterRateLh.value * realH;
  const alerts: HudAlert[] = [], back = c.backM[Math.min(q, last)] / 1000;
  const retMaxH = back / bud.kmhMin, margin = A.suitHours.value - elapsedAt(c, q, bud.kmhMin) * pace - retMaxH, reserveH = A.suitHours.value * (A.reservePct.value / 100);
  if (sc.spaceAlert) alerts.push({ pri: 1, text: `ALERTA CLIMA ESPACIAL: volver a la Base. Retorno ≈ ${retMaxH.toFixed(1)} h${retMaxH > A.alertReturnH.value ? ` (supera ${A.alertReturnH.value} h)` : ''}` });
  if (margin < 0) alerts.push({ pri: 1, text: `Sin margen para volver: faltan ${(-margin).toFixed(1)} h` });
  else if (margin < reserveH) alerts.push({ pri: 2, text: `Margen de retorno bajo: ${margin.toFixed(1)} h` });
  if (grid) { let mx = 0; for (let k = q; k <= Math.min(last, q + 15); k++) { const s = slopeAt(grid, c.path[k]); if (Number.isFinite(s)) mx = Math.max(mx, s); } if (mx > A.slopeCaution.value) alerts.push({ pri: 2, text: `Pendiente adelante hasta ${mx.toFixed(0)}°` }); }
  if (pace > 1.15) alerts.push({ pri: 2, text: `Ritmo ${Math.round((pace - 1) * 100)} % más lento que lo planeado` });
  if (wr > A.waterCapL.value * (1 - A.reservePct.value / 100)) alerts.push({ pri: 2, text: `Agua usada ${wr.toFixed(2)} L: dentro de la reserva` });
  if (sc.dust === 'alto') alerts.push({ pri: 3, text: 'Polvo alto: visibilidad reducida' });
  alerts.sort((a, b) => a.pri - b.pri);
  return { arrived, target: name, distM: haversine(pos, tgt), relDeg: rel, plannedH, realH, waterPlanned: wp, waterReal: wr, alerts: alerts.slice(0, 3), progressPct: (100 * q) / Math.max(1, last) };
}

const SYM = { 1: '▲', 2: '◆', 3: '●' } as const;
interface Props { d: HudData; onNextStop: () => void; onContingency: () => void; onClose: () => void }
export function Hud({ d, onNextStop, onContingency, onClose }: Props) {
  const over = d.realH > d.plannedH * 1.05;
  const buzz = () => { try { navigator.vibrate?.(d.alerts[0]?.pri === 1 ? [300, 100, 300] : 150); } catch { /* sin vibración */ } };
  return <div className="hud" role="region" aria-label="HUD de ejecución (maqueta)">
    <div className="hud-top"><b>HUD · MAQUETA</b><span>posición y consumo SIMULADOS</span><button onClick={onClose} title="Cerrar el HUD" aria-label="Cerrar HUD">✕</button></div>
    {d.arrived ? <div className="hud-nav"><span className="hud-big">✔ En la Base</span></div> : <div className="hud-nav">
      <div className="arrow" style={{ transform: `rotate(${d.relDeg}deg)` }} aria-label={`Rumbo relativo ${d.relDeg.toFixed(0)} grados`}>▲</div>
      <div><div className="hud-sm">Siguiente</div><div className="hud-big">{d.target}</div><div className="hud-dist">{d.distM >= 1000 ? `${(d.distM / 1000).toFixed(2)} km` : `${d.distM.toFixed(0)} m`}</div></div></div>}
    <div className="hud-bars">
      <div><small>Tiempo real / planeado</small><b className={over ? 'bad' : ''}>{d.realH.toFixed(1)} h / {d.plannedH.toFixed(1)} h {over ? '▲' : '●'}</b></div>
      <div><small>Agua usada / planeada</small><b>{d.waterReal.toFixed(2)} L / {d.waterPlanned.toFixed(2)} L</b></div>
      <div className="bar"><i style={{ width: `${d.progressPct}%` }} /></div></div>
    <ul className="hud-alerts">{d.alerts.length ? d.alerts.map((a, i) => <li key={i} className={'p' + a.pri}><span>{SYM[a.pri]}</span>{a.text}</li>) : <li className="p3"><span>●</span>Sin alertas</li>}</ul>
    <div className="hud-btns">
      <button title="Saltar la posición simulada hasta la siguiente parada del circuito" onClick={onNextStop}>Siguiente parada<small>voz: «parada»</small></button>
      <button title="Calcular el regreso a la Base desde aquí y dibujarlo en el mapa" className="danger" onClick={onContingency}>Contingencia: volver<small>voz: «retorno»</small></button>
      <button title="Probar la vibración del dispositivo (maqueta de las alertas hápticas)" onClick={buzz}>Probar vibración<small>voz: «alerta»</small></button></div>
    <p className="hud-note">Control por voz y señales de audio/vibración: solo maqueta (no hay reconocimiento de voz). Las frases son las que se pretende soportar.</p>
  </div>;
}
