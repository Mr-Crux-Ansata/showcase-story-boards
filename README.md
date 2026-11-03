# AquaSense AI

AquaSense AI es una aplicación web de demostración SCADA para plantas de tratamiento de agua. Reúne telemetría, alertas, recomendaciones de dosificación PAC, bitácora operativa, cierres de turno e importación histórica desde CSV. El sistema distingue las lecturas simuladas de los datos persistidos y no presenta proyecciones como mediciones reales.

## Alcance y flujo operativo

1. El simulador de gateway genera snapshots de proceso y consulta a la API la consigna PAC activa. Envía los paquetes con una clave compartida.
2. La API valida el payload, calcula indicadores de calidad, guarda el snapshot en SQL Server y publica la lectura por SSE para la interfaz. Si SQL Server no está disponible, la telemetría puede verse temporalmente en vivo, pero no se marca como persistida.
3. El modelo surrogate ejecutado en el servidor calcula una recomendación con las condiciones de proceso disponibles. La persona operadora puede registrarla como aprobada o rechazada; el gateway simulado consulta la última dosis aprobada en sus ciclos siguientes.
4. Alertas, bitácora y cierres de turno se consultan o guardan en SQL Server. La importación CSV acepta snapshots completos y los inserta dentro de una transacción.

## Componentes

- `src/routes/`: páginas y metadatos de Costos, Alertas, Recomendaciones, Bitácora y Carga CSV.
- `src/components/screens/`: vistas operativas y componentes de cada pantalla.
- `src/hooks/` y `src/lib/`: acceso a API, estado de planta/turno, validación de CSV y dosis, tipos y utilidades.
- `src/server/api/`: endpoints de telemetría, streaming, optimización, decisiones operativas y CSV.
- `src/server/ai/`: modelo surrogate de calidad y ahorro PAC; no llama a un proveedor de IA externo.
- `src/server/db/`: conexión `mssql`, repositorios SQL parametrizados y diagnóstico de errores.
- `database/`: scripts SQL Server para base, esquema y datos semilla.
- `scripts/edge-gateway-simulator.ts`: simulador de gateway industrial.

## Integraciones y límites

La persistencia externa usa Microsoft SQL Server. La interfaz también descarga fuentes tipográficas e iconos de Google Fonts/Material Symbols. No hay conexión con PLC, OPC-UA, Modbus, servicios cloud de IA ni sistemas externos de alertas: los valores del gateway y la aplicación de setpoints son simulados. Una aprobación no es un comando ni un ACK de equipo real.

## Instalación y ejecución local

Requiere Node.js 22.12 o posterior y npm. Desde la raíz del repositorio:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Configura `.env` localmente. Para SQL Server define `DB_SERVER`, `DB_PORT`, `DB_NAME=AquaSenseSCADA`, `DB_USER` y `DB_PASSWORD`. Inicializa la base con los pasos de [database/README.md](database/README.md). Para el simulador configura `EDGE_GATEWAY_KEY` (mínimo 32 caracteres), `PAC_INITIAL_SETPOINT` (5–50 ppm) y `TARGET_URL` con el host y puerto que muestre Vite. `OPERATOR_NAME` y `OPERATOR_ROLE` habilitan el registro de decisiones y cierres.

Inicia el servidor y, en otra terminal, el gateway:

```powershell
npm run dev
npm run gateway
```

Sin conexión SQL, solo la vista de telemetría en vivo puede usar almacenamiento temporal; las consultas y acciones persistentes informan el error y no simulan guardados.

## Comprobaciones

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```
