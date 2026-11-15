import { memo, useEffect, useMemo, useState } from 'react';
import { A } from './engine/assumptions';
import { haversine } from './engine/analysis';
import { Budget, Contingency, Plan, Scenario, Sim, VERDICT_SYM, VERDICT_TXT, evaluate } from './engine/budget';
import { bestWindow, curve, hourLabel, isModeled, medaInfo } from './engine/climate';
import { CONF, ConfLevel, confidenceAt, routeConfidence, traceInfo } from './engine/confidence';
import { AreaState, MOLA_RES_M } from './engine/area';
import type { Candidate, Grid, Stop } from './engine/planning';
import { STOP_INFO, STOP_POS, StopImage, loadStopImages, stopImageUrl } from './engine/stopsInfo';

const band = (r: number) => (r < 25 ? { sym: '●', txt: 'Bajo', cls: 'lo' } : r < 50 ? { sym: '◆', txt: 'Medio', cls: 'mid' } : { sym: '▲', txt: 'Alto', cls: 'hi' }); // forma + color, no solo color
const hh = (a: number, b: number) => `${a.toFixed(1)}–${b.toFixed(1)} h`;
const withPos = (s: Stop): Stop => { const p = STOP_POS[s.id]; return p ? { ...s, at: p.at, def: p.at, src: p.src } : s; };
export const INIT_STOPS: Stop[] = [
  { id: 'base', name: 'Base' }, { id: 'kodiak', name: 'Kodiak (cráter Jezero)' }, { id: 'enchanted', name: 'Enchanted Lake' }, { id: 'hogwallow', name: 'Hogwallow Flats' },
  { id: 'skrinkle', name: 'Skrinkle Haven (opcional)', optional: true },
].map(withPos);

export interface ContingencyView extends Contingency { path: { lon: number; lat: number }[] }
interface Props {
  area: AreaState; grid: Grid | null; stops: Stop[]; circuit: Stop[]; placing: string | null; setPlacing: (id: string | null) => void; clearStop: (id: string) => void;
  useSkrinkle: boolean; setUseSkrinkle: (b: boolean) => void; sc: Scenario; setSc: (s: Scenario) => void; approved: Plan | null; onApprove: () => void; onRelease: () => void;
  cands: Candidate[]; sel: number; setSel: (i: number) => void; err: string; busy: boolean; locked: boolean; onCompute: () => void; onUse: (c: Candidate) => void; onFlyArea: () => void;
  bud: Budget | null; sim: Sim; setSim: (s: Sim) => void; hudOn: boolean; setHudOn: (b: boolean) => void; conting: ContingencyView | null; onContingency: () => void; clearConting: () => void;
  offline: string; onPrecache: () => void; dataVer: number;
}

const TempCurve = memo(function TempCurve({ start, dur, ver }: { start: number; dur: number; ver: number }) {
  const W = 300, H = 100, px = 26, pts = useMemo(() => curve(0.5), [ver]), lo = Math.min(...pts.map(p => p.t)), hi = Math.max(...pts.map(p => p.t));
  const X = (h: number) => px + (h / 24) * (W - px - 4), Y = (t: number) => 8 + (1 - (t - lo) / (hi - lo || 1)) * (H - 32), s = ((start % 24) + 24) % 24, e = s + dur;
  const segs: [number, number][] = e <= 24 ? [[s, e]] : [[s, 24], [0, e - 24]];
  return <svg className="tcurve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperatura del suelo durante el sol, con la ventana de salida">
    {segs.map(([a, b], i) => <rect key={i} x={X(a)} y={4} width={Math.max(2, X(b) - X(a))} height={H - 28} className="win" />)}
    <polyline points={pts.map(p => `${X(p.h)},${Y(p.t)}`).join(' ')} />
    {[0, 6, 12, 18, 24].map(h => <text key={h} x={X(h)} y={H - 4} textAnchor="middle">{h}h</text>)}
    <text x="2" y="12">{hi.toFixed(0)}°</text><text x="2" y={H - 28}>{lo.toFixed(0)}°</text>
  </svg>;
});

const StopCard = memo(function StopCard({ s, circuit, cand, grid, dataVer }: { s: Stop; circuit: Stop[]; cand?: Candidate; grid: Grid | null; dataVer: number }) {
  const [imgs, setImgs] = useState<StopImage[] | null>(null);
  useEffect(() => { let ok = true; setImgs(null); loadStopImages(s.id).then(r => ok && setImgs(r)); return () => { ok = false; }; }, [s.id]);
  const info = STOP_INFO[s.id], ci = circuit.findIndex(x => x.id === s.id), base = circuit[0]?.at;
  const straight = s.at && base && s.id !== 'base' ? haversine(base, s.at) : undefined, byRoute = cand && ci > 0 ? cand.cumM[cand.stopIdx[ci]] : undefined;
  const cf = s.at ? confidenceAt(s.at, grid) : undefined; void dataVer;
  return <details className="stopcard"><summary>Ficha · {s.name}</summary>
    <p>{info?.science ?? 'Sin descripción.'}{info?.source && <em className="src"> Fuente: {info.source}.</em>}</p>
    {s.src && <p className="hint">Posición precargada: {s.src}</p>}
    {s.at ? <ul className="meas">
      {straight !== undefined && <li>Línea recta desde la Base: <b>{(straight / 1000).toFixed(2)} km</b> (medida sobre tus puntos fijados)</li>}
      {byRoute !== undefined && <li>Por la ruta seleccionada desde la Base: <b>{(byRoute / 1000).toFixed(2)} km</b></li>}
      {cf && <li>Confianza: <b>{CONF[cf.level].sym} {CONF[cf.level].label}</b>{cf.distM !== undefined && ` · a ${cf.distM.toFixed(0)} m de la traza`}</li>}</ul> : <p className="hint">Fija la parada en el mapa para medir distancias y ver su confianza.</p>}
    <h5>Primera persona (Perseverance)</h5>
    {imgs === null ? <p className="hint">Buscando imágenes…</p> : imgs.length ? <div className="fp">{imgs.map(im => <figure key={im.file}><img src={stopImageUrl(s.id, im.file)} alt={im.caption} loading="lazy" /><figcaption>{im.caption}<br /><small>{[im.instrument, im.sol !== undefined ? `sol ${im.sol}` : '', im.credit].filter(Boolean).join(' · ')}</small></figcaption></figure>)}</div>
      : <p className="hint">Sin imágenes: no se incluyen imágenes inventadas ni sin fuente. Coloca imágenes reales de Mastcam-Z/SuperCam (con crédito) en <code>public/jezero/stops/{s.id}/</code> con un <code>manifest.json</code>.</p>}
  </details>;
});

export function EvaPanel(p: Props) {
  const { sc, bud, approved } = p, dis = !!approved, cand = p.cands[p.sel], set = (patch: Partial<Scenario>) => p.setSc({ ...sc, ...patch });
  const dur = bud?.hoursMax ?? A.suitHours.value, tr = traceInfo(), meda = medaInfo();
  // Estos cálculos no dependen del avance simulado (que repinta el panel 4 veces por segundo): se memorizan.
  const win = useMemo(() => bestWindow(dur), [dur, p.dataVer]);
  const conf = useMemo(() => (cand ? routeConfidence(cand, p.grid) : undefined), [cand, p.grid, p.dataVer]);
  const buds = useMemo(() => p.cands.map(c => evaluate(c, sc)), [p.cands, sc, p.dataVer]);
  return <>
    <h4>Zona de planeación</h4>
    {p.area.status === 'ready'
      ? <p className="hint">Relieve MGS MOLA · celda {p.area.cellM.toFixed(0)} m · {p.area.w}×{p.area.h} celdas. <button className="link" title="Encuadrar la cámara sobre el rectángulo que cubre las paradas" onClick={p.onFlyArea}>Ir a la zona</button><br />
          <b>El dato mide ≈ {MOLA_RES_M} m por píxel</b>: la pendiente y la rugosidad describen la forma general del terreno, no los obstáculos de una caminata (rocas, zanjas, escalones de pocos metros). Trátalo como un trazado orientativo, no como un plan de EVA verificado.</p>
      : <p className="hint">{p.area.status === 'loading' ? 'Cargando el relieve de la zona…' : 'Fija la Base en el mapa (las demás paradas ya vienen puestas) y se calculará la zona con el relieve MOLA.'}</p>}

    {approved && <div className="approved" role="status"><b>🔒 PLAN APROBADO · paquete de misión</b>
      <p>Recorrido, paradas, tiempos y presupuesto están bloqueados ({new Date(approved.approvedAt).toLocaleString()}). Los recursos se calcularon para este recorrido exacto. El juicio del astronauta se ejerce en cada parada (qué observar, documentar y muestrear): la restricción responde a los recursos, no a una desconfianza en el astronauta. Un imprevisto se trata como contingencia (abajo).</p>
      <button title="Liberar el plan aprobado: vuelven a poder cambiarse paradas, escenario y presupuesto" onClick={p.onRelease}>Anular plan y volver a planear</button></div>}

    <details open><summary className="sum">Grupo y condiciones de la salida</summary>
      <div className="field"><label>Astronautas</label><input type="number" min={1} max={6} disabled={dis} value={sc.astronauts} onChange={e => set({ astronauts: Math.min(6, Math.max(1, +e.target.value || 1)) })} /></div>
      <label className="chk"><input type="checkbox" disabled={dis} checked={sc.rover} onChange={e => set({ rover: e.target.checked })} />Rover de apoyo</label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={sc.loaded} onChange={e => set({ loaded: e.target.checked })} />Equipo cargado (velocidad ×{A.loadFactor.value}, supuesto)</label>
      <div className="field"><label>Hora de salida</label><input type="range" min={0} max={23.5} step={0.5} disabled={dis} value={sc.startHour} onChange={e => set({ startHour: +e.target.value })} /><b className="hr">{hourLabel(sc.startHour)}</b></div>
      <p className="hint">Hora solar local. Ventana menos fría para {dur.toFixed(1)} h: <b>{hourLabel(win.start)}–{hourLabel(win.start + dur)}</b> (suelo medio {win.meanC.toFixed(0)} °C). <button className="link" disabled={dis} title="Poner la hora de salida en la ventana menos fría" onClick={() => set({ startHour: win.start })}>Usar</button></p>
      <div className="field"><label>Polvo</label><select disabled={dis} value={sc.dust} onChange={e => set({ dust: e.target.value as Scenario['dust'] })}><option value="bajo">Bajo</option><option value="moderado">Moderado</option><option value="alto">Alto</option></select></div>
      <label className="chk"><input type="checkbox" disabled={dis} checked={sc.spaceAlert} onChange={e => set({ spaceAlert: e.target.checked })} />Simular alerta de clima espacial</label>
      <label className="chk"><input type="checkbox" disabled={dis} checked={sc.roughPref} onChange={e => set({ roughPref: e.target.checked })} />Penalizar terreno rugoso (×2.5)</label>
      <p className="hint">Sin mapa de tipo de superficie no se puede «evitar arena suelta»: la rugosidad de MOLA es solo un proxy, y a ≈ {MOLA_RES_M} m apenas distingue nada a escala de caminata. Las rutas se recalculan solas al cambiar paradas o terreno; el presupuesto, al instante.</p>
      <label className="chk"><input type="checkbox" disabled={dis} checked={p.useSkrinkle} onChange={e => p.setUseSkrinkle(e.target.checked)} />Incluir Skrinkle Haven (ruta ambiciosa, opcional)</label>
    </details>

    <h4>Circuito (Base → paradas → Base)</h4>
    <p className="hint">Kodiak, Enchanted Lake, Hogwallow Flats y Skrinkle Haven vienen <b>precargadas</b>: las tres últimas son la posición real de Perseverance cuando trabajó allí (waypoints oficiales de NASA/JPL); la de Kodiak es aproximada (derivada de distancias publicadas). Solo falta fijar la <b>Base</b>. Puedes mover cualquiera; ↺ la devuelve a su posición precargada. Los nombres son informales del equipo de la misión.</p>
    <ol className="stops">{p.stops.map(s => { const inC = p.circuit.some(x => x.id === s.id); return <li key={s.id} className={inC ? '' : 'off'}>
      <b>{s.name}</b> <span className="coord" title={s.src}>{s.at ? `${s.at.lat.toFixed(4)}°, ${s.at.lon.toFixed(4)}°` : 'sin fijar'}{s.at && s.def && s.at.lat === s.def.lat && s.at.lon === s.def.lon ? (s.id === 'kodiak' ? ' · aprox.' : ' · NASA') : ''}</span>
      <button disabled={dis} title={p.placing === s.id ? 'Cancelar: no cambiar esta parada de sitio' : s.at ? `Elegir otra posición para ${s.name} con un clic en el mapa` : `Colocar ${s.name} con un clic en el mapa`} className={p.placing === s.id ? 'primary' : ''} onClick={() => p.setPlacing(p.placing === s.id ? null : s.id)}>{p.placing === s.id ? 'Haz clic en el mapa…' : s.at ? 'Mover' : 'Fijar'}</button>
      {s.def ? (s.at?.lat !== s.def.lat || s.at?.lon !== s.def.lon) && <button disabled={dis} title={`Devolver ${s.name} a su posición precargada`} onClick={() => p.clearStop(s.id)}>↺</button>
        : s.at && <button disabled={dis} title={`Quitar la posición de ${s.name}`} onClick={() => p.clearStop(s.id)}>✕</button>}</li>; })}</ol>
    {p.circuit.filter(s => s.at).map(s => <StopCard key={s.id} s={s} circuit={p.circuit} cand={cand} grid={p.grid} dataVer={p.dataVer} />)}
    <div className="actions"><button className="primary" disabled={!p.grid || p.busy || dis} title="Volver a calcular las tres rutas candidatas con las paradas y el terreno actuales" onClick={p.onCompute}>{p.busy ? 'Calculando…' : 'Recalcular rutas'}</button></div>
    {p.err && <p className="redbox">{p.err}</p>}

    {p.cands.length > 0 && <>
      <h4>Rutas candidatas (de menor a mayor riesgo)</h4>
      {p.cands.map((c, i) => { const b = band(c.riskIndex), bu = buds[i] ?? evaluate(c, sc), v = bu.ok ? 'ok' : 'fail'; return <div key={c.profile.id} className={'cand' + (i === p.sel ? ' on' : '')} onClick={() => p.setSel(i)}>
        <div className="head"><b>{i + 1}. {c.profile.name}</b><span className={'risk ' + b.cls}>{b.sym} {b.txt} · {c.riskIndex.toFixed(0)}</span></div>
        <div className="mx"><span>Distancia <b>{(c.lengthM / 1000).toFixed(2)} km</b></span><span>Duración <b>{hh(bu.hoursMin, bu.hoursMax)}</b></span>
          <span>Pend. máx <b>{c.maxSlope.toFixed(1)}°</b></span><span>&gt;{A.slopeCaution.value}° <b>{c.pctCaution.toFixed(1)} %</b></span>
          <span>Esfuerzo (heurístico) <b>{c.effort.toFixed(2)}×</b></span><span>Dosis est. <b>{bu.doseMin.toFixed(2)}–{bu.doseMax.toFixed(2)} mSv</b></span>
          <span>Rugosidad media <b>{c.meanRough.toFixed(2)} m</b></span><span>Retorno máx <b>{hh(bu.maxBackM / 1000 / bu.kmhMax, bu.maxBackM / 1000 / bu.kmhMin)}</b></span></div>
        <div className={'chip ' + v}>{VERDICT_SYM[v]} {bu.ok ? 'Cabe en el presupuesto' : `No cabe: ${bu.failed.join(', ')}`}</div>
        <div className="actions"><button disabled={p.locked || dis} title="Copiar esta candidata a la pestaña Ruta como waypoints editables" onClick={e => { e.stopPropagation(); p.onUse(c); }}>Usar como ruta →</button></div></div>; })}
      <p className="hint">Estimaciones: duración y retorno son rangos con velocidades supuestas; el índice de riesgo y el de esfuerzo son heurísticos y solo sirven para ordenar (no son el costo metabólico de NASA).</p>
    </>}

    {bud && cand && <details open><summary className="sum">Presupuesto de la salida · ruta {p.sel + 1}</summary>
      <ul className="budget">{bud.lines.map(l => <li key={l.id} className={'bl ' + l.verdict}><span className="vs" title={VERDICT_TXT[l.verdict]}>{VERDICT_SYM[l.verdict]}</span>
        <div><b>{l.label}</b> · {l.value}<small>Límite: {l.limit}</small><details><summary>cómo se calcula</summary><span>{l.note}</span></details></div></li>)}</ul>
      {!dis && <div className="actions"><button className={'primary' + (bud.ok ? '' : ' danger')} disabled={!bud.ok} title={bud.ok ? 'Fijar recorrido, paradas, tiempos y presupuesto como paquete de misión' : `No cabe en el presupuesto: ${bud.failed.join(', ')}`} onClick={p.onApprove}>{bud.ok ? '✔ Aprobar plan' : '✖ Rechazada por el presupuesto'}</button></div>}
      {!dis && !bud.ok && <p className="redbox">No se puede aprobar: {bud.failed.join(', ')}. Cambia la ruta, el grupo, la hora o quita paradas.</p>}
    </details>}

    <details><summary className="sum">Temperatura del suelo · ventana de salida</summary>
      <TempCurve start={sc.startHour} dur={dur} ver={p.dataVer} />
      <p className="hint">{isModeled() ? <><b>Curva MODELADA, no medida:</b> une los extremos citados por NASA/MEDA (≈ −83 °C antes del amanecer, ≈ 5 °C al mediodía) con una forma suave; las horas del mínimo y del máximo son un supuesto. Para usar la curva real de MEDA crea <code>public/jezero/meda_hourly.json</code> con <code>{`{"source":"…","hours":[24 valores °C]}`}</code>.</> : <>Curva de MEDA: {meda?.source}{meda?.date ? ` (${meda.date})` : ''}.</>} El recuadro punteado es tu salida. Los datos analizados por la fuente cubren hasta el sol 400, no todo el año marciano. No hay ajuste por inercia térmica del terreno.</p>
    </details>

    <details><summary className="sum">Radiación y clima espacial</summary>
      <ul className="meas"><li>Referencia: <b>{A.doseDayMsv.value} mSv/día</b> medidos por RAD en <b>Gale</b> (no en Jezero).</li>
        <li>EVA de 8 h con ese valor: ≈ 0.2 mSv (estimación propia: 0.64 × 8 ÷ 24).</li>
        <li>Límites NASA-STD-3001: {A.doseCareer.value} mSv de carrera · {A.doseSpe.value} mSv por evento de partículas solares.</li>
        {bud && <li>Esta ruta: <b>{bud.doseMin.toFixed(2)}–{bud.doseMax.toFixed(2)} mSv</b> ({(100 * bud.doseMax / A.doseSpe.value).toFixed(2)} % del límite por evento).</li>}</ul>
      <p className="hint">La dosis de fondo es pequeña; el riesgo real es un evento de partículas solares (RAD observó uno solo, débil). Por eso se vigila el <b>tiempo máximo de retorno</b>. No hay clima espacial en vivo: es un escenario que activas arriba. Estado: <b>{sc.spaceAlert ? '▲ alerta simulada ACTIVA' : '○ sin alerta (escenario)'}</b>.</p>
    </details>

    <details><summary className="sum">Confianza por zona</summary>
      <ul className="meas">{(Object.keys(CONF) as ConfLevel[]).map(k => <li key={k}>{CONF[k].sym} {CONF[k].label}{conf ? <b> · {conf[k].toFixed(0)} % de la ruta</b> : ''}</li>)}</ul>
      <p className="hint">{tr ? <>Traza de Perseverance cargada: {tr.source} ({tr.points.length} puntos). Alta ≤ {A.confHighM.value} m, media ≤ {A.confMidM.value} m (umbrales supuestos).</> : <>Falta la traza del rover (<code>public/jezero/traverse.json</code> con <code>{`{"source":"…","points":[[lon,lat],…]}`}</code>): sin ella la confianza por distancia es «no verificable», nunca «alta».</>} Aunque sea alta, las rocas &lt; ~1 m no se distinguen con certeza desde la órbita.</p>
    </details>

    {cand && bud && <details><summary className="sum">Ejecución (demostración)</summary>
      <label className="chk"><input type="checkbox" checked={p.sim.on} onChange={e => p.setSim({ ...p.sim, on: e.target.checked, playing: false })} />Mostrar posición simulada del astronauta</label>
      {p.sim.on && <>
        <div className="field"><label>Avance</label><input type="range" min={0} max={cand.path.length - 1} value={p.sim.q} onChange={e => p.setSim({ ...p.sim, q: +e.target.value, playing: false })} /></div>
        <div className="field"><label>Ritmo</label><input type="range" min={0.8} max={1.6} step={0.05} value={p.sim.pace} onChange={e => p.setSim({ ...p.sim, pace: +e.target.value })} /><b className="hr">×{p.sim.pace.toFixed(2)}</b></div>
        <div className="actions"><button title="Mover sola la posición simulada del astronauta a lo largo de la ruta" onClick={() => p.setSim({ ...p.sim, q: p.sim.q >= cand.path.length - 1 ? 0 : p.sim.q, playing: !p.sim.playing })}>{p.sim.playing ? '⏸ Pausar' : '▶ Simular avance'}</button>
          <button title="Mostrar la maqueta del HUD de la visera sobre el mapa" className={p.hudOn ? 'primary' : ''} onClick={() => p.setHudOn(!p.hudOn)}>HUD de la visera</button>
          <button title="Calcular el regreso a la Base desde esta posición con los recursos que quedan" className="danger" disabled={!p.grid} onClick={p.onContingency}>Contingencia aquí</button></div></>}
      {p.conting && <div className={'cont ' + p.conting.verdict}><b>{VERDICT_SYM[p.conting.verdict]} Contingencia · volver a la Base</b>
        <ul className="meas"><li>Camino de regreso: <b>{(p.conting.returnM / 1000).toFixed(2)} km</b> ({hh(p.conting.returnMinH, p.conting.returnMaxH)}){p.conting.roverH !== undefined && <> · con rover ≈ {p.conting.roverH.toFixed(2)} h</>}</li>
          <li>Recursos restantes: <b>{p.conting.remainingH.toFixed(1)} h</b> de autonomía (usadas ≈ {p.conting.elapsedH.toFixed(1)} h)</li>
          <li>Margen al llegar: <b>{p.conting.marginH.toFixed(1)} h</b> {p.conting.verdict === 'fail' ? '→ NO alcanza; pedir rover/rescate' : p.conting.verdict === 'warn' ? '→ por debajo de la reserva' : '→ dentro de la reserva'}</li></ul>
        <button title="Cerrar el cálculo de contingencia y borrar su trazado del mapa" onClick={p.clearConting}>Cerrar</button></div>}
      <p className="hint">Marte no tiene sistema de posicionamiento: la posición se simula. La propuesta de fondo (satélite de navegación y comunicaciones + navegación inercial y visual) aún no se ha contrastado con documentos de NASA.</p>
    </details>}

    <details><summary className="sum">Sin conexión</summary>
      <p className="hint">Guarda las teselas de todas las vistas que cubren la zona de las paradas (y las vecinas MOLA de elevación) para trabajar sin red. Un service worker las sirve después.</p>
      <div className="actions"><button disabled={p.area.status !== 'ready'} title="Descargar y guardar las teselas de la zona para poder usarla sin red" onClick={p.onPrecache}>Guardar zona sin conexión</button></div>{p.offline && <p className="hint">{p.offline}</p>}
    </details>

    <details className="assump"><summary>Supuestos y referencias</summary>
      <ul>{Object.entries(A).map(([k, v]) => <li key={k}><b>{k}</b> = {v.value} {v.unit} <em className={v.kind}>{v.kind}</em><span>{v.note}</span></li>)}</ul></details>
    <p className="hint">Los datos de Marte no se actualizan en tiempo real: las condiciones son escenarios. Pendientes de verificar: límites térmicos del traje y pendiente máxima para Marte.</p>
  </>;
}
