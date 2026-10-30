import sql from "mssql";

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

export const dbConfig: DbConfig = {
  server: process.env["DB_SERVER"] || "localhost",
  port: Number(process.env["DB_PORT"]) || 1433,
  database: process.env["DB_NAME"] || "AquaSenseSCADA",
  user: process.env["DB_USER"] || "aquasense_app_user",
  password: process.env["DB_PASSWORD"] || "AquaSense#2026!SecureKey",
  options: {
    encrypt: process.env["DB_ENCRYPT"] === "true",
    trustServerCertificate: process.env["DB_TRUST_SERVER_CERTIFICATE"] !== "false",
    enableArithAbort: true,
    connectTimeout: 5000,
  },
};

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;
let hasReportedOffline = false;

export async function getDbPool(): Promise<sql.ConnectionPool | null> {
  if (pool && pool.connected) {
    return pool;
  }

  if (isConnecting) {
    return null;
  }

  isConnecting = true;
  try {
    pool = new sql.ConnectionPool(dbConfig);
    await pool.connect();
    console.info(`[AquaSense DB] Conectado exitosamente a SQL Server (${dbConfig.server}:${dbConfig.port}/${dbConfig.database})`);
    hasReportedOffline = false;
    return pool;
  } catch (error) {
    if (!hasReportedOffline) {
      console.warn(`[AquaSense DB] SQL Server local no disponible (${(error as Error).message}). Modo almacenamiento en memoria activo.`);
      hasReportedOffline = true;
    }
    pool = null;
    return null;
  } finally {
    isConnecting = false;
  }
}

export function isDbConnected(): boolean {
  return pool !== null && pool.connected;
}
