import * as C from 'cesium';
import { HIRES_MIN_LEVEL } from './config';
import { coarseAt, coarseReady, ensureRect, heightNow, initCoarse } from './elevation';
import { microRelief } from './detail';

/** Nivel a partir del cual MOLA (≈460 m/px) ya no aporta detalle: más profundo Cesium sobremuestrea el padre. */
export const MOLA_MAX_LEVEL = 9;
const SIZE = 65, R = 3396190, rad = Math.PI / 180;
export const DETAIL = true;

/**
 * ¿Hay datos para muestrear este rectángulo YA? (síncrono). Niveles bajos: basta la rejilla gruesa global.
 * Niveles altos: además las teselas finas que lo cubren. Si falta algo, se dispara su carga y devuelve false:
 * el proveedor responde «undefined» (= Cesium reintenta en otro fotograma) y mientras tanto sigue mostrando la tesela padre,
 * que ya tiene relieve real. Así nunca se dibuja una tesela plana a altura 0 junto a otra con relieve (paredes y huecos).
 */
export function heightsReady(west: number, south: number, east: number, north: number, level: number): boolean {
  if (!coarseReady()) { initCoarse(); return false; }
  return level < HIRES_MIN_LEVEL || ensureRect(west, south, east, north);
}

/** Muestrea alturas (síncrono; llamar solo si heightsReady devolvió true). */
export function sampleHeights(west: number, south: number, east: number, north: number, nx: number, ny: number, level: number): Float32Array<ArrayBuffer> {
  const hires = level >= HIRES_MIN_LEVEL;
  const out = new Float32Array(nx * ny), dLon = (east - west) / (nx - 1), dLat = (north - south) / (ny - 1);
  const spacing = Math.min(dLon * rad * R * Math.cos(((north + south) / 2) * rad), dLat * rad * R);
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const lon = west + j * dLon, lat = north - i * dLat;
    const base = hires ? heightNow(lon, lat) : coarseAt(lon, lat);
    out[i * nx + j] = base + (DETAIL && hires ? microRelief(lon, lat, Math.max(1, spacing)) : 0);
  }
  return out;
}

/**
 * TerrainProvider real para Cesium: la altura sale de MOLA (rejilla gruesa global + teselas finas relajadas, ver filters.ts)
 * y TODAS las capas de imagen se proyectan encima del relieve. Hay relieve en todos los niveles (ya no hay esfera lisa).
 */
export class MarsTerrain {
  readonly tilingScheme: C.GeographicTilingScheme;
  readonly errorEvent = new C.Event();
  readonly credit = new C.Credit('NASA MGS MOLA');
  readonly hasWaterMask = false;
  readonly hasVertexNormals = false;
  readonly availability = undefined;
  constructor(private ell: C.Ellipsoid) { this.tilingScheme = new C.GeographicTilingScheme({ ellipsoid: ell }); }

  getLevelMaximumGeometricError(level: number) {
    return C.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(this.ell, SIZE, 2) / 2 ** level;
  }
  /** ¿Existe geometría propia para esta tesela? Hasta MOLA_MAX_LEVEL sí; más profundo Cesium sobremuestrea el padre (barato). */
  private has(_x: number, _y: number, level: number) { return level <= MOLA_MAX_LEVEL; }
  /** Máscara de hijos disponibles (1=SO, 2=SE, 4=NO, 8=NE). Los que faltan los sobremuestrea Cesium desde el padre (barato). */
  private childMask(x: number, y: number, level: number) {
    return this.has(x, y, level + 1) ? 0b1111 : 0;
  }
  getTileDataAvailable(x: number, y: number, level: number) { return this.has(x, y, level); }
  loadTileDataAvailability() { return undefined; }

  /** Devuelve undefined («reintenta luego») mientras faltan datos: Cesium sigue mostrando el padre con relieve real. */
  requestTileGeometry(x: number, y: number, level: number): Promise<C.TerrainData> | undefined {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level), d = C.Math.toDegrees;
    const w = d(r.west), s = d(r.south), e = d(r.east), n = d(r.north);
    if (!heightsReady(w, s, e, n, level)) return undefined;
    const buf = sampleHeights(w, s, e, n, SIZE, SIZE, level);
    return Promise.resolve(new C.HeightmapTerrainData({ buffer: buf, width: SIZE, height: SIZE, childTileMask: this.childMask(x, y, level) }));
  }
}

/**
 * Capa de sombreado de relieve generada al vuelo desde la elevación (luz NO, 40° sobre el horizonte).
 * Oscurece laderas en sombra y aclara las iluminadas sobre CUALQUIER capa base: da volumen a colinas y lomas.
 */
export interface HillOpts { maxLevel?: number; rect?: C.Rectangle; z?: number; azimuth?: number; altitude?: number }
export class HillshadeProvider {
  readonly tilingScheme: C.GeographicTilingScheme; readonly rectangle: C.Rectangle;
  readonly tileWidth = 256; readonly tileHeight = 256; readonly minimumLevel = 0; readonly maximumLevel: number;
  readonly tileDiscardPolicy = undefined; readonly errorEvent = new C.Event(); readonly credit = undefined; readonly proxy = undefined;
  readonly hasAlphaChannel = true; readonly ready = true; readonly readyEvent = new C.Event(); readonly readyPromise = Promise.resolve(true);
  private blank: HTMLCanvasElement; private z: number; private azimuth: number; private altitude: number;
  /** El sombreado se calcula en una rejilla de 128×128 (4× menos muestras) y se estira a 256×256: es una imagen suave, no pierde detalle útil. */
  private static readonly N = 128;
  constructor(ell: C.Ellipsoid, o: HillOpts = {}) {
    this.z = o.z ?? 4; this.azimuth = o.azimuth ?? 315; this.altitude = o.altitude ?? 40; this.maximumLevel = o.maxLevel ?? MOLA_MAX_LEVEL;
    this.tilingScheme = new C.GeographicTilingScheme({ ellipsoid: ell }); this.rectangle = o.rect ?? this.tilingScheme.rectangle;
    this.blank = document.createElement('canvas'); this.blank.width = this.blank.height = 256;
  }
  getTileCredits() { return []; }
  pickFeatures() { return undefined; }

  /** undefined = «reintenta luego» (los datos de elevación aún cargan); Cesium mantiene la imagen del padre mientras tanto. */
  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> | undefined {
    if (level < 2) return Promise.resolve(this.blank);
    try {
      const r = this.tilingScheme.tileXYToRectangle(x, y, level), d = C.Math.toDegrees, N = HillshadeProvider.N, G = N + 2;
      const west = d(r.west), east = d(r.east), north = d(r.north), south = d(r.south), px = (east - west) / N, py = (north - south) / N;
      // rejilla de 130×130 (1 texel de margen) para derivadas centradas; los centros de píxel quedan en +0.5
      const W = west - px * 0.5, S = south - py * 0.5, E = east + px * 0.5, Nn = north + py * 0.5;
      if (!heightsReady(W, S, E, Nn, level)) return undefined;
      const h = sampleHeights(W, S, E, Nn, G, G, level);
      const midLat = (north + south) / 2, cx = Math.max(0.05, Math.cos(midLat * rad)), dx = (px * rad * R * cx), dy = py * rad * R;
      const az = this.azimuth * rad, alt = this.altitude * rad, L = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)], flat = L[2];
      const small = document.createElement('canvas'); small.width = small.height = N; const sctx = small.getContext('2d')!, img = sctx.createImageData(N, N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const gi = (j + 1) * G + i + 1, ze = ((h[gi + 1] - h[gi - 1]) / (2 * dx)) * this.z, zn = ((h[gi - G] - h[gi + G]) / (2 * dy)) * this.z;
        const inv = 1 / Math.hypot(ze, zn, 1), s = (-ze * L[0] - zn * L[1] + L[2]) * inv - flat, k = (j * N + i) * 4;
        const v = s < 0 ? 0 : 255, a = s < 0 ? Math.min(0.75, -s * 1.7) : Math.min(0.35, s * 0.9);
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = Math.round(a * 255);
      }
      sctx.putImageData(img, 0, 0);
      const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, 256, 256); return Promise.resolve(c);
    } catch { return Promise.resolve(this.blank); }
  }
}
