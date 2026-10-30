-- ============================================================================
-- AquaSense AI - Industrial Water SCADA
-- Script 01: Creación de Login, Base de Datos, Usuario y Permisos
-- Compatible con: Microsoft SQL Server 2017+ / 2022 / Azure SQL Edge
-- ============================================================================

USE [master];
GO

-- 1. Crear el Login a nivel de Servidor (si no existe)
-- NOTA: Cambiar la contraseña por una segura de acuerdo con las políticas de su entorno
IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = 'aquasense_app_user')
BEGIN
    PRINT 'Creando Login [aquasense_app_user]...';
    CREATE LOGIN [aquasense_app_user] 
    WITH PASSWORD = N'AquaSense#2026!SecureKey',
         DEFAULT_DATABASE = [master],
         CHECK_EXPIRATION = OFF,
         CHECK_POLICY = ON;
END
ELSE
BEGIN
    PRINT 'El login [aquasense_app_user] ya existe.';
END
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
