# Cambios: mapas de radiación y temperatura, capas TES, descripciones al pasar el ratón

## 1. Dos mapas temáticos nuevos (pestaña Capas → «Mapas modelados»)
Se pintan sobre el globo, con leyenda, control de opacidad y un selector día/noche en el de temperatura.
No son teselas de NASA: se calculan en el navegador con **los mismos modelos que usa el panel de Ruta**,
así que el mapa y las cifras del panel siempre coinciden. La única entrada medida es la altura MOLA.

**Radiación en superficie (0.58 – 0.76 mSv/día).** Mismo método que el mapa de NASA de 2002 (PIA03480):
la atmósfera es el único escudo, así que la dosis se deriva de la altura de cada punto. Cuanto más bajo
el terreno, más aire encima y menos dosis.

De paso corregí el modelo de radiación, que estaba mal en dos cosas:
- Anclaba los 0.64 mSv/día de RAD a altura 0, pero Curiosity los midió en Gale, a −4.4 km.
- Con `max(0, h)` todas las tierras bajas daban lo mismo, así que Hellas salía igual que el datum.
  Ahora la dosis baja al bajar el terreno, que es lo que muestra el mapa de NASA.
- El techo ya no es arbitrario: sale de la razón entre lo que midió MARIE en órbita (0.25 mGy/día) y lo
  que midió RAD en superficie (0.21 mGy/día). El blindaje atmosférico de Marte resulta ser modesto, un 19 %.

Rango global resultante: 0.59 (Hellas) · 0.64 (Gale) · 0.66 (Jezero) · 0.68 (datum) · 0.75 (Olympus Mons).

**Temperatura del suelo (día −75…0 °C · noche −130…−65 °C).** Es el ajuste por latitud y altura que ya
usaba el panel de Ruta. NO es un modelo climático: no tiene estaciones, ni hora local, ni inercia térmica,
ni polvo. La escala va recortada en los extremos para que se lea la franja donde cae casi todo el planeta.
Para dato MEDIDO están las vistas THEMIS.

Las dos rampas son secuenciales de un solo tono (naranja = dosis, azul = frío), con luminosidad monótona
y verificadas con el validador de paletas: nada de arcoíris, que distorsiona la lectura de magnitudes.

## 2. Dos capas base nuevas, estas sí medidas (MGS TES)
- **Inercia térmica (TES)**: cuánto calor retiene el suelo. Roca y costras, alta; polvo suelto, baja.
- **Polvo (TES)**: cubierta de polvo de la superficie.

Son globales pero muy gruesas: Trek solo sirve niveles 0 y 1, ≈ 20 km/px. Sirven de contexto climático,
no para mirar de cerca.

## 3. Descripción al pasar el ratón en todos los botones
Todos los botones de la app llevan ya un `title`: pestañas, lugares, vistas, mapas modelados, cámara,
capa externa, paradas, rutas candidatas, presupuesto, ejecución, el HUD de la visera y el diálogo de bloqueo.
En las leyendas y en los radios de mapa el texto explica además de dónde sale el dato.

---

# Entrega anterior: fuera el DTM local

## 0. Eliminado el DTM local (esta entrega)
El recuadro rojo «Falta el DTM local» ya no existe, y tampoco los archivos que había que preparar
(`public/jezero/dtm.json`, `dtm.bin`, `tools/tile_dtm.py`) ni el módulo `src/engine/local.ts`: todo borrado.

**Qué usa ahora la planificación:** el relieve MOLA que ya descarga el terreno 3D. Al fijar las paradas, la app
calcula sola un rectángulo que las cubre (con 2 km de margen), descarga su elevación y construye la rejilla
de pendiente y rugosidad. No hay nada que instalar ni configurar: funciona en cualquier punto de Marte.

**Lo que se pierde, y la app lo dice en pantalla:** MOLA mide ≈ 650 m por píxel. La pendiente y la rugosidad
describen la forma general del terreno, no los obstáculos de una caminata (rocas, zanjas, escalones de pocos metros).
Las celdas de la rejilla son de 150 m; más finas solo interpolarían el mismo dato, así que no se inventa detalle.
Las rutas son un trazado orientativo, no un plan de EVA verificado. El umbral de rugosidad «muy rugosa» pasó de
0.5 m a 3 m, que es lo que tiene sentido a esta escala.

Los demás archivos de `public/jezero/` (traza de Perseverance, curva MEDA, imágenes de las paradas) siguen siendo
opcionales y funcionando igual que antes.

---

# Entrega anterior: terreno 3D inmediato, capas térmicas reales, paradas precargadas

## 1. Terreno 3D: aparece al instante y sin «particiones»
**Causa de los bloques flotantes y huecos negros de la captura:** por debajo del nivel 5 el terreno era una esfera lisa a
altura 0, y cualquier tesela cuya elevación MOLA no estuviera lista (o se hubiera expulsado de la caché) también salía a 0.
Junto a teselas con altura real (Olympus Mons está a +20 km × 1.5 de exageración) eso dibujaba paredes verticales y huecos.
- Nueva **rejilla MOLA global gruesa** (32 teselas de nivel 2, ≈ 10 km/px) que se descarga una vez al arrancar: hay relieve
  real en todo el planeta y a cualquier zoom desde el primer segundo. Ya no existe la «esfera lisa».
- Las teselas finas (nivel 6, ≈ 650 m) se usan desde el nivel de terreno 6. Si aún no están, el proveedor responde
  «reintenta luego» y Cesium **sigue mostrando la tesela padre con relieve real** (nunca una a altura 0).
  Cuando llegan los datos se pide un fotograma y se refinan solas.
- Ningún muestreo devuelve ya 0 «inventado»: sin tesela fina se usa la gruesa.

## 2. Terreno 3D: mucho más rápido
- **Pre-carga**: la elevación del destino empieza a cargarse al iniciar el vuelo (lugares, «Ir a la zona», etc.) y alrededor
  de la cámara mientras te mueves (radio 1 tesela) y al detenerte (radio 2 bajo 400 km). Al llegar, ya está.
- Cola de los Web Workers en orden **LIFO**: se procesa primero lo que la cámara mira ahora, no lo que ya quedó atrás. Hasta 4 workers.
- Margen de filtrado 64 → 40 px (≈ 23 % menos cálculo por tesela, sin costuras: el filtro más ancho tiene radio 30).
- Cachés LRU más grandes (192 crudas / 320 filtradas) y `tileCacheSize = 400` en Cesium: volver a una zona no recalcula.

## 3. Capas «Térmica» y «Térmica nocturna»
Los nombres de capa usados (`Mars_MO_THEMIS-IR-…_clon0_ly`) **no existen en NASA Trek** (su WMTSCapabilities da error).
Los correctos, verificados en Trek: `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` y
`THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` (PNG, niveles 0–9, cobertura 65° S – 65° N).
Se limita la petición de teselas a esa franja (fuera de ella no hay datos THEMIS: se ve el color base).

## 4. Paradas implementadas (precargadas, no hay que fijarlas)
| Parada | lat, lon | Fuente |
| --- | --- | --- |
| Enchanted Lake | 18.45050, 77.40144 | Perseverance, sol 421 (M20_waypoints.json, NASA/JPL) |
| Hogwallow Flats | 18.45886, 77.40610 | Perseverance, sol 474 (ídem) |
| Skrinkle Haven (4.ª, opcional) | 18.47444, 77.38982 | Perseverance, soles 721–727 (ídem) |
| Kodiak | 18.4410, 77.4045 | **Aproximada (±200 m)**: 2.6 km al O del aterrizaje (AAPG) y ~1 km al SSE del frente del delta (Caravaca et al. 2024). El rover no subió a Kodiak, no hay waypoint. |

Son posiciones del rover, no el centro del afloramiento. Se pueden mover; ↺ las devuelve a la precargada. Solo la **Base** sigue sin coordenadas (no hay fuente).

---

# Entrega anterior: panel de Ruta vuelve a mostrar datos

## 0. Panel «Ruta» sin datos (esta entrega)
En la versión simple el panel mostraba datos y en la desarrollada no. Causas y arreglo:
- `analyze()` dependía de que se descargaran/decodificaran las teselas MOLA (y sus 8 vecinas + workers). Si UNA fallaba, o tardaba para siempre, la promesa se rechazaba/colgaba, `an` quedaba en `null` y el panel quedaba vacío SIN explicación.
  Ahora cada punto tiene tiempo límite (15 s) y, si no hay elevación, el análisis se calcula igual con lo que no la necesita
  (distancia, tiempo, jornadas, clima, O₂, radiación, polvo, peligros) y avisa con «Elevación parcial / no disponible».
- Usa primero el DTM local (si existe) y MOLA solo donde no hay DTM.
- `Profile` se rompía con datos vacíos (`data[data.length-1]`): ahora no se dibuja si no hay perfil.
- Con < 2 waypoints no aparecía nada: ahora hay un texto de ayuda; mientras calcula, «Calculando análisis…».
- Recuperado de la versión simple: **Pend. máx / media**, **Terreno**, **Rover robótico** (0.14 km/h) y peligro por pendiente máxima del vehículo.

(Lo demás de la entrega anterior —DTM, optimización, cámara de calle— sigue igual. No se incluye `pnpm-lock.yaml`: es autogenerado, `pnpm install` lo recrea. `procedural.ts` ya no existe.)
