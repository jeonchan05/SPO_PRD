const { pool, closePool } = require("../config/db");

const hasTable = async (tableName) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.count || 0) > 0;
};

const hasColumn = async (tableName, columnName) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.count || 0) > 0;
};

const hasIndex = async (tableName, indexName) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName],
  );
  return Number(rows[0]?.count || 0) > 0;
};

const run = async () => {
  const dropped = {
    usersAcademyIndex: false,
    usersAcademyColumn: false,
    sharedUserAcademiesTable: false,
  };

  if (await hasColumn("users", "academy_id")) {
    if (await hasIndex("users", "idx_users_academy_id")) {
      await pool.query(`ALTER TABLE users DROP INDEX idx_users_academy_id`);
      dropped.usersAcademyIndex = true;
      console.log("[legacy-cleanup] dropped index users.idx_users_academy_id");
    }

    await pool.query(`ALTER TABLE users DROP COLUMN academy_id`);
    dropped.usersAcademyColumn = true;
    console.log("[legacy-cleanup] dropped column users.academy_id");
  } else {
    console.log("[legacy-cleanup] users.academy_id does not exist");
  }

  if (await hasTable("user_academies")) {
    await pool.query(`DROP TABLE user_academies`);
    dropped.sharedUserAcademiesTable = true;
    console.log("[legacy-cleanup] dropped shared table user_academies");
  } else {
    console.log("[legacy-cleanup] shared table user_academies does not exist");
  }

  console.log(`[legacy-cleanup] done ${JSON.stringify(dropped)}`);
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[legacy-cleanup] failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
