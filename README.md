# Mars Atlas (React + CesiumJS + Sass + TypeScript)
    npm install && npm run dev

- `src/engine/config.ts` – capas NASA Trek (Viking, MOLA, THEMIS). Verifica URLs/niveles en el WMTSCapabilities de Trek.
- `src/engine/terrain.ts` – proveedor de terreno Cesium (MOLA: rejilla global gruesa + teselas finas) y sombreado de relieve. `relaxPool.ts` filtra el relieve en Web Workers.
- `src/engine/area.ts` – zona de planeación derivada de las paradas; su relieve sale de MOLA (ya no hay DTM local ni archivos que preparar).
- `src/engine/analysis.ts` – análisis de ruta (distancia, tiempo, pendiente, peligro, O₂, clima…). Modelos simplificados. Nunca falla en silencio: si no hay elevación, muestra el resto de datos y lo avisa.
- Ruta LOCK: bloqueada hasta pulsar "Confirmar llegada" (persistida en localStorage).
