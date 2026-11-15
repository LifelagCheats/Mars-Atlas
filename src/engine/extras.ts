import * as C from 'cesium';
import { ELEV_Z, VIEWS } from './config';
import type { Bounds } from './area';
import type { LL } from './planning';

/** Capas que se añaden al visor sin tocar MarsEngine: posición simulada, contingencia, traza del rover y capa externa (p. ej. CRISM). */
export class EvaExtras {
  private ds = new C.CustomDataSource('eva-extras'); private ext?: C.ImageryLayer;
  constructor(private viewer: C.Viewer) { viewer.dataSources.add(this.ds); }
  private clear(id: string) { const e = this.ds.entities.getById(id); if (e) this.ds.entities.remove(e); this.kick(); }
  /** El visor renderiza bajo demanda: tras cambiar entidades hay que pedir fotograma (ahora y un poco después, por las primitivas asíncronas). */
  private kick() { const go = () => { if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender(); }; go(); setTimeout(go, 250); setTimeout(go, 1000); }

  drawTrace(pts: LL[] | null) {
    this.clear('trace'); if (!pts || pts.length < 2) return;
    this.ds.entities.add({ id: 'trace', polyline: { positions: C.Cartesian3.fromDegreesArray(pts.flatMap(p => [p.lon, p.lat])), width: 2, clampToGround: true, material: new C.PolylineDashMaterialProperty({ color: C.Color.WHITE.withAlpha(0.85), dashLength: 12 }) } });
  }
  drawAstronaut(p: LL | null) {
    this.clear('astro'); if (!p) return;
    this.ds.entities.add({ id: 'astro', position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      point: { pixelSize: 16, color: C.Color.fromCssColorString('#ffffff'), outlineColor: C.Color.fromCssColorString('#d93025'), outlineWidth: 4, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: 'Astronauta (simulado)', font: '600 12px Roboto, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(14, 14),
        horizontalOrigin: C.HorizontalOrigin.LEFT, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  }
  drawContingency(path: LL[] | null) {
    this.clear('cont'); if (!path || path.length < 2) return;
    this.ds.entities.add({ id: 'cont', polyline: { positions: C.Cartesian3.fromDegreesArray(path.flatMap(p => [p.lon, p.lat])), width: 6, clampToGround: true, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString('#d93025'), gapColor: C.Color.WHITE.withAlpha(0.7), dashLength: 16 }) } });
  }
  /** Capa externa por plantilla de teselas {z}/{x}/{y} (EPSG:4326, mismo esquema que las demás). Queda debajo del sombreado. */
  setExternal(url: string | null, maxLevel = 8, alpha = 0.7) {
    if (this.ext) { this.viewer.imageryLayers.remove(this.ext, true); this.ext = undefined; }
    if (!url) return;
    const ell = this.viewer.scene.globe.ellipsoid;
    const provider = new C.UrlTemplateImageryProvider({ url, tilingScheme: new C.GeographicTilingScheme({ ellipsoid: ell }), maximumLevel: maxLevel, tileWidth: 256, tileHeight: 256, credit: 'Capa externa (indicada por el usuario)' });
    this.ext = new C.ImageryLayer(provider, { alpha }); this.viewer.imageryLayers.add(this.ext); this.viewer.imageryLayers.lower(this.ext); this.kick();
  }
  setExternalAlpha(a: number) { if (this.ext) { this.ext.alpha = a; this.kick(); } }
  dispose() { this.viewer.dataSources.remove(this.ds, true); }
}

const CACHE = 'mars-tiles-v1';
export const offlineSupported = () => typeof caches !== 'undefined';
/**
 * Guarda en caché (Cache API; el service worker public/sw.js las sirve sin conexión) las teselas de todas las vistas que cubren
 * la zona de planeación, más las vecinas MOLA de nivel de elevación. Devuelve cuántas se guardaron / fallaron.
 */
export async function precacheZone(m: Bounds, onProgress?: (done: number, total: number) => void): Promise<{ saved: number; failed: number; total: number }> {
  if (!offlineSupported()) throw new Error('Este navegador no tiene Cache API');
  const urls = new Set<string>(), fill = (tpl: string, z: number, x: number, y: number) => tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const range = (z: number, pad: number) => {
    const w = 180 / 2 ** z, cols = 2 ** (z + 1), rows = 2 ** z, x0 = Math.floor((m.west + 180) / w) - pad, x1 = Math.floor((m.east + 180) / w) + pad, y0 = Math.floor((90 - m.north) / w) - pad, y1 = Math.floor((90 - m.south) / w) + pad;
    const out: [number, number][] = []; for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++) for (let x = x0; x <= x1; x++) out.push([((x % cols) + cols) % cols, y]); return out;
  };
  for (const v of VIEWS) for (let z = 0; z <= v.maxLevel; z++) for (const [x, y] of range(z, z === ELEV_Z && v.id === 'mola' ? 1 : 0)) urls.add(fill(v.url, z, x, y));
  const list = [...urls]; if (list.length > 3000) throw new Error(`Demasiadas teselas (${list.length}); la zona de paradas es demasiado grande`);
  const cache = await caches.open(CACHE); let done = 0, saved = 0, failed = 0, next = 0;
  const worker = async () => { while (next < list.length) { const u = list[next++]; try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { await cache.put(u, r); saved++; } else failed++; } } catch { failed++; } onProgress?.(++done, list.length); } };
  await Promise.all(Array.from({ length: 6 }, worker)); return { saved, failed, total: list.length };
}
