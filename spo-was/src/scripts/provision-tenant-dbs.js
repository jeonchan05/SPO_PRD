const { pool, closePool } = require("../config/db");
const { getTenantPool, closeTenantPools, buildTenantDatabaseName } = require("../modules/common/tenant-db");

const toPositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const hasSharedTable = async (tableName) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.count || 0) > 0;
};

const hasSharedUserAcademiesTable = async () => {
  return hasSharedTable("user_academies");
};

const hasUsersAcademyColumn = async () => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'users'
       AND column_name = 'academy_id'`,
  );
  return Number(rows[0]?.count || 0) > 0;
};

const hasSharedUserStudyStatsTable = async () => {
  return hasSharedTable("user_study_stats");
};

const loadSharedUserAcademies = async () => {
  if (!(await hasSharedUserAcademiesTable())) {
    return new Map();
  }

  const [rows] = await pool.query(
    `SELECT user_id, academy_id, registered_at
     FROM user_academies
     ORDER BY user_id ASC, registered_at ASC`,
  );

  const map = new Map();
  rows.forEach((row) => {
    const userId = toPositiveInt(row.user_id);
    const academyId = toPositiveInt(row.academy_id);
    if (!userId || !academyId) return;

    const list = map.get(userId) || [];
    list.push({
      academyId,
      registeredAt: row.registered_at || null,
    });
    map.set(userId, list);
  });
  return map;
};

const loadDerivedUserAcademiesFromStudyData = async () => {
  const sourceQueries = [];

  const hasRecruitments = await hasSharedTable("study_recruitments");
  if (!hasRecruitments) {
    return new Map();
  }

  if (await hasSharedTable("study_recruitment_applications")) {
    sourceQueries.push(
      `SELECT sra.user_id AS user_id, sr.academy_id AS academy_id
       FROM study_recruitment_applications sra
       JOIN study_recruitments sr ON sr.id = sra.recruitment_id`,
    );
  }

  if (await hasSharedTable("study_match_team_members")) {
    sourceQueries.push(
      `SELECT smtm.user_id AS user_id, sr.academy_id AS academy_id
       FROM study_match_team_members smtm
       JOIN study_recruitments sr ON sr.id = smtm.recruitment_id`,
    );
  }

  if (await hasSharedTable("study_match_waitlist")) {
    sourceQueries.push(
      `SELECT smw.user_id AS user_id, sr.academy_id AS academy_id
       FROM study_match_waitlist smw
       JOIN study_recruitments sr ON sr.id = smw.recruitment_id`,
    );
  }

  if ((await hasSharedTable("study_group_members")) && (await hasSharedTable("study_match_teams"))) {
    sourceQueries.push(
      `SELECT sgm.user_id AS user_id, sr.academy_id AS academy_id
       FROM study_group_members sgm
       JOIN study_match_teams smt ON smt.study_group_id = sgm.study_group_id
       JOIN study_recruitments sr ON sr.id = smt.recruitment_id`,
    );
  }

  if (sourceQueries.length === 0) {
    return new Map();
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT user_id, academy_id
     FROM (${sourceQueries.join(" UNION ALL ")}) derived
     WHERE user_id IS NOT NULL
       AND academy_id IS NOT NULL
     ORDER BY user_id ASC, academy_id ASC`,
  );

  const map = new Map();
  rows.forEach((row) => {
    const userId = toPositiveInt(row.user_id);
    const academyId = toPositiveInt(row.academy_id);
    if (!userId || !academyId) return;

    const list = map.get(userId) || [];
    list.push({
      academyId,
      registeredAt: null,
    });
    map.set(userId, list);
  });

  return map;
};

const loadSharedUserStudyStatsByUserId = async () => {
  if (!(await hasSharedUserStudyStatsTable())) {
    return new Map();
  }

  const [rows] = await pool.query(
    `SELECT user_id,
            total_study_minutes,
            total_attendance_count,
            total_absence_count,
            current_streak_days,
            participation_score,
            updated_at
     FROM user_study_stats
     ORDER BY user_id ASC`,
  );

  const map = new Map();
  rows.forEach((row) => {
    const userId = toPositiveInt(row.user_id);
    if (!userId) return;
    map.set(userId, {
      totalStudyMinutes: Number(row.total_study_minutes || 0),
      totalAttendanceCount: Number(row.total_attendance_count || 0),
      totalAbsenceCount: Number(row.total_absence_count || 0),
      currentStreakDays: Number(row.current_streak_days || 0),
      participationScore: Number(row.participation_score || 0),
      updatedAt: row.updated_at || null,
    });
  });
  return map;
};

const loadComputedUserStudyStatsByAttendance = async () => {
  if (!(await hasSharedTable("attendance_logs"))) {
    return new Map();
  }

  const [rows] = await pool.query(
    `SELECT user_id,
            COALESCE(SUM(participation_minutes), 0) AS total_study_minutes,
            COALESCE(SUM(CASE WHEN attendance_status IN ('present', 'late') THEN 1 ELSE 0 END), 0) AS total_attendance_count,
            COALESCE(SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END), 0) AS total_absence_count,
            COALESCE(SUM(CASE WHEN attendance_status = 'present' THEN 1 WHEN attendance_status = 'late' THEN 0.7 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 0) AS participation_score,
            MAX(updated_at) AS updated_at
     FROM attendance_logs
     WHERE user_id IS NOT NULL
     GROUP BY user_id
     ORDER BY user_id ASC`,
  );

  const map = new Map();
  rows.forEach((row) => {
    const userId = toPositiveInt(row.user_id);
    if (!userId) return;
    map.set(userId, {
      totalStudyMinutes: Number(row.total_study_minutes || 0),
      totalAttendanceCount: Number(row.total_attendance_count || 0),
      totalAbsenceCount: Number(row.total_absence_count || 0),
      currentStreakDays: 0,
      participationScore: Number(row.participation_score || 0),
      updatedAt: row.updated_at || null,
    });
  });

  return map;
};

const ensureTenantAcademyTable = async (tenantPool) => {
  await tenantPool.query(
    `CREATE TABLE IF NOT EXISTS user_academies (
      academy_id BIGINT UNSIGNED NOT NULL,
      registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academy_id),
      KEY idx_user_academies_registered_at (registered_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
};

const ensureTenantStudyStatsTable = async (tenantPool) => {
  await tenantPool.query(
    `CREATE TABLE IF NOT EXISTS user_study_stats (
      stat_key TINYINT UNSIGNED NOT NULL,
      total_study_minutes INT UNSIGNED NOT NULL DEFAULT 0,
      total_attendance_count INT UNSIGNED NOT NULL DEFAULT 0,
      total_absence_count INT UNSIGNED NOT NULL DEFAULT 0,
      current_streak_days INT UNSIGNED NOT NULL DEFAULT 0,
      participation_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (stat_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
};

const seedTenantAcademies = async (tenantPool, academyRows) => {
  for (const row of academyRows) {
    if (row.registeredAt) {
      await tenantPool.query(`INSERT IGNORE INTO user_academies (academy_id, registered_at) VALUES (?, ?)`, [
        row.academyId,
        row.registeredAt,
      ]);
      continue;
    }
    await tenantPool.query(`INSERT IGNORE INTO user_academies (academy_id) VALUES (?)`, [row.academyId]);
  }
};

const seedTenantStudyStats = async (tenantPool, statsRow) => {
  if (!statsRow) return;
  await tenantPool.query(
    `INSERT INTO user_study_stats (
       stat_key,
       total_study_minutes,
       total_attendance_count,
       total_absence_count,
       current_streak_days,
       participation_score,
       updated_at
     )
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_study_minutes = VALUES(total_study_minutes),
       total_attendance_count = VALUES(total_attendance_count),
       total_absence_count = VALUES(total_absence_count),
       current_streak_days = VALUES(current_streak_days),
       participation_score = VALUES(participation_score),
       updated_at = VALUES(updated_at)`,
    [
      Number(statsRow.totalStudyMinutes || 0),
      Number(statsRow.totalAttendanceCount || 0),
      Number(statsRow.totalAbsenceCount || 0),
      Number(statsRow.currentStreakDays || 0),
      Number(statsRow.participationScore || 0),
      statsRow.updatedAt || new Date(),
    ],
  );
};

const run = async () => {
  const selectUsersSql = (await hasUsersAcademyColumn())
    ? `SELECT id, academy_id FROM users ORDER BY id ASC`
    : `SELECT id, NULL AS academy_id FROM users ORDER BY id ASC`;
  const [userRows] = await pool.query(selectUsersSql);
  const sharedUserAcademiesByUserId = await loadSharedUserAcademies();
  const derivedUserAcademiesByUserId = await loadDerivedUserAcademiesFromStudyData();
  const sharedUserStudyStatsByUserId = await loadSharedUserStudyStatsByUserId();
  const computedUserStudyStatsByUserId = await loadComputedUserStudyStatsByAttendance();

  let processedUsers = 0;
  let seededUsers = 0;
  let seededStatsUsers = 0;

  for (const user of userRows) {
    const userId = toPositiveInt(user.id);
    if (!userId) continue;

    processedUsers += 1;

    const academyMap = new Map();
    const legacyAcademyId = toPositiveInt(user.academy_id);
    if (legacyAcademyId) {
      academyMap.set(legacyAcademyId, { academyId: legacyAcademyId, registeredAt: null });
    }

    const sharedRows = sharedUserAcademiesByUserId.get(userId) || [];
    sharedRows.forEach((row) => {
      if (!academyMap.has(row.academyId)) {
        academyMap.set(row.academyId, row);
      }
    });
    const derivedRows = derivedUserAcademiesByUserId.get(userId) || [];
    derivedRows.forEach((row) => {
      if (!academyMap.has(row.academyId)) {
        academyMap.set(row.academyId, row);
      }
    });

    const tenantAcademySeedRows = Array.from(academyMap.values());
    const { databaseName, pool: tenantPool } = await getTenantPool(userId);
    await ensureTenantAcademyTable(tenantPool);
    await ensureTenantStudyStatsTable(tenantPool);

    if (tenantAcademySeedRows.length > 0) {
      await seedTenantAcademies(tenantPool, tenantAcademySeedRows);
      seededUsers += 1;
    }

    const sharedStats = sharedUserStudyStatsByUserId.get(userId) || null;
    const computedStats = computedUserStudyStatsByUserId.get(userId) || null;
    const statsToSeed = sharedStats || computedStats;
    if (statsToSeed) {
      await seedTenantStudyStats(tenantPool, statsToSeed);
      seededStatsUsers += 1;
    }

    console.log(
      `[tenant-provision] user=${userId} db=${databaseName} academyRows=${tenantAcademySeedRows.length} statsSource=${
        sharedStats ? "shared" : computedStats ? "attendance" : "none"
      }`,
    );
  }

  console.log(
    `[tenant-provision] done processedUsers=${processedUsers} seededAcademyUsers=${seededUsers} seededStatsUsers=${seededStatsUsers} tenantPrefix=${buildTenantDatabaseName(
      1,
    ).replace(/1$/, "")}`,
  );
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tenant-provision] failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantPools().catch(() => {});
    await closePool().catch(() => {});
  });
