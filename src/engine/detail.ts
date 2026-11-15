/**
 * Micro-relieve procedural (ruido de valor suave, determinista por lon/lat → sin costuras entre teselas).
 * NO es dato medido: solo evita que el suelo se vea como plástico al acercarse. Cada octava se activa
 * solo si la malla puede representarla (longitud de onda ≥ 3× el espaciado de muestreo).
 */
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const sm = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
const OCT = [{ wl: 6000, amp: 30 }, { wl: 2200, amp: 12 }, { wl: 800, amp: 5 }, { wl: 300, amp: 2 }];
const R = 3396190, rad = Math.PI / 180;
export function microRelief(lon: number, lat: number, spacingM: number): number {
  const mx = lon * rad * R, my = lat * rad * R; let s = 0;
  for (const o of OCT) if (o.wl >= spacingM * 3) s += vnoise(mx / o.wl, my / o.wl) * o.amp;
  return s;
}
