-- ============================================================================
-- AquaSense AI - Industrial Water SCADA
-- Script 01: Creación de Login, Base de Datos, Usuario y Permisos
-- Compatible con: Microsoft SQL Server 2017+ / 2022 / Azure SQL Edge
-- ============================================================================

USE [master];
GO

-- 1. Crear el login fuera de este script usando el gestor seguro de credenciales
-- de tu entorno. Este archivo no contiene ni define contraseñas.
IF SUSER_ID(N'aquasense_app_user') IS NULL
    PRINT 'Crea primero el login aquasense_app_user con una contraseña gestionada fuera del repositorio.';
ELSE
    PRINT 'El login aquasense_app_user ya existe.';
GO

-- 2. Crear la Base de Datos con configuraciones industriales recomendadas
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'AquaSenseSCADA')
BEGIN
    PRINT 'Creando Base de Datos [AquaSenseSCADA]...';
    CREATE DATABASE [AquaSenseSCADA]
    COLLATE Modern_Spanish_100_CI_AI_SC_UTF8;
END
GO

-- 3. Configurar opciones de rendimiento para alta concurrencia de telemetría SCADA
ALTER DATABASE [AquaSenseSCADA] SET READ_COMMITTED_SNAPSHOT ON;
ALTER DATABASE [AquaSenseSCADA] SET ALLOW_SNAPSHOT_ISOLATION ON;
ALTER DATABASE [AquaSenseSCADA] SET AUTO_CREATE_STATISTICS ON;
ALTER DATABASE [AquaSenseSCADA] SET AUTO_UPDATE_STATISTICS ON;
GO

USE [AquaSenseSCADA];
GO

-- 4. Crear el Usuario de base de datos asociado al Login
IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = 'aquasense_app_user')
BEGIN
    IF SUSER_ID(N'aquasense_app_user') IS NULL
        THROW 50001, 'Create the aquasense_app_user SQL login using your secret manager, then rerun this script.', 1;
    PRINT 'Creando Usuario de Base de Datos para [aquasense_app_user]...';
    CREATE USER [aquasense_app_user] FOR LOGIN [aquasense_app_user];
END
GO

-- 5. Asignar Roles de Lectura y Escritura
ALTER ROLE [db_datareader] ADD MEMBER [aquasense_app_user];
ALTER ROLE [db_datawriter] ADD MEMBER [aquasense_app_user];
GO

-- Permiso de ejecución de procedimientos almacenados
GRANT EXECUTE TO [aquasense_app_user];
GO

PRINT 'Inicialización de Login y Base de Datos completada exitosamente.';
GO
