# Datos locales de Jezero (TODOS opcionales)

La app funciona sin ninguno de estos archivos: el relieve, la pendiente y las rutas salen de MOLA, que se descarga de NASA Trek.
La app NO inventa datos: si un archivo falta, lo dice en pantalla.

| Archivo | Para qué | Formato |
| --- | --- | --- |
| `traverse.json` | Traza real de Perseverance → nivel de confianza por zona | `{ "source": "…", "points": [[lon, lat], …] }` |
| `meda_hourly.json` | Curva horaria real de temperatura del suelo (MEDA) | `{ "source": "…", "date": "…", "hours": [24 valores en °C, hora solar local 0..23] }` |
| `stops/<id>/manifest.json` + imágenes | Vista en primera persona de cada parada (Mastcam-Z / SuperCam) | `[ { "file": "a.jpg", "caption": "…", "credit": "NASA/JPL-Caltech/…", "sol": 123, "instrument": "Mastcam-Z" } ]` |

Ids de parada: `base`, `kodiak`, `enchanted`, `hogwallow`, `skrinkle`.

Ya no hace falta ningún DTM: la rejilla de planeación se construye con MOLA (≈ 650 m/px), que es grueso para una caminata y la app lo advierte en pantalla.

Sin `traverse.json` la confianza por distancia sale «no verificable» (nunca «alta»).
Sin `meda_hourly.json` la curva de temperatura es una curva MODELADA que solo une los extremos citados por NASA; se rotula así.
Sin imágenes en `stops/<id>/` la ficha de la parada lo indica; no se muestran imágenes sin fuente.
