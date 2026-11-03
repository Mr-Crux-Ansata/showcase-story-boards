# AquaSense AI · SQL Server

Scripts para Microsoft SQL Server 2017 o posterior.

## Archivos

- `01_create_login_and_database.sql`: crea la base de datos y configura aislamiento. El login debe crearse antes con el gestor seguro del entorno; el repositorio no define contraseñas.
- `02_schema.sql`: define plantas, turnos, tags, snapshots, recomendaciones, alertas, bitácora y entregas de turno.
- `03_seed_data.sql`: inserta datos iniciales de referencia para PL_NORTE, alertas y una recomendación pendiente.

## Inicialización

1. Crea el login SQL `aquasense_app_user` desde SSMS o con el gestor de secretos de tu entorno.
2. Ejecuta `01_create_login_and_database.sql`, `02_schema.sql` y `03_seed_data.sql`, en ese orden.
3. Copia `.env.example` a `.env` en la raíz y configura las credenciales y claves localmente. No las guardes en el repositorio.

El usuario de aplicación recibe actualmente los roles `db_datareader` y `db_datawriter`. En producción, conviene restringirlos a permisos por tabla o procedimiento según el modelo de despliegue.

Las lecturas CSV deben ser snapshots completos compatibles con `TelemetrySnapshots`; el esquema no contiene una tabla de lecturas individuales por tag. El hash de handover es una huella de integridad, no una firma legal ni una prueba de identidad.
