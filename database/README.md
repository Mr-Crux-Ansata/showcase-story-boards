# AquaSense AI · SQL Server

Scripts para Microsoft SQL Server 2017 o posterior.

## Archivos

- `01_create_login_and_database.sql`: crea la base de datos y configura aislamiento. El login debe crearse antes con el gestor seguro del entorno; el repositorio no define contraseñas.
- `02_schema.sql`: define plantas, turnos, tags, snapshots, recomendaciones, alertas, bitácora, entregas de turno y captura de costos.
- `03_seed_data.sql`: inserta datos iniciales de referencia para PL_NORTE, alertas y una recomendación pendiente.
- `04_seed_demo_excursions.sql`: agrega 12 muestras sintéticas recientes para mostrar estados conformes y fuera de referencia en el tablero. Es opcional e idempotente.
- `05_add_operational_cost_records.sql`: agrega la tabla de captura mensual de costos en bases ya inicializadas antes de esta funcionalidad.
- `06_seed_demo_operational_costs.sql`: inserta hasta seis meses de costos sintéticos para probar la gráfica, sin reemplazar periodos existentes.

## Inicialización

1. Crea el login SQL `aquasense_app_user` desde SSMS o con el gestor de secretos de tu entorno.
2. En instalaciones nuevas, ejecuta `01_create_login_and_database.sql`, `02_schema.sql` y `03_seed_data.sql`, en ese orden. En bases existentes, ejecuta `05_add_operational_cost_records.sql` para añadir la captura de costos.
3. Copia `.env.example` a `.env` en la raíz y configura las credenciales y claves localmente. No las guardes en el repositorio.
4. Opcionalmente, ejecuta `04_seed_demo_excursions.sql` para poblar el tablero con un lote de demostración. No lo uses en una base con datos de operación real.
5. Ejecuta `06_seed_demo_operational_costs.sql` después de crear la tabla si quieres mostrar el gráfico de costos con datos de ejemplo. Para bases existentes, ejecuta antes `05_add_operational_cost_records.sql`.

El usuario de aplicación recibe actualmente los roles `db_datareader` y `db_datawriter`. En producción, conviene restringirlos a permisos por tabla o procedimiento según el modelo de despliegue.

Las lecturas CSV deben ser snapshots completos compatibles con `TelemetrySnapshots`; el esquema no contiene una tabla de lecturas individuales por tag. El hash de handover es una huella de integridad, no una firma legal ni una prueba de identidad.

Los costos operativos se capturan manualmente por planta y mes en USD. Se pueden actualizar los importes del mismo periodo; cada registro conserva operador, rol, fecha de captura y una referencia opcional. Los importes deben transcribirse desde facturas o reportes operativos y no se calculan a partir de telemetría.
