const mysql = require("mysql2/promise");

const dbHost = process.env.DB_HOST || "mysql";
const dbPort = Number(process.env.DB_PORT || 3306);
const dbUser = process.env.DB_USER || "appuser";
const dbPassword = process.env.DB_PASSWORD || "apppass";
const dbName = process.env.DB_NAME || "appdb";
const normalizeDbTimezone = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "+09:00";
  if (/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(normalized)) return normalized;
  if (/^z$/i.test(normalized)) return "+00:00";
  return "+09:00";
};
const dbTimezone = normalizeDbTimezone(process.env.DB_TIMEZONE || "+09:00");
const isProduction = String(process.env.NODE_ENV || "")
  .trim()
  .toLowerCase() === "production";

if (isProduction) {
  const usingDefaultCredential =
    !process.env.DB_USER || !process.env.DB_PASSWORD || dbUser === "appuser" || dbPassword === "apppass";
  if (usingDefaultCredential) {
    throw new Error("Production DB credentials must be set via DB_USER/DB_PASSWORD and cannot use defaults.");
  }
}

const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  timezone: dbTimezone,
  waitForConnections: true,
  connectionLimit: 10,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = ?", [dbTimezone], (error) => {
    if (error) {
      console.error(`[db] Failed to set session time_zone=${dbTimezone}: ${error.message}`);
    }
  });
});

const closePool = async () => {
  await pool.end();
};

module.exports = {
  pool,
  closePool,
  dbHost,
  dbPort,
  dbUser,
  dbPassword,
  dbName,
  dbTimezone,
};
