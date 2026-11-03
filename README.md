# AquaSense AI

AquaSense AI es una aplicación web de demostración para supervisar la operación de una planta de tratamiento de agua. Reúne telemetría de proceso, indicadores de calidad, alertas, recomendaciones de dosificación PAC, bitácora, cierres de turno e importación de históricos CSV. La interfaz distingue las mediciones recibidas de las proyecciones del modelo; los equipos y la aplicación de dosis son simulados.

## Mapa del proyecto

- `src/routes/`: rutas web (`/costos`, `/alertas`, `/recomendaciones`, `/bitacora` y `/carga-csv`) y composición raíz.
- `src/components/screens/`: pantallas operativas y navegación SCADA.
- `src/components/ui/`: componentes visuales reutilizables, incluidos contenedores de gráficas.
- `src/hooks/`: carga y actualización de datos, incluyendo telemetría en vivo mediante SSE.
- `src/lib/`: cliente API, estado de planta/turno, tipos, validación y utilidades del navegador.
- `src/server/api/`: endpoints HTTP para telemetría, streaming, simulador, optimización, operaciones y CSV.
- `src/server/db/`: conexión SQL Server, repositorios y diagnóstico de errores.
- `src/server/ai/surrogate-model.ts`: modelo local de estimación/optimización PAC; no usa un servicio externo de IA.
- `database/`: scripts de creación, permisos, esquema y datos iniciales.
- `scripts/edge-gateway-simulator.ts`: emite paquetes de proceso de prueba.

## Arquitectura y flujo de datos

1. El simulador envía lecturas a `/api/edge/telemetry`, autenticándose con `EDGE_GATEWAY_KEY`.
2. El servidor valida cada paquete, calcula el indicador de cumplimiento y publica la lectura al flujo SSE (`/api/telemetry/stream`). Si SQL está disponible, guarda la muestra; si no, puede conservarla temporalmente en memoria para visualización en vivo. El historial persistente no incluye esas muestras temporales.
3. El tablero `/costos` consulta hasta 200 muestras guardadas. Sus tendencias se ordenan cronológicamente y los promedios, cumplimiento y distribución se calculan solo con las muestras cargadas. La recomendación PAC se obtiene bajo demanda y sus resultados proyectados se identifican como estimaciones.
4. La persona operadora revisa y decide sobre recomendaciones. La decisión puede ser consultada por el simulador para ciclos posteriores, pero nunca se transmite a un PLC.
5. Alertas, bitácora, cierres de turno e importaciones usan endpoints de operaciones y almacenamiento SQL. Los CSV aceptan snapshots completos, no lecturas aisladas de tags.

## Persistencia y límites

El esquema SQL Server (`database/02_schema.sql`) contiene plantas, turnos, tags, snapshots, recomendaciones, alertas, eventos operativos y cierres de turno. Los datos de `database/03_seed_data.sql` son referencias iniciales; no representan mediciones reales. El modelo de `src/server/ai/surrogate-model.ts` es una aproximación local basada en parámetros codificados y su ahorro es una proyección, no un costo observado. Esta vista no dispone de costos medidos de energía, lodos o membranas.

La única persistencia externa de aplicación es Microsoft SQL Server. Google Fonts y Material Symbols se cargan como recursos visuales. No se integra con PLC, OPC-UA, Modbus, proveedores cloud de IA ni servicios externos de alertas.

## Requisitos y configuración

Requiere Node.js 22.12+ y npm. Instala dependencias y prepara el archivo de entorno desde la raíz:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Configura `.env` localmente, nunca con credenciales en el repositorio. `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` conectan con SQL Server. Inicializa la base siguiendo [database/README.md](database/README.md). `EDGE_GATEWAY_KEY` debe tener al menos 32 caracteres; `PLANT_CODE`, `TARGET_URL` y `PAC_INITIAL_SETPOINT` configuran el simulador. El setpoint inicial debe estar entre 5 y 50 ppm. `OPERATOR_NAME` y `OPERATOR_ROLE` identifican acciones registradas.

## Desarrollo y comprobaciones

Ejecuta servidor y simulador en terminales separadas:

```powershell
npm run dev
npm run gateway
```

Comprobaciones disponibles: `npm test` ejecuta Vitest; `npm run lint` revisa estilo y errores estáticos; `npx tsc --noEmit` valida tipos; `npm run build` genera el build de producción. `npm run preview` sirve localmente el build generado.

## Cambios y contribuciones

Mantén las pantallas dentro de `src/components/screens/`, los endpoints en `src/server/api/` y el acceso SQL parametrizado en repositorios. Reutiliza los componentes de `src/components/ui/`, valida cambios con lint y tipos, y añade pruebas Vitest cuando cambie lógica de negocio. En una solicitud de cambios, describe el comportamiento y la validación realizada; incluye capturas cuando se modifique la interfaz.
