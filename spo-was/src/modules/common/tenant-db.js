const mysql = require("mysql2/promise");
const { dbHost, dbPort, dbUser, dbPassword, dbTimezone } = require("../../config/db");

const tenantDbPrefix = String(process.env.TENANT_DB_PREFIX || "spo-tenant-").trim() || "spo-tenant-";
const poolByDatabaseName = new Map();

const toTenantUserId = (userId) => {
  const parsed = Number(userId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("유효하지 않은 사용자 ID입니다.");
  }
  return parsed;
};

const quoteIdentifier = (value) => `\`${String(value).replace(/`/g, "``")}\``;

const buildTenantDatabaseName = (userId) => `${tenantDbPrefix}${toTenantUserId(userId)}`;

const ensureTenantDatabase = async (userId) => {
  const databaseName = buildTenantDatabaseName(userId);
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    timezone: dbTimezone,
  });

  try {
    await connection.query("SET time_zone = ?", [dbTimezone]);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }

  return databaseName;
};

const getTenantPool = async (userId) => {
  const databaseName = await ensureTenantDatabase(userId);
  const cachedPool = poolByDatabaseName.get(databaseName);
  if (cachedPool) {
    return { databaseName, pool: cachedPool };
  }

  const pool = mysql.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: databaseName,
    timezone: dbTimezone,
    waitForConnections: true,
    connectionLimit: 5,
  });

  pool.on("connection", (connection) => {
    connection.query("SET time_zone = ?", [dbTimezone], (error) => {
      if (error) {
        console.error(`[tenant-db:${databaseName}] Failed to set session time_zone=${dbTimezone}: ${error.message}`);
      }
    });
  });

  poolByDatabaseName.set(databaseName, pool);
  return { databaseName, pool };
};

const closeTenantPools = async () => {
  const pools = Array.from(poolByDatabaseName.values());
  poolByDatabaseName.clear();
  await Promise.all(
    pools.map(async (pool) => {
      await pool.end();
    }),
  );
};

module.exports = {
  tenantDbPrefix,
  buildTenantDatabaseName,
  getTenantPool,
  closeTenantPools,
};
