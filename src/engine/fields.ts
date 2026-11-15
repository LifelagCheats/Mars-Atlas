import * as C from 'cesium';
import { HIRES_MIN_LEVEL } from './config';
import { coarseAt, heightNow } from './elevation';
import { heightsReady, MOLA_MAX_LEVEL } from './terrain';
import { radiationMsvDay, tempK } from './analysis';

/**
 * Mapas temáticos MODELADOS que se pintan sobre el globo. No son teselas de NASA: se calculan aquí,
 * píxel a píxel, con los MISMOS modelos que usa el panel de Ruta, de modo que el mapa y las cifras siempre coinciden.
 * La única entrada medida es la altura MOLA de cada punto.
 */
export type FieldId = 'radiation' | 'temp';

export interface Scale { lo: number; hi: number; loLabel: string; hiLabel: string }
export interface FieldDef {
  id: FieldId; name: string; desc: string; unit: string;
  /** Extremos de la escala de color (los valores fuera se recortan). Cambian entre día y noche. */
  scale(night: boolean): Scale;
  /** Rampa secuencial de un solo tono, claro → oscuro. */
  ramp: string[];
  /** true si el valor ALTO es el extremo oscuro de la rampa (radiación); false si lo oscuro es el valor bajo (frío). */
  darkIsHigh: boolean;
  value(lon: number, lat: number, h: number, night: boolean): number;
  method: string;
}

/** Rampa secuencial azul del sistema de diseño (100 → 700). Oscuro = más frío. */
const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
/** Rampa secuencial naranja, con el mismo escalonado de luminosidad que la azul. Oscuro = más dosis. */
const ORANGE = ['#ffd4c3', '#ffa787', '#f87949', '#d75b29', '#b14313', '#8c2c00', '#681400'];

export const FIELDS: Record<FieldId, FieldDef> = {
  radiation: {
    id: 'radiation', name: 'Radiación en superficie', desc: 'Dosis diaria estimada de rayos cósmicos galácticos',
    unit: 'mSv/día', scale: () => ({ lo: 0.58, hi: 0.76, loLabel: '0.58', hiLabel: '0.76' }), ramp: ORANGE, darkIsHigh: true,
    value: (_lon, _lat, h) => radiationMsvDay(h),
    method: 'Mismo método que el mapa de NASA de 2002 (PIA03480): la atmósfera es el único escudo, así que la dosis se deriva de la altura MOLA de cada punto. Anclado en los 0.64 mSv/día que midió RAD (Curiosity) en Gale, a −4.4 km, y limitado arriba por la dosis en órbita que midió MARIE (Mars Odyssey). Cuanto más bajo el terreno, más atmósfera encima y menos dosis. NO incluye eventos de partículas solares, que son el riesgo real.',
  },
  temp: {
    id: 'temp', name: 'Temperatura del suelo', desc: 'Modelo simple por latitud y altura, de día o de noche',
    unit: '°C', ramp: BLUE, darkIsHigh: false,
    scale: night => night ? { lo: -130, hi: -65, loLabel: '≤ −130', hiLabel: '≥ −65' } : { lo: -75, hi: 0, loLabel: '≤ −75', hiLabel: '≥ 0' },
    value: (_lon, lat, h, night) => tempK(lat, h, !night) - 273.15,
    method: 'Ajuste propio por latitud y altura, el mismo que usa el panel de Ruta. NO es un modelo climático: no tiene estaciones, ni hora local, ni inercia térmica del terreno, ni polvo. Para dato MEDIDO usa las vistas THEMIS (infrarrojo diurno y nocturno). La escala está recortada en los dos extremos para que se lea bien la franja donde cae casi todo el planeta: los polos y las cumbres de Tharsis salen del color más oscuro, y ahí además el ajuste ya no es razonable.',
  },
};

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Color de la rampa en t ∈ [0,1] (interpolación entre pasos contiguos). */
export function rampColor(ramp: string[], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
  const a = rgb(ramp[i]), b = rgb(ramp[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** CSS del degradado de la leyenda, de `lo` a `hi`. */
export const rampCss = (f: FieldDef) => `linear-gradient(to right, ${(f.darkIsHigh ? f.ramp : [...f.ramp].reverse()).join(', ')})`;

/** Proveedor de imágenes que pinta un campo escalar. Calcula en 64×64 y lo estira a 256×256: es un mapa suave, sin detalle falso. */
export class FieldProvider {
  readonly tilingScheme: C.GeographicTilingScheme; readonly rectangle: C.Rectangle;
  readonly tileWidth = 256; readonly tileHeight = 256; readonly minimumLevel = 0; readonly maximumLevel = MOLA_MAX_LEVEL;
  readonly tileDiscardPolicy = undefined; readonly errorEvent = new C.Event(); readonly proxy = undefined;
  readonly credit = new C.Credit('Modelado · altura NASA MGS MOLA');
  readonly hasAlphaChannel = true; readonly ready = true; readonly readyEvent = new C.Event(); readonly readyPromise = Promise.resolve(true);
  private static readonly N = 64;
  constructor(ell: C.Ellipsoid, private f: FieldDef, private night: boolean) {
    this.tilingScheme = new C.GeographicTilingScheme({ ellipsoid: ell }); this.rectangle = this.tilingScheme.rectangle;
  }
  getTileCredits() { return []; }
  pickFeatures() { return undefined; }

  /** undefined = «reintenta luego» mientras carga la elevación; Cesium mantiene la imagen del padre. */
  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> | undefined {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level), d = C.Math.toDegrees;
    const west = d(r.west), east = d(r.east), north = d(r.north), south = d(r.south);
    if (!heightsReady(west, south, east, north, level)) return undefined;
    const hires = level >= HIRES_MIN_LEVEL, N = FieldProvider.N, f = this.f;
    const sc = f.scale(this.night), span = sc.hi - sc.lo;
    const small = document.createElement('canvas'); small.width = small.height = N;
    const sctx = small.getContext('2d')!, img = sctx.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lon = west + ((i + 0.5) / N) * (east - west), lat = north - ((j + 0.5) / N) * (north - south);
      const h = hires ? heightNow(lon, lat) : coarseAt(lon, lat);
      const t = (f.value(lon, lat, h, this.night) - sc.lo) / span;
      const [cr, cg, cb] = rampColor(f.ramp, f.darkIsHigh ? t : 1 - t), k = (j * N + i) * 4;
      img.data[k] = cr; img.data[k + 1] = cg; img.data[k + 2] = cb; img.data[k + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, 256, 256); return Promise.resolve(c);
  }
}
