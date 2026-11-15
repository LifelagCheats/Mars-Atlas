import { Bounds, PLAN_CELL_M } from './area';
import { heightNow } from './elevation';
import { A } from './assumptions';

const R = 3396190, rad = Math.PI / 180;
export interface Grid { w: number; h: number; cellM: number; dx: number; dy: number; west: number; north: number; dLon: number; dLat: number; z: Float32Array; slope: Float32Array; rough: Float32Array }
export interface LL { lon: number; lat: number }

/**
 * Rejilla de planeación: altura, pendiente (°) y rugosidad (|z − media de 8 vecinos|, m) por celda. NaN = sin dato/borde.
 * La altura sale de MOLA (≈ 650 m/px): pendiente y rugosidad describen la forma general del terreno, no obstáculos de escala humana.
 * Llama antes a `prepareArea(b)` o la rejilla se construirá con la elevación global gruesa.
 */
export function buildGrid(m: Bounds, cellM: number = PLAN_CELL_M, maxN = 1400): Grid {
  const cx = Math.max(0.05, Math.cos(((m.north + m.south) / 2) * rad));
  const wM = (m.east - m.west) * rad * R * cx, hM = (m.north - m.south) * rad * R, cell = Math.max(cellM, wM / maxN, hM / maxN);
  const w = Math.max(3, Math.floor(wM / cell)), h = Math.max(3, Math.floor(hM / cell)), dLon = (m.east - m.west) / w, dLat = (m.north - m.south) / h;
  const dx = dLon * rad * R * cx, dy = dLat * rad * R, z = new Float32Array(w * h), slope = new Float32Array(w * h).fill(NaN), rough = new Float32Array(w * h).fill(NaN);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) z[j * w + i] = heightNow(m.west + (i + 0.5) * dLon, m.north - (j + 0.5) * dLat);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = j * w + i, e = z[k + 1], o = z[k - 1], n = z[k - w], s = z[k + w];
    if (!Number.isFinite(z[k] + e + o + n + s)) continue;
    slope[k] = Math.atan(Math.hypot((e - o) / (2 * dx), (n - s) / (2 * dy))) / rad;
    const mean = (e + o + n + s + z[k - w - 1] + z[k - w + 1] + z[k + w - 1] + z[k + w + 1]) / 8; rough[k] = Number.isFinite(mean) ? Math.abs(z[k] - mean) : NaN;
  }
  return { w, h, cellM: cell, dx, dy, west: m.west, north: m.north, dLon, dLat, z, slope, rough };
}
export const toCell = (g: Grid, p: LL): [number, number] => [Math.floor((p.lon - g.west) / g.dLon), Math.floor((g.north - p.lat) / g.dLat)];
export const toLL = (g: Grid, i: number, j: number): LL => ({ lon: g.west + (i + 0.5) * g.dLon, lat: g.north - (j + 0.5) * g.dLat });
const blocked = (g: Grid, k: number) => !(g.slope[k] <= A.slopeLimit.value); // NaN también bloquea

/** Pendiente (°) de la celda que contiene p, o NaN si está fuera de la rejilla / sin dato. */
export function slopeAt(g: Grid, p: LL): number {
  const [i, j] = toCell(g, p); if (i < 0 || j < 0 || i >= g.w || j >= g.h) return NaN; return g.slope[j * g.w + i];
}

/** Celda transitable más cercana (radio ≤ 40 celdas) a la celda pedida. */
export function snap(g: Grid, i: number, j: number): number | null {
  i = Math.min(g.w - 1, Math.max(0, i)); j = Math.min(g.h - 1, Math.max(0, j));
  if (!blocked(g, j * g.w + i)) return j * g.w + i;
  for (let r = 1; r <= 40; r++) { let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue; const k = jj * g.w + ii;
      if (!blocked(g, k) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = k; } }
    if (best >= 0) return best; }
  return null;
}

/** Perfiles de ruta: pesos del costo. cost = distancia × (1 + wS·(pendiente/límite)² + wR·(rugosidad/ref)). Heurístico, sin calibrar. */
export interface Profile { id: string; name: string; wSlope: number; wRough: number }
export const PROFILES: Profile[] = [
  { id: 'safe', name: 'Prudente (evita pendiente y rocas)', wSlope: 14, wRough: 6 },
  { id: 'balanced', name: 'Equilibrada', wSlope: 4, wRough: 2 },
  { id: 'direct', name: 'Directa (más corta)', wSlope: 0.6, wRough: 0.2 },
];
/** Opciones de personalización (solo antes de aprobar). roughMul multiplica el peso de la rugosidad. */
export interface PlanOpts { roughMul: number }
const NB: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function stepLen(g: Grid, di: number, dj: number) { return Math.hypot(di * g.dx, dj * g.dy); }

class Heap { k: number[] = []; v: number[] = [];
  push(key: number, val: number) { let i = this.k.length; this.k.push(key); this.v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; } this.k[i] = key; this.v[i] = val; }
  pop(): number { const top = this.v[0], lk = this.k.pop()!, lv = this.v.pop()!; const n = this.k.length; if (n > 0) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= lk) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; } this.k[i] = lk; this.v[i] = lv; } return top; }
  get size() { return this.k.length; } }

/** A* 8-vecinos. Devuelve índices de celda de a a b, o null si no hay camino. */
export function astar(g: Grid, a: number, b: number, p: Profile): number[] | null {
  const n = g.w * g.h, G = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n), bi = b % g.w, bj = (b / g.w) | 0;
  const heur = (k: number) => Math.hypot(((k % g.w) - bi) * g.dx, (((k / g.w) | 0) - bj) * g.dy), H = new Heap(); G[a] = 0; H.push(heur(a), a);
  const L = A.slopeLimit.value, Rr = A.roughRef.value;
  while (H.size) {
    const k = H.pop(); if (done[k]) continue; done[k] = 1; if (k === b) break;
    const i = k % g.w, j = (k / g.w) | 0;
    for (const [di, dj] of NB) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue; const q = jj * g.w + ii; if (done[q] || blocked(g, q)) continue;
      const s = (g.slope[k] + g.slope[q]) / 2, r = ((g.rough[k] || 0) + (g.rough[q] || 0)) / 2, c = stepLen(g, di, dj) * (1 + p.wSlope * (s / L) ** 2 + p.wRough * (r / Rr));
      const ng = G[k] + c; if (ng < G[q]) { G[q] = ng; from[q] = k; H.push(ng + heur(q), q); } }
  }
  if (from[b] < 0 && a !== b) return null;
  const out = [b]; for (let k = b; k !== a; ) { k = from[k]; out.push(k); } return out.reverse();
}

/** Distancia caminable (m, solo geometría, sin pendientes >límite) desde `src` a cada celda. */
export function distField(g: Grid, src: number): Float32Array {
  const n = g.w * g.h, D = new Float32Array(n).fill(Infinity), H = new Heap(); D[src] = 0; H.push(0, src); const seen = new Uint8Array(n);
  while (H.size) { const k = H.pop(); if (seen[k]) continue; seen[k] = 1; const i = k % g.w, j = (k / g.w) | 0;
    for (const [di, dj] of NB) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue; const q = jj * g.w + ii; if (blocked(g, q)) continue;
      const nd = D[k] + stepLen(g, di, dj); if (nd < D[q]) { D[q] = nd; H.push(nd, q); } } }
  return D;
}

/** `optional` = parada opcional (p. ej. Skrinkle Haven); solo entra en el circuito si el usuario la activa.
 *  `def` = posición precargada (con su fuente en `src`); el usuario puede moverla y «restablecer» vuelve a ella. */
export interface Stop { id: string; name: string; at?: LL; optional?: boolean; def?: LL; src?: string }
export interface Candidate {
  profile: Profile; path: LL[]; lengthM: number; hoursMin: number; hoursMax: number; maxSlope: number; pctCaution: number; meanRough: number;
  maxReturnMinH: number; maxReturnMaxH: number; riskIndex: number; stopsAt: LL[]; elevProfile: { d: number; h: number }[];
  /** Índice de esfuerzo heurístico (1 = llano). NO es el costo metabólico de NASA. */
  effort: number;
  /** Paradas sin contar la Base. */
  nStops: number;
  /** Distancia acumulada (m) y distancia de regreso a la Base (m) en cada punto de `path`. */
  cumM: number[]; backM: number[];
  /** Índices de `path`: [0, llegada a parada 1, …, llegada a parada n, fin (Base)]. */
  stopIdx: number[];
}

/** Circuito Base → paradas → Base con cada perfil; devuelve candidatas ordenadas de menor a mayor índice de riesgo. */
export function planCircuit(g: Grid, stops: Stop[], opts: PlanOpts = { roughMul: 1 }): { candidates: Candidate[]; error?: string } {
  const miss = stops.filter(s => !s.at).map(s => s.name); if (miss.length) return { candidates: [], error: `Falta fijar en el mapa: ${miss.join(', ')}` };
  const cells: number[] = []; for (const s of stops) { const [i, j] = toCell(g, s.at!); const k = snap(g, i, j); if (k === null) return { candidates: [], error: `«${s.name}» queda fuera de la zona o en terreno no transitable.` }; cells.push(k); }
  const circuit = [...cells, cells[0]], back = distField(g, cells[0]), out: Candidate[] = [];
  for (const p of PROFILES) {
    const eff: Profile = { ...p, wRough: p.wRough * opts.roughMul };
    const idx: number[] = [], stopIdx: number[] = [0];
    for (let s = 0; s < circuit.length - 1; s++) {
      const leg = astar(g, circuit[s], circuit[s + 1], eff);
      if (!leg) return { candidates: [], error: `Sin camino transitable entre «${stops[s].name}» y «${stops[(s + 1) % stops.length].name}» (límite ${A.slopeLimit.value}°).` };
      idx.push(...(s ? leg.slice(1) : leg)); stopIdx.push(idx.length - 1);
    }
    let len = 0, mx = 0, caution = 0, rs = 0, rn = 0, ef = 0, maxBack = 0; const prof: { d: number; h: number }[] = [], cumM: number[] = [], backM: number[] = [];
    for (let q = 0; q < idx.length; q++) {
      const k = idx[q]; if (q) { const pk = idx[q - 1]; len += stepLen(g, (k % g.w) - (pk % g.w), ((k / g.w) | 0) - ((pk / g.w) | 0)); }
      const s = g.slope[k]; mx = Math.max(mx, s); if (s > A.slopeCaution.value) caution++; if (Number.isFinite(s)) ef += 1 + 2 * (s / A.slopeLimit.value) ** 2; else ef += 1;
      if (Number.isFinite(g.rough[k])) { rs += g.rough[k]; rn++; } maxBack = Math.max(maxBack, back[k]); prof.push({ d: len / 1000, h: g.z[k] }); cumM.push(len); backM.push(back[k]);
    }
    const nStops = stops.length - 1, stopH = nStops * A.stopMin.value / 60, km = len / 1000, mr = rn ? rs / rn : 0, pc = caution / idx.length;
    const risk = 100 * Math.min(1, 0.5 * (mx / A.slopeLimit.value) + 0.3 * pc * 4 + 0.2 * Math.min(1, mr / A.roughRef.value));
    out.push({ profile: p, path: idx.map(k => toLL(g, k % g.w, (k / g.w) | 0)), lengthM: len, hoursMin: km / A.speedMax.value + stopH, hoursMax: km / A.speedMin.value + stopH, maxSlope: mx, pctCaution: pc * 100, meanRough: mr,
      maxReturnMinH: maxBack / 1000 / A.speedMax.value, maxReturnMaxH: maxBack / 1000 / A.speedMin.value, riskIndex: Math.min(100, risk), stopsAt: cells.map(k => toLL(g, k % g.w, (k / g.w) | 0)), elevProfile: prof,
      effort: ef / idx.length, nStops, cumM, backM, stopIdx });
  }
  return { candidates: out.sort((a, b) => a.riskIndex - b.riskIndex) };
}

/** Contingencia: camino de regreso a la Base desde la posición actual (perfil prudente). null si no hay camino. */
export function planReturn(g: Grid, from: LL, base: LL): { path: LL[]; lengthM: number } | null {
  const [fi, fj] = toCell(g, from), [bi, bj] = toCell(g, base), a = snap(g, fi, fj), b = snap(g, bi, bj); if (a === null || b === null) return null;
  const idx = astar(g, a, b, PROFILES[0]); if (!idx) return null;
  let len = 0; for (let q = 1; q < idx.length; q++) len += stepLen(g, (idx[q] % g.w) - (idx[q - 1] % g.w), ((idx[q] / g.w) | 0) - ((idx[q - 1] / g.w) | 0));
  return { path: idx.map(k => toLL(g, k % g.w, (k / g.w) | 0)), lengthM: len };
}

/** Douglas-Peucker en grados (tolerancia en metros) para convertir el camino en pocos waypoints. */
export function simplify(path: LL[], tolM: number, maxPts = 40): LL[] {
  const kx = rad * R * Math.cos((path[0].lat) * rad), ky = rad * R; const keep = new Uint8Array(path.length); keep[0] = keep[path.length - 1] = 1;
  const dist = (p: LL, a: LL, b: LL) => { const px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky, bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky, L = bx * bx + by * by, t = L ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0; return Math.hypot(px - t * bx, py - t * by); };
  const rec = (s: number, e: number, tol: number) => { let md = 0, mi = -1; for (let i = s + 1; i < e; i++) { const d = dist(path[i], path[s], path[e]); if (d > md) { md = d; mi = i; } } if (md > tol && mi >= 0) { keep[mi] = 1; rec(s, mi, tol); rec(mi, e, tol); } };
  let tol = tolM; for (;;) { keep.fill(0); keep[0] = keep[path.length - 1] = 1; rec(0, path.length - 1, tol); if (keep.reduce((a, b) => a + b, 0) <= maxPts) break; tol *= 1.6; }
  return path.filter((_, i) => keep[i]);
}
