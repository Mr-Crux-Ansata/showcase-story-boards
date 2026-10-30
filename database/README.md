# AquaSense AI - Scripts de Base de Datos (SQL Server)

Este directorio contiene los scripts T-SQL para aprovisionar e inicializar la base de datos industrial de **AquaSense AI** en una instancia local de **Microsoft SQL Server** (2017, 2019, 2022 o Azure SQL Edge).

---

## 📁 Archivos Disponibles

1. **`01_create_login_and_database.sql`**:
   - Crea el login del servidor `aquasense_app_user` con contraseña segura predeterminada.
   - Crea la base de datos `AquaSenseSCADA` con soporte UTF-8 (`Modern_Spanish_100_CI_AI_SC_UTF8`).
   - Habilita `READ_COMMITTED_SNAPSHOT` y `ALLOW_SNAPSHOT_ISOLATION` para evitar bloqueos entre la ingesta masiva de telemetría y las consultas en tiempo real de la UI.
   - Asigna los roles `db_datareader`, `db_datawriter` y permisos de ejecución al usuario de aplicación.

2. **`02_schema.sql`**:
   - Define el esquema relacional normalizado:
     - `Plants`: Catálogo de plantas industriales.
     - `Shifts`: Catálogo de turnos operativos (A, B, C).
     - `ScadaTags`: Catálogo de variables e instrumentación de campo (nodos OPC-UA y registros Modbus).
     - `TelemetrySnapshots`: Instantáneas periódicas del balance hídrico y parámetros del afluente/efluente.
     - `AiRecommendations`: Historial y estado de consignas generadas por los modelos de IA (ahorros proyectados, confianza, validación NOM-001 y estado de aprobación humana).
     - `OperationalAlerts`: Registro y estado de desviaciones/anomalías operativas (`abierta`, `pausada`, `resuelta`).
     - `OperationsLog`: Bitácora inmutable de eventos con hash de firma SHA-256 para auditorías de cumplimiento.
     - `ShiftHandovers`: Formalización de entrega de turnos con resúmenes de telemetría.

3. **`03_seed_data.sql`**:
   - Carga los registros maestros iniciales de plantas, turnos, catálogo de tags, alertas activas y la recomendación de referencia de PAC a 19 ppm.

---

## 🚀 Instrucciones de Ejecución

### Opción A: Mediante SQL Server Management Studio (SSMS) o Azure Data Studio
1. Abre tu herramienta conectándote a tu instancia local (`localhost`, `.` o `localhost\SQLEXPRESS`).
2. Abre y ejecuta los scripts en el siguiente orden estricto:
   1. `01_create_login_and_database.sql`
   2. `02_schema.sql`
   3. `03_seed_data.sql`

### Opción B: Mediante PowerShell / sqlcmd
Si tienes instalado `sqlcmd` en tu terminal de Windows:

```powershell
# Reemplaza 'localhost' o '.\SQLEXPRESS' según tu instancia local
sqlcmd -S localhost -E -i "database\01_create_login_and_database.sql"
sqlcmd -S localhost -E -i "database\02_schema.sql"
sqlcmd -S localhost -E -i "database\03_seed_data.sql"
```

---

## 🔌 Cadena de Conexión Recomendada (.env)

Para conectar el backend de Node.js / TanStack Start mediante librerías como `mssql` o `tedious`:

```env
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=AquaSenseSCADA
DB_USER=aquasense_app_user
DB_PASSWORD=AquaSense#2026!SecureKey
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```
