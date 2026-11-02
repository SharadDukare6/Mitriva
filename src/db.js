const mysql = require("mysql2/promise");

let pool;

// GoDaddy automatically injects DB_HOST, DB_PORT, DB_NAME, DB_USER and
// DB_PASSWORD for its hosted MySQL database. MYSQL_* is kept as a fallback
// so the same code can also run locally or on another server.
function envValue(primary, fallback) {
  return process.env[primary] || process.env[fallback] || "";
}

function dbConfig() {
  return {
    host: envValue("DB_HOST", "MYSQL_HOST"),
    port: Number(envValue("DB_PORT", "MYSQL_PORT") || 3306),
    user: envValue("DB_USER", "MYSQL_USER"),
    password: envValue("DB_PASSWORD", "MYSQL_PASSWORD"),
    database: envValue("DB_NAME", "MYSQL_DATABASE"),
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 8)
  };
}

function dbConfigured() {
  const cfg = dbConfig();
  return Boolean(cfg.host && cfg.user && cfg.password && cfg.database);
}

function getPool() {
  if (!dbConfigured()) {
    const error = new Error(
      "Database is not configured. Expected GoDaddy DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD or MYSQL_* equivalents."
    );
    error.code = "DB_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  if (!pool) {
    const cfg = dbConfig();
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: cfg.connectionLimit,
      maxIdle: cfg.connectionLimit,
      idleTimeout: 60000,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: "utf8mb4"
    });
  }

  return pool;
}

async function pingDb() {
  const [rows] = await getPool().query("SELECT 1 AS ok, NOW() AS server_time");
  return rows[0];
}

module.exports = { getPool, pingDb, dbConfigured };
