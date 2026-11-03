import sql from "mssql";
import { logServerError } from "../logging";

export interface DbConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    enableArithAbort: boolean;
    connectTimeout: number;
  };
}

const configuredPort = process.env["DB_PORT"] === undefined ? 1433 : Number(process.env["DB_PORT"]);
const configuredEncrypt = process.env["DB_ENCRYPT"];
const configuredTrustServerCertificate = process.env["DB_TRUST_SERVER_CERTIFICATE"];
const validDbSettings =
  Number.isInteger(configuredPort) &&
  configuredPort > 0 &&
  configuredPort <= 65535 &&
  (configuredEncrypt === undefined ||
    configuredEncrypt === "true" ||
    configuredEncrypt === "false") &&
  (configuredTrustServerCertificate === undefined ||
    configuredTrustServerCertificate === "true" ||
    configuredTrustServerCertificate === "false");

export const dbConfig: DbConfig = {
  server: process.env["DB_SERVER"] || "localhost",
  port: configuredPort,
  database: process.env["DB_NAME"] || "AquaSenseSCADA",
  user: process.env["DB_USER"] || "",
  password: process.env["DB_PASSWORD"] || "",
  options: {
    encrypt: configuredEncrypt !== "false",
    trustServerCertificate: configuredTrustServerCertificate === "true",
    enableArithAbort: true,
    connectTimeout: 5000,
  },
};

let pool: sql.ConnectionPool | null = null;
let connectionPromise: Promise<sql.ConnectionPool | null> | null = null;
let hasReportedOffline = false;

export async function getDbPool(): Promise<sql.ConnectionPool | null> {
  if (pool && pool.connected) {
    return pool;
  }

  if (!validDbSettings) {
    if (!hasReportedOffline) {
      const invalidSettings = [
        ...(Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
          ? []
          : ["DB_PORT"]),
        ...(configuredEncrypt === undefined ||
        configuredEncrypt === "true" ||
        configuredEncrypt === "false"
          ? []
          : ["DB_ENCRYPT"]),
        ...(configuredTrustServerCertificate === undefined ||
        configuredTrustServerCertificate === "true" ||
        configuredTrustServerCertificate === "false"
          ? []
          : ["DB_TRUST_SERVER_CERTIFICATE"]),
      ];
      console.error("[AquaSense DB] Invalid database configuration.", { invalidSettings });
      hasReportedOffline = true;
    }
    return null;
  }

  if (!dbConfig.user || !dbConfig.password) {
    if (!hasReportedOffline) {
      console.error("[AquaSense DB] SQL credentials are missing.", {
        missingSettings: [
          ...(!dbConfig.user ? ["DB_USER"] : []),
          ...(!dbConfig.password ? ["DB_PASSWORD"] : []),
        ],
      });
      hasReportedOffline = true;
    }
    return null;
  }

  if (!connectionPromise) {
    connectionPromise = connectDb().finally(() => {
      connectionPromise = null;
    });
  }
  return connectionPromise;
}

async function connectDb(): Promise<sql.ConnectionPool | null> {
  try {
    pool = new sql.ConnectionPool(dbConfig);
    await pool.connect();
    const context = await pool.request().query<{
      databaseName: string;
      databaseUser: string;
      plantsTableVisible: boolean;
      readerRoleMember: boolean | null;
      canSelectPlants: number | null;
    }>(`
      SELECT DB_NAME() AS databaseName,
        USER_NAME() AS databaseUser,
        CONVERT(bit, CASE WHEN OBJECT_ID(N'dbo.Plants', N'U') IS NULL THEN 0 ELSE 1 END) AS plantsTableVisible,
        CONVERT(bit, IS_MEMBER(N'db_datareader')) AS readerRoleMember,
        HAS_PERMS_BY_NAME(N'dbo.Plants', N'OBJECT', N'SELECT') AS canSelectPlants;
    `);
    const databaseContext = context.recordset[0];
    console.info("[AquaSense DB] SQL Server connection established.", {
      server: dbConfig.server,
      port: dbConfig.port,
      configuredDatabase: dbConfig.database,
      activeDatabase: databaseContext?.databaseName ?? "unknown",
      databaseUser: databaseContext?.databaseUser ?? "unknown",
      plantsTableVisible: databaseContext?.plantsTableVisible ?? false,
      readerRoleMember: databaseContext?.readerRoleMember ?? null,
      canSelectPlants: databaseContext?.canSelectPlants ?? null,
    });
    if (!databaseContext?.plantsTableVisible || databaseContext.canSelectPlants !== 1) {
      console.error(
        "[AquaSense DB] dbo.Plants is missing or not visible to this login; verify DB_NAME, SQL instance, and database permissions.",
      );
    }
    hasReportedOffline = false;
    return pool;
  } catch (error) {
    if (!hasReportedOffline) {
      logServerError("SQL Server connection failed.", error, {
        server: dbConfig.server,
        port: dbConfig.port,
        database: dbConfig.database,
        encrypt: dbConfig.options.encrypt,
        trustServerCertificate: dbConfig.options.trustServerCertificate,
        usernameConfigured: Boolean(dbConfig.user),
      });
      hasReportedOffline = true;
    }
    pool = null;
    return null;
  }
}

export function isDbConnected(): boolean {
  return pool !== null && pool.connected;
}
