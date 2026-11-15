import { COARSE_Z, ELEV_Z, MOLA } from './config';
import { relaxAsync } from './relaxPool';

/**
 * Elevación en dos niveles:
 *  1. Rejilla GRUESA global (MOLA nivel COARSE_Z, 2048×1024, ≈ 10 km/px) que se descarga una sola vez al arrancar (32 teselas).
 *     Da relieve real e INMEDIATO a todo el planeta: el terreno 3D nunca vuelve a ser una esfera lisa a altura 0.
 *  2. Teselas FINAS (MOLA nivel ELEV_Z, ≈ 650 m/px) filtradas en Web Workers, que se cargan bajo demanda alrededor de la cámara.
 * Muestrear nunca devuelve 0 «inventado»: si la tesela fina no está, se usa la gruesa (antes el 0 creaba paredes y huecos).
 */
const N = 256, PAD = 40, M = N + 2 * PAD, COLS = 2 ** (ELEV_Z + 1), ROWS = 2 ** ELEV_Z;
/** Tope de teselas en memoria (LRU). Cada tesela cruda/relajada = 256 KB. */
const MAX_RAW = 192, MAX_ELEV = 320;
/** Tras un fallo, la tesela se da por «resuelta» (se usa la gruesa) y se reintenta pasado este tiempo. */
const RETRY_MS = 60_000;
function cap<V>(m: Map<number, V>, max: number) { while (m.size > max) m.delete(m.keys().next().value as number); }
function touch<V>(m: Map<number, V>, k: number) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; }
/** Clave numérica (sin crear strings en los bucles calientes de muestreo). */
const rk = (x: number, y: number) => y * COLS + x;
export const tileUrl = (tpl: string, z: number, x: number, y: number) =>
  tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

// ── Aviso «hay datos nuevos» (el visor renderiza bajo demanda y debe reintentar las teselas que esperaban) ──
const listeners = new Set<() => void>();
let notifyQueued = false;
export function onElevationReady(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
function notify() { if (notifyQueued) return; notifyQueued = true; setTimeout(() => { notifyQueued = false; listeners.forEach(f => f()); }, 30); }

/** La imagen solo se necesita para decodificarla una vez: no se guarda (la caché HTTP del navegador ya evita re-descargas). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => rej(new Error('tile ' + url)); im.src = url;
  });
}

/**
 * Decodifica la altura (m) desde el color de MOLA (rampa violeta/azul → verde → amarillo → rojo → blanco).
 * Aproximación por tono: azul = bajo, rojo/blanco = alto. Para precisión métrica usa el DEM MOLA real.
 */
export function decodeHeight(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const v = mx / 255, s = mx === 0 ? 0 : d / mx;
  if (s < 0.14 && v > 0.75) return 19000 + (v - 0.75) * 12000; // blanco: cumbres
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const t = 1 - Math.min(h, 270) / 270;
  return -8200 + t * 26000;
}
let decodeCanvas: HTMLCanvasElement | undefined;
function decodeImage(im: HTMLImageElement): Float32Array {
  const c = decodeCanvas ??= document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.clearRect(0, 0, N, N); ctx.drawImage(im, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data, h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = decodeHeight(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  return h;
}

export const tileIndex = (lon: number, lat: number, z = ELEV_Z) => {
  const w = 180 / 2 ** z, cols = 2 ** (z + 1), rows = 2 ** z;
  return { x: Math.min(cols - 1, Math.max(0, Math.floor((lon + 180) / w))), y: Math.min(rows - 1, Math.max(0, Math.floor((90 - lat) / w))), w };
};

// ═════════════════════════ 1. Rejilla gruesa global ═════════════════════════
const CC = 2 ** (COARSE_Z + 1), CR = 2 ** COARSE_Z, CW = CC * N, CH = CR * N;
let coarse: Float32Array | null = null, coarseP: Promise<boolean> | null = null, coarseFailedAt = 0;
/** true si la rejilla gruesa está lista, o si falló hace < 15 s (sin red: se dibuja a 0 en vez de dejar el globo vacío). */
export const coarseReady = () => coarse !== null || Date.now() - coarseFailedAt < 15_000;

/** Mediana 3×3 + gaussiana corta sobre una rejilla rectangular (con vuelta en longitud). Quita el ruido del decodificado por color. */
function smoothCoarse(src: Float32Array): Float32Array {
  const med = new Float32Array(CW * CH), w = new Float32Array(9);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(CH - 1, Math.max(0, y + dy)) * CW;
      for (let dx = -1; dx <= 1; dx++) { const v = src[yy + (x + dx + CW) % CW]; let i = k++; while (i > 0 && w[i - 1] > v) { w[i] = w[i - 1]; i--; } w[i] = v; } }
    med[y * CW + x] = w[4];
  }
  const K = [0.0702, 0.1311, 0.1907, 0.2160, 0.1907, 0.1311, 0.0702], tmp = new Float32Array(CW * CH), out = new Float32Array(CW * CH); // σ≈1.8 px
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { let a = 0; for (let d = -3; d <= 3; d++) a += med[y * CW + (x + d + CW) % CW] * K[d + 3]; tmp[y * CW + x] = a; }
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { let a = 0; for (let d = -3; d <= 3; d++) a += tmp[Math.min(CH - 1, Math.max(0, y + d)) * CW + x] * K[d + 3]; out[y * CW + x] = a; }
  return out;
}

/** Descarga (una sola vez) las 32 teselas MOLA de nivel COARSE_Z. Resuelve true si al menos una cargó. */
export function initCoarse(): Promise<boolean> {
  if (coarseP) return coarseP;
  coarseP = (async () => {
    const g = new Float32Array(CW * CH); let ok = 0;
    await Promise.all(Array.from({ length: CC * CR }, async (_, i) => {
      const x = i % CC, y = Math.floor(i / CC);
      try {
        const h = decodeImage(await loadImage(tileUrl(MOLA.url, COARSE_Z, x, y)));
        for (let j = 0; j < N; j++) g.set(h.subarray(j * N, j * N + N), (y * N + j) * CW + x * N);
        ok++;
      } catch { /* esa zona queda a 0 en la rejilla gruesa (la fina la corrige al acercarse) */ }
    }));
    if (!ok) { coarseP = null; coarseFailedAt = Date.now(); notify(); return false; } // se reintenta pasados 15 s
    coarse = smoothCoarse(g); notify(); return true;
  })();
  return coarseP;
}
/** Altura gruesa (bilineal). 0 solo si la rejilla aún no cargó. */
export function coarseAt(lon: number, lat: number): number {
  const c = coarse; if (!c) return 0;
  const gx = ((((lon + 180) / 360) % 1 + 1) % 1) * CW - 0.5, gy = Math.min(CH - 1, Math.max(0, ((90 - lat) / 180) * CH - 0.5));
  const x0 = Math.floor(gx), y0 = Math.min(CH - 2, Math.floor(gy)), dx = gx - x0, dy = gy - y0;
  const xa = (x0 + CW) % CW, xb = (x0 + 1) % CW, r0 = y0 * CW, r1 = (y0 + 1) * CW;
  return c[r0 + xa] * (1 - dx) * (1 - dy) + c[r0 + xb] * dx * (1 - dy) + c[r1 + xa] * (1 - dx) * dy + c[r1 + xb] * dx * dy;
}

// ═════════════════════════ 2. Teselas finas ═════════════════════════
export interface ElevTile { h: Float32Array }
/** Altura cruda de una tesela (sin filtrar). null si no existe / no carga. */
const rawCache = new Map<number, Promise<Float32Array | null>>();
function getRaw(x: number, y: number): Promise<Float32Array | null> {
  x = ((x % COLS) + COLS) % COLS; if (y < 0 || y >= ROWS) return Promise.resolve(null);
  const k = rk(x, y); let p = touch(rawCache, k);
  if (!p) {
    p = loadImage(tileUrl(MOLA.url, ELEV_Z, x, y)).then(decodeImage).catch(() => { rawCache.delete(k); return null; });
    rawCache.set(k, p); cap(rawCache, MAX_RAW);
  }
  return p;
}

const tileCache = new Map<number, Promise<ElevTile>>();
const ready = new Map<number, ElevTile>();
const failed = new Map<number, number>();
/**
 * Tesela de elevación ya "relajada". Se procesa junto a sus 8 vecinas (margen de 40 px) para que los
 * filtros no creen costuras entre teselas; luego se recorta el centro de 256×256.
 */
export function getElevTile(x: number, y: number): Promise<ElevTile> {
  x = ((x % COLS) + COLS) % COLS;
  const k = rk(x, y); const r0 = touch(ready, k); if (r0) return Promise.resolve(r0);
  let p = touch(tileCache, k);
  if (!p) {
    p = Promise.all(Array.from({ length: 9 }, (_, i) => getRaw(x + (i % 3) - 1, y + Math.floor(i / 3) - 1))).then(async raws => {
      const center = raws[4]; if (!center) throw new Error('tesela MOLA no disponible ' + x + '/' + y);
      const g = new Float32Array(M * M);
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const gx = i - PAD, gy = j - PAD, tx = gx < 0 ? 0 : gx >= N ? 2 : 1, ty = gy < 0 ? 0 : gy >= N ? 2 : 1, t = raws[ty * 3 + tx];
        g[j * M + i] = t ? t[(gy - (ty - 1) * N) * N + (gx - (tx - 1) * N)] : center[Math.min(N - 1, Math.max(0, gy)) * N + Math.min(N - 1, Math.max(0, gx))];
      }
      const r = await relaxAsync(g, M), h = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = r[(j + PAD) * M + i + PAD];
      const t = { h }; ready.set(k, t); cap(ready, MAX_ELEV); failed.delete(k); tileCache.delete(k); notify(); return t;
    });
    p.catch(() => { tileCache.delete(k); failed.set(k, Date.now()); notify(); });
    tileCache.set(k, p); cap(tileCache, MAX_ELEV);
  }
  return p;
}
/** ¿La tesela fina ya está lista o falló hace poco (y se usa la gruesa)? Si no, dispara su carga. */
function settled(x: number, y: number): boolean {
  if (y < 0 || y >= ROWS) return true;
  x = ((x % COLS) + COLS) % COLS; const k = rk(x, y);
  if (touch(ready, k)) return true;
  const f = failed.get(k); if (f !== undefined && Date.now() - f < RETRY_MS) return true;
  getElevTile(x, y).catch(() => {}); return false;
}
/** true si todas las teselas finas que cubren el rectángulo (grados) están resueltas; si no, las pide y devuelve false. */
export function ensureRect(west: number, south: number, east: number, north: number): boolean {
  const e = 1e-9, a = tileIndex(west + e, north - e), b = tileIndex(east - e, south + e); let all = true;
  for (let ty = a.y; ty <= b.y; ty++) for (let tx = a.x; tx <= b.x; tx++) if (!settled(tx, ty)) all = false;
  return all;
}
/** Espera a que estén todas las teselas finas que cubren el rectángulo (grados). Las que fallen quedan con la rejilla gruesa. */
export async function loadRect(west: number, south: number, east: number, north: number): Promise<void> {
  const e = 1e-9, a = tileIndex(west + e, north - e), b = tileIndex(east - e, south + e), jobs: Promise<unknown>[] = [];
  for (let ty = a.y; ty <= b.y; ty++) for (let tx = a.x; tx <= b.x; tx++) jobs.push(getElevTile(tx, ty).catch(() => null));
  await Promise.all([initCoarse(), ...jobs]);
}
/** Pre-carga las teselas finas en un radio (en teselas) alrededor de un punto: el terreno ya está listo al llegar la cámara. */
export function prefetchAround(lon: number, lat: number, radius = 1) {
  const { x, y } = tileIndex(lon, lat);
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) settled(x + dx, y + dy);
}

/** Texel global (gx, gy) del mosaico MOLA fino; usa la tesela que lo contiene (continuo entre teselas). */
function texel(gx: number, gy: number, fallback: ElevTile, fx: number, fy: number): number {
  const tx = Math.floor(gx / N), ty = Math.floor(gy / N);
  const t = ty < 0 || ty >= ROWS ? undefined : ready.get(rk(((tx % COLS) + COLS) % COLS, ty));
  if (t) return t.h[(gy - ty * N) * N + (gx - tx * N)];
  return fallback.h[Math.min(N - 1, Math.max(0, gy - fy * N)) * N + Math.min(N - 1, Math.max(0, gx - fx * N))];
}
function sampleFine(lon: number, lat: number, t: ElevTile, tx: number, ty: number) {
  const gx = ((lon + 180) / 360) * COLS * N - 0.5, gy = ((90 - lat) / 180) * ROWS * N - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), dx = gx - x0, dy = gy - y0;
  const a = texel(x0, y0, t, tx, ty), b = texel(x0 + 1, y0, t, tx, ty), c = texel(x0, y0 + 1, t, tx, ty), d = texel(x0 + 1, y0 + 1, t, tx, ty);
  return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}
/** Altura síncrona: fina si está lista, si no la gruesa. Nunca dispara cargas (para bucles calientes). */
export function heightNow(lon: number, lat: number): number {
  const { x, y } = tileIndex(lon, lat), t = ready.get(rk(x, y));
  return t ? sampleFine(lon, lat, t, x, y) : coarseAt(lon, lat);
}
export async function elevationAt(lon: number, lat: number): Promise<number> {
  const { x, y } = tileIndex(lon, lat);
  try { const t = await getElevTile(x, y); return sampleFine(lon, lat, t, x, y); }
  catch { if (await initCoarse()) return coarseAt(lon, lat); throw new Error('sin elevación'); }
}
/** Versión síncrona para la interfaz (cursor, cámara): fina, o gruesa mientras carga la fina; undefined si no hay ninguna. */
export function elevationNow(lon: number, lat: number): number | undefined {
  const { x, y } = tileIndex(lon, lat), t = ready.get(rk(x, y));
  if (t) return sampleFine(lon, lat, t, x, y);
  getElevTile(x, y).catch(() => {});
  return coarse ? coarseAt(lon, lat) : undefined;
}
