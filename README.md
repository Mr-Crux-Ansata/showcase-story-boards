# AquaSense AI

Aplicación web SCADA de demostración para telemetría, alertas, bitácora, cierres de turno e inferencias PAC. El gateway incluido es un simulador; no existe una integración con PLC, OPC-UA o Modbus.

## Arquitectura

- `src/routes/` define las páginas con TanStack Router y Start.
- `src/components/screens/` contiene las cinco vistas operativas: Costos, Alertas, Recomendaciones, Bitácora y Carga CSV.
- `src/server.ts` monta los endpoints JSON y delega el resto del tráfico al servidor SSR.
- `src/server/api/` valida solicitudes y coordina persistencia, optimización y el gateway simulado.
- `src/server/db/` administra el pool de `mssql` y consultas SQL Server parametrizadas.
- `database/` contiene el aprovisionamiento, esquema y datos semilla.
- `scripts/edge-gateway-simulator.ts` genera paquetes de prueba y consulta el setpoint PAC aprobado.

El optimizador surrogate corre en el servidor. La confirmación humana se guarda en `AiRecommendations` y `OperationsLog`; el simulador lee la última dosis aprobada y la refleja en sus paquetes siguientes. Esto no representa una escritura ni un ACK de PLC.

## Requisitos y ejecución local

Usa Node.js 22.12 o posterior y npm.

```powershell
npm ci
Copy-Item .env.example .env
```

Completa `.env` localmente. Para persistencia SQL configura `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. Para usar el simulador, define además `EDGE_GATEWAY_KEY` y `PAC_INITIAL_SETPOINT`; configura `OPERATOR_NAME` y `OPERATOR_ROLE` para registrar decisiones y entregas.

Inicializa SQL Server siguiendo [database/README.md](database/README.md), luego arranca la aplicación:

```powershell
npm run dev
```

En otra terminal ejecuta el gateway simulado:

```powershell
npm run gateway:simulate
```

La persistencia no está disponible sin credenciales válidas y SQL Server accesible. El flujo en memoria se limita a telemetría en vivo para desarrollo; las APIs de consulta y escritura persistente responden con error de servicio en lugar de fingir guardado.

## CSV

La importación acepta filas que representan snapshots completos de `TelemetrySnapshots`. Descarga la plantilla desde Carga CSV y proporciona los campos obligatorios de afluente, dosis y efluente. Las filas válidas se insertan en una transacción; las inválidas se reportan con su número de fila. No se inventan valores para convertir lecturas aisladas en snapshots.

## Comprobaciones

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```
