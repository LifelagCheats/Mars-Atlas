export interface POI { name: string; lon: number; lat: number; rank: 1 | 2 | 3; kind: string; note: string }
// rank 1 = visible desde lejos, 3 = solo de cerca
export const POIS: POI[] = [
  { name: 'Olympus Mons', lon: -133.8, lat: 18.65, rank: 1, kind: 'Volcán', note: 'Mayor volcán del Sistema Solar (~21.9 km)' },
  { name: 'Valles Marineris', lon: -59, lat: -13.9, rank: 1, kind: 'Cañón', note: 'Sistema de cañones de ~4000 km' },
  { name: 'Hellas Planitia', lon: 70, lat: -42.4, rank: 1, kind: 'Cuenca', note: 'Cuenca de impacto, ~7 km de profundidad' },
  { name: 'Tharsis', lon: -100, lat: 1, rank: 1, kind: 'Región', note: 'Altiplano volcánico' },
  { name: 'Utopia Planitia', lon: 118, lat: 46.7, rank: 1, kind: 'Llanura', note: 'Zona de Viking 2 / Zhurong' },
  { name: 'Argyre Planitia', lon: -43, lat: -49.7, rank: 2, kind: 'Cuenca', note: 'Cuenca de impacto sur' },
  { name: 'Arsia Mons', lon: -120.5, lat: -8.35, rank: 2, kind: 'Volcán', note: 'Tharsis Montes (sur)' },
  { name: 'Pavonis Mons', lon: -113.4, lat: 0.8, rank: 2, kind: 'Volcán', note: 'Tharsis Montes (centro)' },
  { name: 'Ascraeus Mons', lon: -104.5, lat: 11.8, rank: 2, kind: 'Volcán', note: 'Tharsis Montes (norte)' },
  { name: 'Elysium Mons', lon: 147.2, lat: 24.8, rank: 2, kind: 'Volcán', note: 'Provincia volcánica Elysium' },
  { name: 'Syrtis Major', lon: 69.5, lat: 8.4, rank: 2, kind: 'Llanura', note: 'Región oscura de albedo' },
  { name: 'Planum Boreum', lon: 0, lat: 87, rank: 2, kind: 'Casquete', note: 'Casquete polar norte' },
  { name: 'Planum Australe', lon: 0, lat: -87, rank: 2, kind: 'Casquete', note: 'Casquete polar sur' },
  { name: 'Cráter Jezero', lon: 77.45, lat: 18.38, rank: 3, kind: 'Misión', note: 'Perseverance (2021)' },
  { name: 'Cráter Gale', lon: 137.42, lat: -5.4, rank: 3, kind: 'Misión', note: 'Curiosity (2012), Aeolis Mons' },
  { name: 'Chryse Planitia', lon: -47.9, lat: 22.3, rank: 3, kind: 'Misión', note: 'Viking 1 (1976)' },
  { name: 'Meridiani Planum', lon: -5.5, lat: -1.95, rank: 3, kind: 'Misión', note: 'Opportunity (2004)' },
  { name: 'Gusev', lon: 175.5, lat: -14.6, rank: 3, kind: 'Misión', note: 'Spirit (2004)' },
  { name: 'Elysium Planitia', lon: 135, lat: 4.5, rank: 3, kind: 'Misión', note: 'InSight (2018)' },
];
