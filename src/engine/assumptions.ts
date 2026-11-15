/**
 * Parámetros del planificador EVA. Cada uno dice si es una REFERENCIA citada o un SUPUESTO del equipo.
 * Nada aquí es una especificación validada para Marte: se muestran como estimaciones en la interfaz.
 */
export type Kind = 'referencia' | 'supuesto';
export interface Assumption { value: number; unit: string; kind: Kind; note: string }
const a = (value: number, unit: string, kind: Kind, note: string): Assumption => ({ value, unit, kind, note });
export const A = {
  // ── Fase 1 (terreno y rutas) ──
  slopeLimit: a(20, '°', 'referencia', 'NASA NTRS 20210000827 (EVA lunar) lista caminar hasta 20°. No es especificación del traje para Marte.'),
  slopeCaution: a(15, '°', 'supuesto', 'Umbral para contar "% de ruta en pendiente alta". Sin fuente.'),
  roughRef: a(3, 'm', 'supuesto', 'Desviación local de altura que se considera "muy rugosa" a la escala de la rejilla (celdas de 150 m sobre dato MOLA). Sin fuente.'),
  speedMin: a(2, 'km/h', 'supuesto', 'Velocidad de caminata con traje, extremo lento. Hay pocos datos con traje en Marte (Kluis et al.).'),
  speedMax: a(3.5, 'km/h', 'supuesto', 'Velocidad de caminata con traje, extremo rápido.'),
  stopMin: a(30, 'min', 'supuesto', 'Tiempo por parada para observar/documentar/muestrear.'),
  cell: a(150, 'm', 'supuesto', 'Tamaño de celda de la rejilla de planeación. El dato de elevación es MOLA (≈ 650 m/px), así que celdas más finas solo interpolarían: no se inventa detalle.'),
  // ── Fase 2 (presupuesto) ──
  suitHours: a(8, 'h', 'supuesto', 'Autonomía nominal del traje. El documento usa una EVA de 8 h como escenario; no hay especificación citada (los límites térmicos del traje están pendientes de verificar).'),
  reservePct: a(20, '%', 'supuesto', 'Reserva definida de antemano para duración y agua. Sin fuente.'),
  waterCapL: a(3, 'L', 'supuesto', 'Agua disponible por astronauta. Sin fuente.'),
  waterRateLh: a(0.3, 'L/h', 'supuesto', 'Consumo de agua por hora de EVA. Sin fuente; el modelo metabólico de NASA (Kim et al.) no está implementado.'),
  loadFactor: a(0.85, '×', 'supuesto', 'Factor de velocidad con equipo cargado. Sin fuente.'),
  roverKmh: a(10, 'km/h', 'supuesto', 'Velocidad del rover de apoyo al regresar (la app ya usaba 10 km/h para el rover presurizado).'),
  returnFracPct: a(50, '%', 'supuesto', 'Retorno máximo permitido como % de la autonomía útil. Métrica de diseño propia, no de NASA.'),
  alertReturnH: a(1, 'h', 'supuesto', 'Con alerta de clima espacial activa, retorno máximo permitido desde cualquier punto.'),
  // ── Radiación (referencia) ──
  doseDayMsv: a(0.64, 'mSv/día', 'referencia', 'RAD de Curiosity en Gale, 2012-2013, a −4.4 km sobre el datum. No se midió en Jezero. La app la ajusta por altura (más atmósfera encima = menos dosis), como el mapa de NASA PIA03480.'),
  doseCareer: a(600, 'mSv', 'referencia', 'Límite de dosis de carrera, NASA-STD-3001 (OCHMO).'),
  doseSpe: a(250, 'mSv', 'referencia', 'Límite por evento de partículas solares, NASA-STD-3001 (OCHMO).'),
  // ── Temperatura (referencia + supuestos de forma) ──
  groundMin: a(-83, '°C', 'referencia', 'Suelo de Jezero antes del amanecer (NASA, MEDA).'),
  groundMax: a(5, '°C', 'referencia', 'Suelo de Jezero al mediodía (NASA, MEDA).'),
  airMean: a(-55, '°C', 'referencia', 'Aire medio en Jezero, con diferencias día-noche de 50 a 60 grados (Nature Geoscience).'),
  tMinHour: a(5, 'h', 'supuesto', 'Hora solar local del mínimo de temperatura del suelo (forma de la curva, no medida).'),
  tMaxHour: a(13, 'h', 'supuesto', 'Hora solar local del máximo de temperatura del suelo (forma de la curva, no medida).'),
  // ── Confianza ──
  confHighM: a(250, 'm', 'supuesto', 'Distancia a la traza de Perseverance para confianza "alta".'),
  confMidM: a(1000, 'm', 'supuesto', 'Distancia a la traza de Perseverance para confianza "media" (más lejos: "baja").'),
};
