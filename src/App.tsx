import { useEffect, useMemo, useRef, useState } from 'react';
import { MarsEngine, Hover } from './engine/MarsEngine';
import { VIEWS, ViewDef } from './engine/config';
import { POIS } from './engine/poi';
import { Analysis, BLOCK_SCORE, Hazard, Level, VEHICLES, WP, analyze } from './engine/analysis';
import { AreaState, boundsOf, prepareArea } from './engine/area';
import { Candidate, Grid, Stop, buildGrid, planCircuit, planReturn, simplify } from './engine/planning';
import { DEFAULT_SCENARIO, Plan, Scenario, Sim, contingency, evaluate } from './engine/budget';
import { initMeda } from './engine/climate';
import { initTrace, traceInfo } from './engine/confidence';
import { EvaExtras, precacheZone } from './engine/extras';
import { FIELDS, FieldId, rampCss } from './engine/fields';
import { EvaPanel, INIT_STOPS, ContingencyView } from './EvaPanel';
import { Hud, computeHud } from './Hud';

type Status = 'draft' | 'locked' | 'arrived';
interface Saved { wps: WP[]; status: Status; lockedAt?: string; vehicle: string; crew: number }
const KEY = 'mars-route-v2';
const load = (): Saved => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '') as Saved;
    return { ...s, vehicle: VEHICLES.some(v => v.id === s.vehicle) ? s.vehicle : VEHICLES[0].id };
  } catch { return { wps: [], status: 'draft', vehicle: VEHICLES[0].id, crew: 4 }; }
};
const CAM_KEY = 'mars-cam-v1';
const loadCam = (): { street: boolean; deg: number } => { try { return { street: true, deg: 20, ...(JSON.parse(localStorage.getItem(CAM_KEY) || '') as object) }; } catch { return { street: true, deg: 20 }; } };
const FIELD_KEY = 'mars-field-v1';
const loadField = (): { id: FieldId | null; night: boolean; alpha: number } => { try { return { id: null, night: false, alpha: 0.85, ...(JSON.parse(localStorage.getItem(FIELD_KEY) || '') as object) }; } catch { return { id: null, night: false, alpha: 0.85 }; } };
const STOPS_KEY = 'mars-eva-stops-v1', PLAN_KEY = 'mars-eva-plan-v1', SC_KEY = 'mars-eva-scenario-v1', SK_KEY = 'mars-eva-skrinkle-v1', EXT_KEY = 'mars-ext-layer-v1';
/** Las paradas con posición precargada la recuperan si el usuario no la movió (lo guardado tiene prioridad). */
const loadStops = (): Stop[] => { try { const s = JSON.parse(localStorage.getItem(STOPS_KEY) || '') as Stop[]; return INIT_STOPS.map(d => ({ ...d, at: s.find(x => x.id === d.id)?.at ?? d.def })); } catch { return INIT_STOPS; } };
const loadScenario = (): Scenario => { try { return { ...DEFAULT_SCENARIO, ...(JSON.parse(localStorage.getItem(SC_KEY) || '') as Partial<Scenario>) }; } catch { return DEFAULT_SCENARIO; } };
const loadPlan = (): Plan | null => { try { const p = JSON.parse(localStorage.getItem(PLAN_KEY) || '') as Plan; return Array.isArray(p?.cand?.path) && Array.isArray(p.stops) ? p : null; } catch { return null; } };
const loadExt = (): { url: string; level: number; alpha: number } => { try { return { url: '', level: 8, alpha: 0.7, ...(JSON.parse(localStorage.getItem(EXT_KEY) || '') as object) }; } catch { return { url: '', level: 8, alpha: 0.7 }; } };
const TAB_HELP = {
  places: 'Buscar y volar a accidentes geográficos y sitios de aterrizaje de Marte',
  layers: 'Elegir la imagen base, los mapas modelados de radiación y temperatura, el relieve y la cámara',
  route: 'Trazar una ruta con waypoints y ver distancia, tiempo, pendiente, clima, O₂, radiación y peligros',
  eva: 'Planear la caminata por el cráter Jezero: paradas, rutas candidatas, presupuesto y ejecución',
} as const;
const LEVELS: { id: Level; label: string }[] = [{ id: 'major', label: 'Peligros mayores' }, { id: 'medium', label: 'Peligros medios' }, { id: 'minor', label: 'Peligros menores' }];

export default function App() {
  const box = useRef<HTMLDivElement>(null); const eng = useRef<MarsEngine>(); const extras = useRef<EvaExtras>();
  const init = useMemo(load, []); const initPlan = useMemo(loadPlan, []);
  const [view, setView] = useState('viking'); const [overlay, setOverlay] = useState(0); const [exag, setExag] = useState(1.5); const [shade, setShade] = useState(0.7);
  const [tab, setTab] = useState<'places' | 'layers' | 'route' | 'eva'>('places'); const [q, setQ] = useState('');
  const [hover, setHover] = useState<Hover>(); const [cam, setCam] = useState({ alt: 1.6e7, heading: 0 });
  const [wps, setWps] = useState<WP[]>(init.wps); const [status, setStatus] = useState<Status>(init.status);
  const [vehicle, setVehicle] = useState(init.vehicle); const [crew, setCrew] = useState(init.crew); const [planning, setPlanning] = useState(false);
  const [an, setAn] = useState<Analysis | null>(null); const [anBusy, setAnBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [ack, setAck] = useState(false);
  const [badLayers, setBadLayers] = useState<ViewDef[]>([]);
  const [area, setArea] = useState<AreaState>({ status: 'none' }); const [grid, setGrid] = useState<Grid | null>(null);
  const [stops, setStops] = useState<Stop[]>(loadStops); const [placing, setPlacing] = useState<string | null>(null); const [useSkrinkle, setUseSkrinkle] = useState(() => localStorage.getItem(SK_KEY) === '1');
  const [cands, setCands] = useState<Candidate[]>(initPlan ? [initPlan.cand] : []); const [sel, setSel] = useState(0); const [evaErr, setEvaErr] = useState(''); const [busy, setBusy] = useState(false);
  const [scState, setScState] = useState<Scenario>(loadScenario); const [approved, setApproved] = useState<Plan | null>(initPlan);
  const [sim, setSim] = useState<Sim>({ on: false, q: 0, playing: false, pace: 1 }); const [hudOn, setHudOn] = useState(false); const [conting, setConting] = useState<ContingencyView | null>(null);
  const [offline, setOffline] = useState(''); const [dataVer, setDataVer] = useState(0); const [showTrace, setShowTrace] = useState(true);
  const ext0 = useMemo(loadExt, []); const [extUrl, setExtUrl] = useState(ext0.url), [extLevel, setExtLevel] = useState(ext0.level), [extAlpha, setExtAlpha] = useState(ext0.alpha);
  const cam0 = useMemo(loadCam, []); const [street, setStreet] = useState(cam0.street), [lookDeg, setLookDeg] = useState(cam0.deg);
  const fld0 = useMemo(loadField, []); const [field, setField] = useState<FieldId | null>(fld0.id), [fieldNight, setFieldNight] = useState(fld0.night), [fieldAlpha, setFieldAlpha] = useState(fld0.alpha);
  const locked = status === 'locked';
  const blocked = (an?.riskScore ?? 0) > BLOCK_SCORE;
  const live = useRef({ planning, locked, placing, approved }); live.current = { planning, locked, placing, approved };

  const sc = approved ? approved.sc : scState;
  const circuit = useMemo(() => (approved ? approved.stops : stops.filter(s => !s.optional || useSkrinkle)), [approved, stops, useSkrinkle]);
  const circuitKey = circuit.map(s => `${s.id}:${s.at?.lon},${s.at?.lat}`).join('|');
  const cand: Candidate | undefined = cands[sel];
  const bud = useMemo(() => (cand ? evaluate(cand, sc) : null), [cand, sc]);

  useEffect(() => {
    const e = new MarsEngine(box.current!, {
      onHover: setHover, onMove: c => setCam({ alt: c.alt, heading: c.heading }),
      onClick: p => {
        const pl = live.current.placing;
        if (pl && !live.current.approved) { setStops(st => st.map(x => (x.id === pl ? { ...x, at: p } : x))); setPlacing(null); return; }
        if (live.current.planning && !live.current.locked) setWps(w => [...w, p]);
      },
      onLayerError: d => setBadLayers(l => (l.some(x => x.id === d.id) ? l : [...l, d])),
    });
    eng.current = e; extras.current = new EvaExtras(e.viewer);
    if (ext0.url) extras.current.setExternal(ext0.url, ext0.level, ext0.alpha);
    initMeda().then(() => setDataVer(v => v + 1)); initTrace().then(t => { if (t) setDataVer(v => v + 1); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { extras.current?.dispose(); e.dispose(); };
  }, []);
  useEffect(() => { localStorage.setItem(STOPS_KEY, JSON.stringify(stops)); }, [stops]);
  useEffect(() => { localStorage.setItem(SC_KEY, JSON.stringify(scState)); }, [scState]);
  useEffect(() => { localStorage.setItem(SK_KEY, useSkrinkle ? '1' : '0'); }, [useSkrinkle]);
  useEffect(() => { eng.current?.drawEva(circuit, cands, sel); }, [circuit, cands, sel]);
  useEffect(() => { extras.current?.drawTrace(showTrace ? traceInfo()?.points ?? null : null); }, [showTrace, dataVer]);

  // Zona de planeación: el rectángulo que cubre las paradas fijadas. Se descarga su relieve MOLA y se construye la rejilla.
  useEffect(() => {
    const fixed = circuit.filter(s => s.at).map(s => s.at!);
    if (circuit.some(s => !s.at) || fixed.length < 2) { setArea({ status: 'none' }); setGrid(null); return; }
    const b = boundsOf(fixed)!; let ok = true;
    setArea({ status: 'loading' });
    prepareArea(b).then(() => {
      if (!ok) return;
      const g = buildGrid(b);
      setGrid(g); setArea({ status: 'ready', b, cellM: g.cellM, w: g.w, h: g.h });
    });
    return () => { ok = false; };
  }, [circuitKey]);

  // Las rutas se recalculan solas al cambiar paradas, Skrinkle o la preferencia de terreno (no tras aprobar el plan)
  const plan = () => { if (!grid) return; const r = planCircuit(grid, circuit, { roughMul: sc.roughPref ? 2.5 : 1 }); setCands(r.candidates); setSel(0); setEvaErr(r.error ?? ''); setBusy(false); };
  useEffect(() => {
    if (approved || !grid) { setBusy(false); return; }
    if (circuit.some(s => !s.at)) { setCands([]); setEvaErr(''); setBusy(false); return; }
    setBusy(true); setEvaErr('');
    const t = setTimeout(plan, 250); return () => clearTimeout(t);
  }, [grid, approved, circuitKey, sc.roughPref]);
  const compute = () => { if (!grid || approved) return; setBusy(true); setEvaErr(''); setTimeout(plan, 30); };

  const approve = () => {
    if (!cand || !bud?.ok) return;
    const p: Plan = { approvedAt: new Date().toISOString(), cand, sc: scState, stops: circuit.map(s => ({ ...s })) };
    setApproved(p); setCands([cand]); setSel(0);
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch { setEvaErr('El plan quedó aprobado pero no cabe en el almacenamiento del navegador: no sobrevivirá a un refresco.'); }
  };
  const release = () => { if (!window.confirm('¿Anular el plan aprobado? Se liberan paradas, escenario y presupuesto.')) return; setApproved(null); setSim(s => ({ ...s, on: false, playing: false })); setHudOn(false); setConting(null); try { localStorage.removeItem(PLAN_KEY); } catch { /* ignorar */ } };
  const useCandidate = (c: Candidate) => { setWps(simplify(c.path, 15)); setVehicle('foot'); setStatus('draft'); setTab('route'); };

  // Posición simulada, HUD y contingencia
  useEffect(() => { setSim(s => ({ ...s, q: 0, playing: false })); setConting(null); }, [cands, sel]);
  useEffect(() => {
    if (!sim.playing || !cand) return;
    const t = setInterval(() => setSim(s => { const last = cand.path.length - 1, nq = Math.min(last, s.q + Math.max(1, Math.round(last / 240))); return { ...s, q: nq, playing: nq < last }; }), 250);
    return () => clearInterval(t);
  }, [sim.playing, cand]);
  useEffect(() => { extras.current?.drawAstronaut(sim.on && cand ? cand.path[Math.min(sim.q, cand.path.length - 1)] : null); }, [sim.on, sim.q, cand]);
  useEffect(() => { extras.current?.drawContingency(conting?.path ?? null); }, [conting]);
  useEffect(() => { setConting(null); }, [sim.q]);
  const hud = useMemo(() => (sim.on && hudOn && cand && bud ? computeHud(cand, circuit, sim.q, bud, sc, sim.pace, grid) : null), [sim, hudOn, cand, bud, circuit, sc, grid]);
  const doContingency = () => {
    const base = circuit[0]?.at; if (!grid || !cand || !base) return;
    const r = planReturn(grid, cand.path[Math.min(sim.q, cand.path.length - 1)], base);
    if (!r) { setEvaErr('Sin camino transitable de regreso a la Base desde esta posición.'); return; }
    setConting({ ...contingency(cand, sim.q, sc, r.lengthM, sim.pace), path: r.path });
  };
  const nextStop = () => { if (!cand) return; const n = circuit.length; let i = 1; while (i < n && cand.stopIdx[i] <= sim.q) i++; setSim(s => ({ ...s, q: cand.stopIdx[Math.min(i, n)], playing: false })); };

  const precache = async () => {
    if (area.status !== 'ready') return; setOffline('Guardando…');
    try { const r = await precacheZone(area.b, (d, t) => setOffline(`Guardando… ${d}/${t}`)); setOffline(`Listo: ${r.saved} teselas nuevas, ${r.failed} fallaron, ${r.total} en total (las ya guardadas se omiten).`); }
    catch (e) { setOffline(String(e instanceof Error ? e.message : e)); }
  };
  const applyExt = () => { const u = extUrl.trim(); extras.current?.setExternal(u || null, extLevel, extAlpha); try { localStorage.setItem(EXT_KEY, JSON.stringify({ url: u, level: extLevel, alpha: extAlpha })); } catch { /* ignorar */ } };
  const removeExt = () => { extras.current?.setExternal(null); setExtUrl(''); try { localStorage.removeItem(EXT_KEY); } catch { /* ignorar */ } };

  useEffect(() => { eng.current?.setStreetView(street, lookDeg); try { localStorage.setItem(CAM_KEY, JSON.stringify({ street, deg: lookDeg })); } catch { /* ignorar */ } }, [street, lookDeg]);
  useEffect(() => { eng.current?.setLayers(view, overlay); }, [view, overlay]);
  useEffect(() => { eng.current?.setExaggeration(exag); }, [exag]);
  useEffect(() => { eng.current?.setShade(shade); }, [shade]);
  useEffect(() => { eng.current?.setField(field, fieldNight, fieldAlpha); try { localStorage.setItem(FIELD_KEY, JSON.stringify({ id: field, night: fieldNight, alpha: fieldAlpha })); } catch { /* ignorar */ } }, [field, fieldNight]);
  useEffect(() => { eng.current?.setFieldAlpha(fieldAlpha); }, [fieldAlpha]);
  useEffect(() => { eng.current?.drawRoute(wps, locked || status === 'arrived'); }, [wps, status, locked]);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ wps, status, vehicle, crew, lockedAt: status === 'locked' ? new Date().toISOString() : undefined })); }, [wps, status, vehicle, crew]);
  // Análisis de la ruta: con < 2 waypoints no hay nada que analizar; si no, se calcula (con indicador de «calculando») y nunca queda colgado.
  useEffect(() => {
    let ok = true;
    if (wps.length < 2) { setAn(null); setAnBusy(false); return; }
    setAnBusy(true);
    analyze(wps, VEHICLES.find(v => v.id === vehicle) ?? VEHICLES[0], crew)
      .then(a => { if (ok) { setAn(a); setAnBusy(false); } })
      .catch(() => { if (ok) { setAn(null); setAnBusy(false); } });
    return () => { ok = false; };
  }, [wps, vehicle, crew]);

  const hits = POIS.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  const fmtAlt = (m: number) => (m > 1e5 ? `${(m / 1000).toFixed(0)} km` : m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`);
  const doLock = () => { setStatus('locked'); setPlanning(false); setConfirm(false); setAck(false); };
  const closeConfirm = () => { setConfirm(false); setAck(false); };
  const badNow = badLayers.find(l => l.id === view);

  return (
    <div className="app">
      <div ref={box} className="globe" />
      <aside className="panel">
        <div className="brand"><span className="dot" />Mars Atlas</div>
        <div className="search"><input placeholder="Buscar en Marte…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <nav className="tabs">{(['places', 'layers', 'route', 'eva'] as const).map(t => <button key={t} title={TAB_HELP[t]} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ places: 'Lugares', layers: 'Capas', route: 'Ruta', eva: 'EVA' }[t]}</button>)}</nav>
        <div className="body">
          {tab === 'places' && hits.map(p => (
            <button key={p.name} title={`Volar a ${p.name}: ${p.note}`} className="row" onClick={() => eng.current?.flyToPoi(p)}>
              <b>{p.name}</b><small>{p.kind} · {p.lat.toFixed(1)}°, {p.lon.toFixed(1)}°</small><em>{p.note}</em>
            </button>))}
          {tab === 'layers' && <>
            <h4>Vista</h4>
            {VIEWS.map(v => <label key={v.id} title={v.desc} className={'radio' + (view === v.id ? ' on' : '')}><input type="radio" checked={view === v.id} onChange={() => setView(v.id)} /><span><b>{v.name}</b><small>{v.desc}</small></span></label>)}
            {view !== 'mola' && <><h4>Relieve MOLA superpuesto · {Math.round(overlay * 100)}%</h4><input type="range" min={0} max={1} step={0.05} value={overlay} onChange={e => setOverlay(+e.target.value)} /></>}
            <h4>Exageración vertical 3D · {exag.toFixed(1)}×</h4>
            <input type="range" min={1} max={6} step={0.5} value={exag} onChange={e => setExag(+e.target.value)} />
            <h4>Sombreado de relieve · {Math.round(shade * 100)}%</h4>
            <input type="range" min={0} max={1} step={0.05} value={shade} onChange={e => setShade(+e.target.value)} />
            <h4>Mapas modelados</h4>
            <label className="radio" title="Quita el mapa temático y deja solo la capa base"><input type="radio" checked={!field} onChange={() => setField(null)} /><span><b>Ninguno</b><small>Solo la vista elegida arriba</small></span></label>
            {(['radiation', 'temp'] as FieldId[]).map(id => <label key={id} className={'radio' + (field === id ? ' on' : '')} title={FIELDS[id].method}>
              <input type="radio" checked={field === id} onChange={() => setField(id)} /><span><b>{FIELDS[id].name}</b><small>{FIELDS[id].desc}</small></span></label>)}
            {field && <>
              {field === 'temp' && <div className="field"><label>Momento</label>
                <button title="Temperatura del suelo con el Sol alto" className={!fieldNight ? 'primary' : ''} onClick={() => setFieldNight(false)}>Día</button>
                <button title="Temperatura del suelo de madrugada" className={fieldNight ? 'primary' : ''} onClick={() => setFieldNight(true)}>Noche</button></div>}
              <div className="legend" title={FIELDS[field].method}>
                <i style={{ background: rampCss(FIELDS[field]) }} />
                <span>{FIELDS[field].scale(fieldNight).loLabel}</span><b>{FIELDS[field].unit}</b><span>{FIELDS[field].scale(fieldNight).hiLabel}</span>
              </div>
              <div className="field"><label>Opacidad</label><input title="Transparencia del mapa modelado sobre la capa base" type="range" min={0.2} max={1} step={0.05} value={fieldAlpha} onChange={e => setFieldAlpha(+e.target.value)} /><b className="hr">{Math.round(fieldAlpha * 100)}%</b></div>
              <p className="hint"><b>Modelado, no medido.</b> {FIELDS[field].method}</p>
            </>}
            <h4>Cámara del terreno 3D</h4>
            <label className="chk"><input type="checkbox" checked={street} onChange={e => setStreet(e.target.checked)} />Vista de calle: al acercarse, la cámara se inclina hacia el horizonte (no cenital)</label>
            <div className="field"><label>Inclinación</label><input type="range" min={5} max={60} step={5} disabled={!street} value={lookDeg} onChange={e => setLookDeg(+e.target.value)} /><b className="hr">{lookDeg}°</b></div>
            <p className="hint">Ángulo sobre el horizonte: 5° = rasante (como a pie), 60° = vista aérea oblicua. Con el botón ⟲ puedes inclinar más o menos pivotando sobre el centro de la pantalla. Para fijar paradas con vista cenital, desactiva esta opción o sube la inclinación.</p>
            <h4>Capa externa (espectral CRISM, HiRISE, CTX…)</h4>
            <input className="txt" placeholder="https://…/{z}/{y}/{x}.png" value={extUrl} onChange={e => setExtUrl(e.target.value)} />
            <div className="field"><label>Nivel máx.</label><input type="number" min={0} max={20} value={extLevel} onChange={e => setExtLevel(Math.min(20, Math.max(0, +e.target.value || 0)))} /></div>
            <div className="field"><label>Opacidad</label><input type="range" min={0} max={1} step={0.05} value={extAlpha} onChange={e => { setExtAlpha(+e.target.value); extras.current?.setExternalAlpha(+e.target.value); }} /></div>
            <div className="actions"><button title="Carga la plantilla de teselas escrita arriba como capa extra" className="primary" disabled={!extUrl.trim()} onClick={applyExt}>Activar</button><button title="Quita la capa externa y borra la URL guardada" onClick={removeExt}>Quitar</button></div>
            <p className="hint">No viene precargada: no verifiqué una URL pública estable de CRISM/HiRISE y no invento una. Pega aquí la plantilla de teselas de la capa que quieras (esquema EPSG:4326, como las demás; el orden {'{z}/{y}/{x}'} depende del servidor). Se dibuja bajo el sombreado.</p>
            <label className="chk"><input type="checkbox" checked={showTrace} onChange={e => setShowTrace(e.target.checked)} />Traza de Perseverance (si existe public/jezero/traverse.json)</label>
            <p className="hint">El relieve 3D está en todo el globo desde el arranque (rejilla MOLA global ≈ 10 km) y se afina al acercarse (≈ 650 m); todas las capas se proyectan sobre él. Las alturas se derivan del color de MOLA (aproximadas), se suavizan con un filtro de talud y se les añade micro-relieve procedural; no son datos medidos.</p>
          </>}
          {tab === 'eva' && <EvaPanel {...{ area, grid, stops, circuit, placing, setPlacing, cands, sel, setSel, busy, locked, err: evaErr, onCompute: compute, onUse: useCandidate, useSkrinkle, setUseSkrinkle, sc, setSc: setScState, approved, onApprove: approve, onRelease: release, bud, sim, setSim, hudOn, setHudOn, conting, onContingency: doContingency, offline, onPrecache: precache, dataVer }}
            clearStop={id => setStops(st => st.map(x => (x.id === id ? { ...x, at: x.def } : x)))} clearConting={() => setConting(null)} onFlyArea={() => area.status === 'ready' && eng.current?.flyToArea(area.b)} />}
          {tab === 'route' && <RoutePanel {...{ wps, setWps, status, setStatus, vehicle, setVehicle, crew, setCrew, planning, setPlanning, an, anBusy, locked, blocked, onLock: () => setConfirm(true), onFit: () => eng.current?.fitRoute(wps) }} />}
        </div>
      </aside>

      <div className="nav">
        <button title="Girar el mapa para poner el norte arriba" onClick={() => eng.current?.north()} style={{ transform: `rotate(${-cam.heading}rad)` }}>⬆</button>
        <button title="Inclinar la cámara 10° hacia el horizonte, pivotando sobre el centro de la pantalla" onClick={() => eng.current?.tilt(10)}>⟲</button>
        <button title="Volver a la vista inicial del planeta entero" onClick={() => eng.current?.home()}>⌂</button>
        <button title="Acercar la cámara al terreno" onClick={() => eng.current?.zoom(0.4)}>+</button>
        <button title="Alejar la cámara del terreno" onClick={() => eng.current?.zoom(-0.6)}>−</button>
      </div>
      {placing && <div className="toast">Haz clic en el mapa para fijar «{stops.find(x => x.id === placing)?.name}»</div>}
      {planning && !locked && <div className="toast">Haz clic en el globo para añadir waypoints</div>}
      {locked && <div className="toast lock">🔒 Ruta bloqueada — no puede modificarse hasta llegar al destino</div>}
      {badNow && <div className="toast err">No cargan las teselas de «{badNow.name}». Revisa el nombre de la capa en config.ts y la pestaña Network (F12).</div>}
      {hud && <Hud d={hud} onNextStop={nextStop} onContingency={doContingency} onClose={() => setHudOn(false)} />}
      <footer className="status">
        <span>{hover ? `${hover.lat.toFixed(3)}° ${hover.lat >= 0 ? 'N' : 'S'}  ${hover.lon.toFixed(3)}° ${hover.lon >= 0 ? 'E' : 'O'}` : '—'}</span>
        <span>Elev. {hover?.elev !== undefined ? `${(hover.elev / 1000).toFixed(2)} km` : '—'}</span>
        <span>Altitud de cámara {fmtAlt(cam.alt)}</span><span className="credit">Datos: NASA/JPL · Viking · MGS MOLA · THEMIS</span>
      </footer>

      {confirm && an && <div className="modal"><div className={'card' + (blocked ? ' danger' : '')}>
        <h3>{blocked ? `⛔ Ruta de peligro ${an.riskScore.toFixed(0)}/100` : '🔒 Confirmar y bloquear ruta'}</h3>
        {blocked && <p className="redbox">El peligro supera el {BLOCK_SCORE}%. <b>No se recomienda crear esta ruta.</b> Si continúas, asumes todos los riesgos siguientes:</p>}
        <p>Ruta de <b>{wps.length} waypoints</b> ({an.km.toFixed(0)} km, {an.sols} {an.sols === 1 ? 'jornada' : 'jornadas'}, {VEHICLES.find(v => v.id === vehicle)?.name}). Al bloquear, <b>no podrá editarse ni eliminarse</b> hasta confirmar la llegada.</p>
        <HazardList hazards={an.hazards} />
        <label className="check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />{blocked ? 'Soy consciente de estos peligros y quiero crear la ruta de todos modos.' : 'Entiendo que la ruta será definitiva.'}</label>
        <div className="actions"><button title="Cerrar sin bloquear: la ruta sigue siendo un borrador editable" onClick={closeConfirm}>Cancelar</button><button title={blocked ? 'Crear la ruta pese al peligro alto: quedará bloqueada hasta confirmar la llegada' : 'Fijar la ruta: no podrá editarse hasta confirmar la llegada'} className={'primary' + (blocked ? ' danger' : '')} disabled={!ack} onClick={doLock}>{blocked ? 'Crear de todos modos' : 'Bloquear ruta'}</button></div>
      </div></div>}
    </div>
  );
}

/** Peligros agrupados: mayores (rojo), medios (amarillo), menores (verde). */
function HazardList({ hazards }: { hazards: Hazard[] }) {
  if (!hazards.length) return <p className="hint">No se detectaron peligros relevantes.</p>;
  return <div className="hazards">{LEVELS.map(L => {
    const hs = hazards.filter(h => h.level === L.id); if (!hs.length) return null;
    return <section key={L.id} className={'hz ' + L.id}><h5>{L.label} ({hs.length})</h5>
      <ul>{hs.map((h, i) => <li key={i}><b>{h.title}</b> <i>+{h.pts}</i><span>{h.detail}</span></li>)}</ul></section>;
  })}</div>;
}

const num = (x: number, f: (n: number) => string) => (Number.isFinite(x) ? f(x) : '—');

function RoutePanel(p: any) {
  const { wps, setWps, status, setStatus, vehicle, setVehicle, crew, setCrew, planning, setPlanning, an, anBusy, locked, blocked } = p;
  const done = status === 'arrived'; const veh = VEHICLES.find(v => v.id === vehicle) ?? VEHICLES[0];
  return <>
    <div className={'badge ' + status}>{locked ? '🔒 BLOQUEADA' : done ? '✔ COMPLETADA' : '✎ BORRADOR'}</div>
    <div className="field"><label>Desplazamiento</label><select disabled={locked} value={vehicle} onChange={e => setVehicle(e.target.value)}>{VEHICLES.map(v => <option key={v.id} value={v.id}>{v.name} · {v.kmh} km/h</option>)}</select></div>
    <div className="field"><label>Tripulación</label><input type="number" min={1} max={12} disabled={locked || !veh.crewed} value={crew} onChange={e => setCrew(Math.max(1, +e.target.value))} /></div>
    <div className="actions">
      <button title={planning ? 'Dejar de añadir waypoints al hacer clic en el globo' : 'Activa el modo edición: cada clic en el globo añade un waypoint a la ruta'} disabled={locked} className={planning ? 'primary' : ''} onClick={() => setPlanning(!planning)}>{planning ? 'Terminar edición' : '＋ Planear ruta'}</button>
      <button title="Quitar el último waypoint añadido" disabled={locked || !wps.length} onClick={() => setWps(wps.slice(0, -1))}>Deshacer</button>
      <button title="Vaciar la ruta entera" disabled={locked || !wps.length} onClick={() => setWps([])}>Borrar</button>
      <button title="Encuadrar la cámara sobre toda la ruta" onClick={p.onFit} disabled={!wps.length}>Ver</button>
    </div>
    {wps.length > 0 && <ol className="wps">{wps.map((w: WP, i: number) => <li key={i}>{w.lat.toFixed(2)}°, {w.lon.toFixed(2)}° {!locked && <button title={`Quitar el waypoint ${i + 1}`} onClick={() => setWps(wps.filter((_: WP, k: number) => k !== i))}>✕</button>}</li>)}</ol>}
    {!an && wps.length < 2 && <p className="hint">Pulsa «＋ Planear ruta» y haz clic en el globo para poner al menos 2 waypoints. Aquí aparecerán distancia, tiempo, pendiente, clima, O₂, radiación y peligros.</p>}
    {!an && wps.length >= 2 && anBusy && <p className="hint">Calculando análisis de la ruta…</p>}
    {!an && wps.length >= 2 && !anBusy && <p className="warn">No se pudo analizar la ruta. Prueba a borrar y volver a trazarla.</p>}
    {an && <>
      {blocked && !locked && !done && <p className="redbox">⛔ Peligro {an.riskScore.toFixed(0)}/100: supera el {BLOCK_SCORE}%. La app no deja crear esta ruta sin una confirmación explícita.</p>}
      {an.elevCoverage < 1 && <p className="warn">{an.elevCoverage === 0 ? 'No se pudo obtener la elevación (teselas MOLA sin cargar): pendiente, desnivel y perfil no están disponibles; clima y radiación usan altura 0.' : `Elevación parcial: solo ${(an.elevCoverage * 100).toFixed(0)} % de los puntos de la ruta tienen altura; pendiente y desnivel son aproximados.`} El resto de datos (distancia, tiempo, O₂, peligros) sí es válido.</p>}
      <div className="grid">
        <Stat l="Modo" v={veh.foot ? 'A pie (EVA)' : veh.crewed ? 'Vehículo' : 'Robótico'} /><Stat l="Velocidad" v={`${veh.kmh} km/h · ${an.kmPerSol.toFixed(0)} km/sol`} />
        <Stat l="Distancia" v={`${an.km.toFixed(0)} km`} /><Stat l="Tiempo de ruta" v={`${an.hours.toFixed(1)} h (${an.sols} ${an.sols === 1 ? 'jornada' : 'jornadas'})`} />
        <Stat l="Peligro" v={`${an.risk} · ${an.riskScore.toFixed(0)}/100`} cls={an.risk} /><Stat l="Pend. máx / media" v={`${num(an.maxSlope, n => n.toFixed(0))}° / ${num(an.avgSlope, n => n.toFixed(1))}°`} />
        <Stat l="Terreno" v={an.terrain} /><Stat l="Clima" v={an.climate} />
        <Stat l="Temp. día / noche" v={`${an.tempDay.toFixed(0)}° / ${an.tempNight.toFixed(0)}° C`} /><Stat l="Presión" v={`${an.pressure.toFixed(0)} Pa`} />
        <Stat l="O₂ atmosférico" v={`${an.o2Pa.toFixed(2)} Pa (0.13 %)`} /><Stat l="O₂ requerido" v={veh.crewed ? `${an.o2Kg.toFixed(0)} kg (${crew} pers.)` : '— (sin tripulación)'} />
        <Stat l="Viento" v={`~${an.wind.toFixed(0)} m/s`} /><Stat l="Tormentas de polvo" v={an.dustRisk} cls={an.dustRisk} />
        <Stat l="Radiación" v={veh.crewed ? `${an.radiation.toFixed(2)} mSv/día · ${an.dose.toFixed(1)} mSv total` : `${an.radiation.toFixed(2)} mSv/día`} /><Stat l="Desnivel +/−" v={`${an.ascent.toFixed(0)} / ${an.descent.toFixed(0)} m`} />
      </div>
      <Profile data={an.profile} />
      <h4>Peligros de la ruta</h4>
      <HazardList hazards={an.hazards} />
      <p className="hint">Clima, O₂, radiación, viento y peligros son modelos simplificados, no mediciones. La elevación se deriva del color de MOLA; la pendiente se estima entre muestras cada ≤ 20 km, así que es una aproximación gruesa.</p>
    </>}
    <div className="actions">
      {!locked && !done && <button title="Revisar los peligros y fijar la ruta para que no pueda editarse" className={'primary lock' + (blocked ? ' danger' : '')} disabled={wps.length < 2} onClick={p.onLock}>{blocked ? '⛔ Crear ruta (peligro alto)' : '🔒 LOCK ruta'}</button>}
      {locked && <button title="Marcar la ruta como completada y desbloquearla" className="primary" onClick={() => window.confirm('¿Confirmas que la tripulación llegó al destino? Esto libera la ruta.') && setStatus('arrived')}>✔ Confirmar llegada</button>}
      {done && <button title="Vaciar la ruta y empezar un borrador nuevo" onClick={() => { setWps([]); setStatus('draft'); }}>Nueva ruta</button>}
    </div>
  </>;
}
const Stat = ({ l, v, cls = '' }: { l: string; v: string; cls?: string }) => <div className={'stat ' + cls}><small>{l}</small><b>{v}</b></div>;
function Profile({ data }: { data: { d: number; h: number }[] }) {
  if (data.length < 2) return null;
  const W = 300, H = 70, mx = data[data.length - 1].d || 1, lo = Math.min(...data.map(p => p.h)), hi = Math.max(...data.map(p => p.h)), r = hi - lo || 1;
  const pts = data.map(p => `${(p.d / mx) * W},${H - ((p.h - lo) / r) * (H - 6) - 3}`).join(' ');
  return <svg className="profile" viewBox={`0 0 ${W} ${H}`}><polyline points={`0,${H} ${pts} ${W},${H}`} /><text x="4" y="10">{(hi / 1000).toFixed(1)} km</text><text x="4" y={H - 3}>{(lo / 1000).toFixed(1)} km</text></svg>;
}
