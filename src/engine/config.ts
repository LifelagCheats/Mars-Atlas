/** Elipsoide de Marte (IAU 2000): a = 3396.19 km, c = 3376.20 km */
export const MARS = { a: 3396190, b: 3396190, c: 3376200 };

/**
 * Teselas NASA Trek (WMTS, EPSG:4326, nivel 0 = 2x1 teselas, orden z/y/x).
 * ⚠ Verifica nombres/extensiones/niveles máximos en:
 *   https://trek.nasa.gov/tiles/Mars/EQ/<capa>/1.0.0/WMTSCapabilities.xml
 */
const T = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const API = 'https://api.nasa.gov/mars-wmts/catalog/';
const tpl = (layer: string, ext: string, base = T) => `${base}${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
/**
 * THEMIS: los nombres anteriores (`Mars_MO_THEMIS-IR-…_clon0_ly`) NO existen en Trek (su WMTSCapabilities.xml da error).
 * Los válidos, verificados en https://trek.nasa.gov/tiles/Mars/EQ/<capa>/1.0.0/WMTSCapabilities.xml (15-nov-2026):
 *   THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018   · image/png · niveles 0–9 · lat −65°..65°
 *   THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018 · image/png · niveles 0–9 · lat −65°..65°
 */
const DAY = 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', NIGHT = 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018';
/** Cobertura de los mosaicos THEMIS (fuera de ella no se piden teselas: evita 404 y huecos). */
const THEMIS_RECT: [number, number, number, number] = [-180, -65, 180, 65];

export interface ViewDef { id: string; name: string; desc: string; url: string; alt?: string[]; maxLevel: number; rect?: [number, number, number, number] }
export const VIEWS: ViewDef[] = [
  { id: 'viking',  name: 'Normal (Viking)',     desc: 'Mosaico de color Viking MDIM 2.1, 232 m/px', url: tpl('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'), maxLevel: 7 },
  { id: 'mola',    name: 'Topográfica (MOLA)',  desc: 'Altimetría MGS MOLA coloreada y sombreada',   url: tpl('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'), maxLevel: 6 },
  { id: 'thermal', name: 'Térmica (THEMIS IR)', desc: 'Infrarrojo diurno THEMIS (Mars Odyssey), mosaico controlado 100 m/px, entre 65° S y 65° N',
    url: tpl(DAY, 'png'), alt: [tpl(DAY, 'png', API)], maxLevel: 9, rect: THEMIS_RECT },
  { id: 'night',   name: 'Térmica nocturna',    desc: 'Infrarrojo nocturno THEMIS, mosaico controlado 100 m/px, entre 65° S y 65° N',
    url: tpl(NIGHT, 'png'), alt: [tpl(NIGHT, 'png', API)], maxLevel: 9, rect: THEMIS_RECT },
];
/**
 * Capas TES (MGS) de Trek: dato MEDIDO, global, pero muy grueso (solo niveles 0-1, ≈ 20 km/px).
 * Sirven de contexto climático, no para mirar de cerca. Verificadas en su WMTSCapabilities.xml (15-nov-2026).
 */
VIEWS.push(
  { id: 'inertia', name: 'Inercia térmica (TES)', desc: 'MGS TES: cuánto calor retiene el suelo (roca y costras alta; polvo suelto baja). Dato medido, ≈ 20 km/px', url: tpl('TES_Thermal_Inertia', 'png'), maxLevel: 1 },
  { id: 'dust',    name: 'Polvo (TES)',           desc: 'MGS TES: cubierta de polvo de la superficie. Dato medido, ≈ 20 km/px',                                        url: tpl('TES_Dust', 'png'),           maxLevel: 1 },
);
export const MOLA = VIEWS[1];
/** Nivel de las teselas MOLA de alta resolución usadas para elevación (cada tesela = 2.8° ≈ 166 km) */
export const ELEV_Z = 6;
/** Nivel de la rejilla MOLA global gruesa (8×4 teselas, ≈ 10 km/px) que se carga al arrancar: da relieve inmediato a todo el planeta. */
export const COARSE_Z = 2;
/** Desde este nivel de terreno se usa la elevación de alta resolución (ELEV_Z); por debajo, la rejilla gruesa (instantánea). */
export const HIRES_MIN_LEVEL = 6;
