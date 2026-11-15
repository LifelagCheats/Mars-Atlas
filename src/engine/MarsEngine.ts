import * as C from 'cesium';
import { MARS, VIEWS, ViewDef } from './config';
import { POIS, POI } from './poi';
import { MarsTerrain, HillshadeProvider, MOLA_MAX_LEVEL } from './terrain';
import { elevationNow, heightNow, initCoarse, onElevationReady, prefetchAround } from './elevation';
import type { Bounds } from './area';
import { FIELDS, FieldId, FieldProvider } from './fields';
import type { Candidate, LL } from './planning';
import type { WP } from './analysis';

export interface Hover { lon: number; lat: number; elev?: number; alt: number }
/** Por debajo de esta altura de cámara, con la vista casi cenital, se inclina sola (si «vista de calle» está activa). */
const TILT_ALT = 6e5, NADIR_DEG = -70;
/** Por debajo de estas alturas de cámara se pre-cargan las teselas finas de elevación alrededor del centro (radio 1 y 2 teselas). */
const PREFETCH_ALT = 3e6, PREFETCH_NEAR = 4e5;
export interface Callbacks {
  onHover: (h: Hover) => void; onClick: (p: WP) => void;
  onMove: (cam: { lon: number; lat: number; alt: number; heading: number }) => void;
  /** Se llama cuando una capa no logra cargar teselas de nivel bajo (nombre/URL probablemente incorrectos). */
  onLayerError?: (v: ViewDef) => void;
}

export class MarsEngine {
  viewer: C.Viewer; private layers = new Map<string, C.ImageryLayer>(); private view = 'viking'; private overlay = 0;
  private routeDs = new C.CustomDataSource('route'); private reported = new Set<string>();
  private ell: C.Ellipsoid; private urlIdx = new Map<string, number>(); private hill: C.ImageryLayer[] = []; private shade = 0.7; private field?: C.ImageryLayer; private evaDs = new C.CustomDataSource('eva');
  private offElev: () => void; private streetView = true; private lookDeg = 20; private flying = false; private dead = false; private lastHover = 0; private lastTick = 0; private lastCam = { alt: -1, hd: -1 };

  constructor(el: HTMLElement, private cb: Callbacks) {
    const ell = this.ell = new C.Ellipsoid(MARS.a, MARS.b, MARS.c);
    C.Ellipsoid.default = ell; // todo Cesium usa Marte a partir de aquí
    this.viewer = new C.Viewer(el, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, scene3DOnly: true,
      mapProjection: new C.GeographicProjection(ell), globe: new C.Globe(ell), skyAtmosphere: false,
      // Render bajo demanda: solo se dibuja cuando algo cambia (cámara, teselas, capas…) en vez de 60 fps constantes.
      requestRenderMode: true, maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    });
    const v = this.viewer, s = v.scene;
    (v.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';
    s.globe.showGroundAtmosphere = false; s.globe.enableLighting = false; s.globe.baseColor = C.Color.fromCssColorString('#6b3a28');
    s.globe.terrainProvider = new MarsTerrain(ell) as unknown as C.TerrainProvider; // relieve real: todas las capas se drapean encima
    s.globe.tileCacheSize = 400; // conserva más teselas ya generadas (volver a una zona no recalcula nada)
    // Rejilla de elevación global gruesa: relieve inmediato en todo el planeta. Cuando llegan datos nuevos se pide un fotograma
    // para que Cesium reintente las teselas que esperaban (el visor renderiza bajo demanda).
    initCoarse();
    this.offElev = onElevationReady(() => { if (!this.dead) s.requestRender(); });
    s.globe.depthTestAgainstTerrain = true;
    s.verticalExaggeration = 1.5;
    s.fog.enabled = false; s.backgroundColor = C.Color.BLACK; s.highDynamicRange = false;
    s.msaaSamples = 1; // FXAA ya suaviza bordes; MSAA×4 multiplica el costo de GPU
    s.globe.maximumScreenSpaceError = 2.5; // menos teselas por fotograma (el relieve base es MOLA, de ~460 m)
    s.screenSpaceCameraController.minimumZoomDistance = 250; s.screenSpaceCameraController.maximumZoomDistance = 2.5e7;
    s.postProcessStages.fxaa.enabled = true;

    for (const d of VIEWS) { this.urlIdx.set(d.id, 0); this.addLayer(d, 0); }
    // Sombreado de relieve generado desde la elevación: da volumen a colinas sobre cualquier capa base
    this.buildHill();
    v.dataSources.add(this.routeDs); v.dataSources.add(this.evaDs);
    this.addPois();

    const h = new C.ScreenSpaceEventHandler(s.canvas);
    h.setInputAction((m: { endPosition: C.Cartesian2 }) => {
      const now = performance.now(); if (now - this.lastHover < 100) return; this.lastHover = now; // el picking recorre el terreno: máx. 10 por segundo
      const p = this.pick(m.endPosition); if (!p) return;
      this.cb.onHover({ ...p, elev: elevationNow(p.lon, p.lat), alt: v.camera.positionCartographic.height });
    }, C.ScreenSpaceEventType.MOUSE_MOVE);
    h.setInputAction((m: { position: C.Cartesian2 }) => { const p = this.pick(m.position); if (p) this.cb.onClick(p); }, C.ScreenSpaceEventType.LEFT_CLICK);
    v.camera.percentageChanged = 0.02;
    v.camera.changed.addEventListener(() => this.tick()); v.camera.moveEnd.addEventListener(() => { this.tick(true); this.prefetchCenter(); this.maybeTilt(); });
    this.home(0);
  }

  /** Crea la capa de la URL #idx de la vista. Si falla a nivel bajo (404), pasa sola a la siguiente URL alternativa. */
  private makeLayer(d: ViewDef, idx: number): C.ImageryLayer {
    const urls = [d.url, ...(d.alt ?? [])];
    const provider = new C.UrlTemplateImageryProvider({
      url: urls[idx], tilingScheme: new C.GeographicTilingScheme({ ellipsoid: this.ell }), maximumLevel: d.maxLevel, tileWidth: 256, tileHeight: 256,
      rectangle: d.rect ? C.Rectangle.fromDegrees(...d.rect) : undefined, // THEMIS solo cubre ±65°: fuera no se piden teselas
      credit: 'NASA/JPL/USGS · NASA Trek',
    });
    provider.errorEvent.addEventListener((e: C.TileProviderError) => {
      console.warn(`[capa ${d.id} · URL ${idx + 1}/${urls.length}] error en tesela z${e.level} (${e.x},${e.y}):`, e.message);
      if (e.level > 1 || this.urlIdx.get(d.id) !== idx) return; // niveles 0-1 existen siempre en un mosaico global
      this.urlIdx.set(d.id, idx + 1);
      setTimeout(() => this.swapLayer(d, idx + 1, urls.length), 0);
    });
    return new C.ImageryLayer(provider);
  }
  private addLayer(d: ViewDef, idx: number) { const l = this.makeLayer(d, idx); l.show = d.id === this.view; this.viewer.imageryLayers.add(l); this.layers.set(d.id, l); }
  private swapLayer(d: ViewDef, idx: number, total: number) {
    if (idx >= total) { if (!this.reported.has(d.id)) { this.reported.add(d.id); this.cb.onLayerError?.(d); } return; }
    const old = this.layers.get(d.id); if (old) this.viewer.imageryLayers.remove(old, true);
    this.addLayer(d, idx);
    this.setLayers(this.view, this.overlay);
  }

  /** Picking sobre el terreno 3D (no sobre el elipsoide liso) para que el clic caiga donde se ve. */
  private pick(pos: C.Cartesian2): WP | undefined {
    const cam = this.viewer.camera, scene = this.viewer.scene, ray = cam.getPickRay(pos);
    const c = (ray && scene.globe.pick(ray, scene)) ?? cam.pickEllipsoid(pos, C.Ellipsoid.default); if (!c) return;
    const g = C.Cartographic.fromCartesian(c); return { lon: C.Math.toDegrees(g.longitude), lat: C.Math.toDegrees(g.latitude) };
  }

  /** Punto del terreno bajo el centro de la pantalla. */
  private screenCenter(): C.Cartesian3 | undefined {
    const s = this.viewer.scene, c = s.canvas, pos = new C.Cartesian2(c.clientWidth / 2, c.clientHeight / 2), ray = s.camera.getPickRay(pos);
    return (ray && s.globe.pick(ray, s)) ?? s.camera.pickEllipsoid(pos, this.ell) ?? undefined;
  }
  /** Pide un fotograma ahora y un par más tarde (las primitivas asíncronas —rutas pegadas al terreno— terminan de crearse después). */
  kick() { const go = () => { if (!this.dead) this.viewer.scene.requestRender(); }; go(); setTimeout(go, 250); setTimeout(go, 1000); }

  /** Mira a `target` desde `range` metros con la inclinación `pitchDeg` (−90 = cenital, −20 = casi de lado). Pivota sobre el punto, como Google Earth. */
  private lookAt(target: C.Cartesian3, heading: number, pitchDeg: number, range: number, duration = 2.5) {
    this.flying = true;
    // La elevación del destino empieza a cargarse ANTES del vuelo: al llegar, el relieve ya está listo.
    if (range < PREFETCH_ALT) { const g = C.Cartographic.fromCartesian(target); prefetchAround(C.Math.toDegrees(g.longitude), C.Math.toDegrees(g.latitude), range < PREFETCH_NEAR ? 2 : 1); }
    this.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 1), {
      offset: new C.HeadingPitchRange(heading, C.Math.toRadians(pitchDeg), Math.max(range, 300)), duration,
      complete: () => { this.flying = false; this.kick(); }, cancel: () => { this.flying = false; },
    });
  }
  private groundPoint(lon: number, lat: number) {
    prefetchAround(lon, lat, 1);
    const e = heightNow(lon, lat);
    return C.Cartesian3.fromDegrees(lon, lat, e * this.viewer.scene.verticalExaggeration);
  }
  /** Vista de calle: al acercarse lo bastante para ver el terreno 3D con la cámara casi cenital, se inclina hacia el horizonte. */
  setStreetView(on: boolean, deg: number) { this.streetView = on; this.lookDeg = Math.min(70, Math.max(5, deg)); if (on) this.maybeTilt(); }
  private pitchNow() { return this.streetView ? -this.lookDeg : -55; }
  private maybeTilt() {
    if (!this.streetView || this.flying || this.dead) return;
    const cam = this.viewer.camera;
    if (cam.positionCartographic.height > TILT_ALT || C.Math.toDegrees(cam.pitch) > NADIR_DEG) return;
    const c = this.screenCenter(); if (!c) return;
    this.lookAt(c, cam.heading, -this.lookDeg, C.Cartesian3.distance(cam.positionWC, c), 1.4);
  }

  /** Con la cámara inclinada, lo que se ve está delante de ella: pre-carga también alrededor del punto del centro de la pantalla. */
  private prefetchCenter() {
    const h = this.viewer.camera.positionCartographic.height; if (h > PREFETCH_ALT) return;
    const c = this.screenCenter(); if (!c) return; const g = C.Cartographic.fromCartesian(c);
    prefetchAround(C.Math.toDegrees(g.longitude), C.Math.toDegrees(g.latitude), h < PREFETCH_NEAR ? 2 : 1);
  }
  private tick(force = false) {
    const now = performance.now(); if (!force && now - this.lastTick < 120) return; this.lastTick = now;
    const cam = this.viewer.camera, g = cam.positionCartographic;
    if (g.height < PREFETCH_ALT) prefetchAround(C.Math.toDegrees(g.longitude), C.Math.toDegrees(g.latitude), 1); // en movimiento: radio corto
    // Si casi no cambió, no se avisa a React (cada aviso vuelve a pintar todo el panel)
    if (!force && Math.abs(g.height - this.lastCam.alt) < g.height * 0.005 && Math.abs(cam.heading - this.lastCam.hd) < 0.005) return;
    this.lastCam = { alt: g.height, hd: cam.heading };
    this.cb.onMove({ lon: C.Math.toDegrees(g.longitude), lat: C.Math.toDegrees(g.latitude), alt: g.height, heading: cam.heading });
  }

  private addPois() {
    const sz = { 1: [1.4, 3.5e7], 2: [1.1, 6e6], 3: [0.95, 1.5e6] } as const;
    for (const p of POIS) this.viewer.entities.add({
      name: p.name, position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      point: { pixelSize: p.kind === 'Misión' ? 7 : 5, color: p.kind === 'Misión' ? C.Color.fromCssColorString('#4fc3f7') : C.Color.WHITE, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, sz[p.rank][1]), disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: p.name, font: `${p.rank === 1 ? 600 : 500} ${p.rank === 1 ? 16 : 13}px Roboto, sans-serif`, fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, -2), horizontalOrigin: C.HorizontalOrigin.LEFT, heightReference: C.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, sz[p.rank][1]), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new C.NearFarScalar(2e5, 1.15, sz[p.rank][1], 0.7) },
    });
  }

  /** Sombreado de relieve, calculado desde la elevación MOLA sobre cualquier capa base. */
  private buildHill() {
    const v = this.viewer;
    this.hill.forEach(l => v.imageryLayers.remove(l, true)); this.hill = [];
    this.hill.push(new C.ImageryLayer(new HillshadeProvider(this.ell, { maxLevel: MOLA_MAX_LEVEL }) as unknown as C.ImageryProvider, { alpha: this.shade }));
    this.hill.forEach(l => { l.show = this.shade > 0; v.imageryLayers.add(l); });
  }

  /** Una sola función decide qué capa se ve y con qué opacidad (antes setOverlay dejaba MOLA con alpha 0). */
  setLayers(view: string, overlay: number) {
    this.view = view; this.overlay = overlay;
    const mola = this.layers.get('mola')!;
    this.layers.forEach((l, k) => {
      const base = k === view, ov = k === 'mola' && view !== 'mola' && overlay > 0;
      l.show = base || ov; l.alpha = base ? 1 : ov ? overlay : 1;
    });
    if (view !== 'mola' && overlay > 0) this.viewer.imageryLayers.raiseToTop(mola); // el overlay siempre encima de la capa base
    this.restack();
  }
  /** Orden fijo: capa base → relieve MOLA → mapa modelado → sombreado (siempre arriba, para que se vea el terreno). */
  private restack() {
    if (this.field) this.viewer.imageryLayers.raiseToTop(this.field);
    this.hill.forEach(l => this.viewer.imageryLayers.raiseToTop(l));
    this.kick();
  }
  /** Mapa temático modelado (radiación o temperatura). `id = null` lo quita. */
  setField(id: FieldId | null, night: boolean, alpha: number) {
    if (this.field) { this.viewer.imageryLayers.remove(this.field, true); this.field = undefined; }
    if (id) {
      const p = new FieldProvider(this.ell, FIELDS[id], night) as unknown as C.ImageryProvider;
      this.field = new C.ImageryLayer(p, { alpha });
      this.viewer.imageryLayers.add(this.field);
    }
    this.restack();
  }
  setFieldAlpha(a: number) { if (this.field) { this.field.alpha = a; this.kick(); } }
  /** Encuadra la zona de planeación (el rectángulo que cubre las paradas). */
  flyToArea(m: Bounds) {
    const lon = (m.west + m.east) / 2, lat = (m.south + m.north) / 2, wM = (m.east - m.west) * 111320 * Math.cos(lat * Math.PI / 180), hM = (m.north - m.south) * 110574;
    this.lookAt(this.groundPoint(lon, lat), 0, this.pitchNow(), Math.max(wM, hM) * 0.9, 3);
  }
  /** Paradas del circuito + rutas candidatas (la seleccionada gruesa y opaca, las demás tenues). */
  drawEva(stops: { name: string; at?: LL }[], cands: Candidate[], sel: number) {
    this.evaDs.entities.removeAll(); this.kick();
    const cols = ['#4fc3f7', '#fbbc04', '#ea6a00'];
    cands.forEach((c, i) => this.evaDs.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(c.path.flatMap(p => [p.lon, p.lat])), width: i === sel ? 6 : 3, clampToGround: true,
      material: C.Color.fromCssColorString(cols[i % 3]).withAlpha(i === sel ? 1 : 0.45) } }));
    stops.forEach((s, i) => { if (!s.at) return; this.evaDs.entities.add({ position: C.Cartesian3.fromDegrees(s.at.lon, s.at.lat, 0),
      point: { pixelSize: 13, color: i === 0 ? C.Color.fromCssColorString('#34a853') : C.Color.fromCssColorString('#4fc3f7'), outlineColor: C.Color.WHITE, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: s.name, font: '600 13px Roboto, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(14, -4),
        horizontalOrigin: C.HorizontalOrigin.LEFT, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }); });
  }
  setShade(a: number) { this.shade = a; this.hill.forEach(l => { l.show = a > 0; l.alpha = a; }); this.kick(); }
  setExaggeration(v: number) { this.viewer.scene.verticalExaggeration = v; this.kick(); }
  /** Vuelo a un punto. Lejos (>2000 km) se queda cenital para ver el globo; cerca se coloca de lado (vista de calle) a `range` m del punto. */
  flyTo(lon: number, lat: number, range = 250_000, pitchDeg = this.pitchNow()) {
    if (range > 2e6) { this.viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, range), orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 }, duration: 3 }); return; }
    this.lookAt(this.groundPoint(lon, lat), 0, pitchDeg, range, 3);
  }
  flyToPoi(p: POI) { p.rank === 3 ? this.flyTo(p.lon, p.lat, 45_000) : this.flyTo(p.lon, p.lat, 700_000, this.streetView ? -(this.lookDeg + 15) : -55); }
  home(d = 2.5) { this.viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(-60, 15, 1.6e7), duration: d }); }
  zoom(f: number) { const c = this.viewer.camera; f > 0 ? c.zoomIn(c.positionCartographic.height * f) : c.zoomOut(c.positionCartographic.height * -f); }
  north() { this.viewer.camera.flyTo({ destination: this.viewer.camera.position, orientation: { heading: 0, pitch: this.viewer.camera.pitch, roll: 0 }, duration: 0.6 }); }
  /** Cambia la inclinación pivotando sobre el centro de la pantalla (dp > 0 = más cerca del horizonte). */
  tilt(dp: number) {
    const cam = this.viewer.camera, c = this.screenCenter(); if (!c) { cam.lookUp(C.Math.toRadians(dp)); return; }
    const pitch = Math.min(-3, Math.max(-89, C.Math.toDegrees(cam.pitch) + dp));
    this.lookAt(c, cam.heading, pitch, C.Cartesian3.distance(cam.positionWC, c), 0.6);
  }

  /** La ruta se pega al terreno (clampToGround) en vez de flotar a 3000 m. */
  drawRoute(w: WP[], locked: boolean) {
    this.routeDs.entities.removeAll(); this.kick();
    const col = locked ? C.Color.fromCssColorString('#34a853') : C.Color.fromCssColorString('#fbbc04');
    if (w.length > 1) this.routeDs.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(w.flatMap(p => [p.lon, p.lat])), width: 5, clampToGround: true,
      arcType: C.ArcType.GEODESIC, material: col } });
    w.forEach((p, i) => this.routeDs.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      point: { pixelSize: 12, color: col, outlineColor: C.Color.WHITE, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: i === 0 ? 'A' : i === w.length - 1 ? 'B' : String(i), font: '600 12px sans-serif', fillColor: C.Color.BLACK, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
  }
  fitRoute(w: WP[]) { if (w.length) this.viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(Math.min(...w.map(p => p.lon)) - 2, Math.min(...w.map(p => p.lat)) - 2, Math.max(...w.map(p => p.lon)) + 2, Math.max(...w.map(p => p.lat)) + 2) }); }
  dispose() { this.dead = true; this.offElev(); this.viewer.destroy(); }
}
