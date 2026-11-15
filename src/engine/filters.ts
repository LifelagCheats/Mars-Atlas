/**
 * Filtros puros (sin DOM) que convierten la altura "cruda" (decodificada del color MOLA, con bandas y agujas)
 * en un relieve continuo con colinas, lomas y laderas redondeadas.
 */

/** Mediana 3×3: elimina agujas de 1-2 px (sal y pimienta). */
export function median3(src: Float32Array, W: number): Float32Array {
  const out = new Float32Array(W * W), w = new Float32Array(9);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = src[Math.min(W - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))];
      let i = k++; while (i > 0 && w[i - 1] > v) { w[i] = w[i - 1]; i--; } w[i] = v;
    }
    out[y * W + x] = w[4];
  }
  return out;
}

/** Gaussiana separable real (no cajas): suaviza bandas/terrazas sin crear picos. */
export function gaussian(src: Float32Array, W: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * W), out = new Float32Array(W * W), cl = (v: number) => Math.min(W - 1, Math.max(0, v));
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { let a = 0; for (let d = -r; d <= r; d++) a += src[y * W + cl(x + d)] * k[d + r]; tmp[y * W + x] = a; }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { let a = 0; for (let d = -r; d <= r; d++) a += tmp[cl(y + d) * W + x] * k[d + r]; out[y * W + x] = a; }
  return out;
}

/**
 * Compresión suave del detalle local ("redondeo de crestas"): h' = base + D·tanh((h - base)/D).
 * Lo que sobresale poco de su entorno (lomas) queda casi igual; lo que sobresale mucho en poco espacio
 * (agujas, bordes duros) se aplana de forma suave. Las estructuras grandes (volcanes, cuencas) no cambian.
 */
export function compress(src: Float32Array, W: number, sigma: number, D: number): Float32Array {
  const base = gaussian(src, W, sigma), out = new Float32Array(W * W);
  for (let i = 0; i < out.length; i++) out[i] = base[i] + D * Math.tanh((src[i] - base[i]) / D);
  return out;
}

/**
 * Erosión térmica (talud): donde la diferencia con un vecino supera el ángulo de reposo, el material baja
 * hacia los vecinos más bajos. Redondea cimas y esquinas y rellena pozos, como el derrubio de una ladera real.
 */
export function thermal(h: Float32Array, W: number, iters: number, talus: number, k = 0.5) {
  const d = new Float32Array(W * W), ex = new Float32Array(8);
  const DX = [-1, 1, 0, 0, -1, 1, -1, 1], DY = [0, 0, -1, 1, -1, -1, 1, 1], DS = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  for (let it = 0; it < iters; it++) {
    d.fill(0);
    for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, hi = h[i]; let sum = 0, mx = 0;
      for (let n = 0; n < 8; n++) { const e = hi - h[(y + DY[n]) * W + x + DX[n]] - talus * DS[n]; ex[n] = e > 0 ? e : 0; sum += ex[n]; if (ex[n] > mx) mx = ex[n]; }
      if (sum > 0) { const m = k * mx * 0.5; d[i] -= m; for (let n = 0; n < 8; n++) if (ex[n] > 0) d[(y + DY[n]) * W + x + DX[n]] += (m * ex[n]) / sum; }
    }
    for (let i = 0; i < h.length; i++) h[i] += d[i];
  }
}

export interface RelaxOpts { cell: number; talusDeg: number; iters: number; D: number }
export const RELAX: RelaxOpts = { cell: 650, talusDeg: 18, iters: 14, D: 900 };
/** Pipeline completo: despinchar → gaussiana → compresión de crestas → talud → pulido final. */
export function relax(raw: Float32Array, W: number, o: RelaxOpts = RELAX): Float32Array {
  let h = gaussian(median3(raw, W), W, 2.5);
  h = compress(h, W, 10, o.D);
  thermal(h, W, o.iters, Math.tan((o.talusDeg * Math.PI) / 180) * o.cell);
  return gaussian(h, W, 1.2);
}
