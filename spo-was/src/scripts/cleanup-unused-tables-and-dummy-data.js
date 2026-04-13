const { pool, closePool } = require("../config/db");

const DUMMY_TEXT_REGEX = "(DEMO|더미|샘플|자동입력|dummy|sample|테스트)";
const DUMMY_RECRUITMENT_EXACT_TITLES = ["부트캠프 데일리 복습 스터디 모집"];
const UNUSED_LEGACY_TABLES = ["ai_feedbacks", "ai_topic_recommendations"];
const DUMMY_USER_LOGIN_PATTERNS = ["mbti_dummy_%", "academytest%"];
const DUMMY_USER_NAME_PATTERNS = ["MBTI 더미%"];

const quoteIdentifier = (value) => `\`${String(value).replace(/`/g, "``")}\``;

const countRows = async (connection, tableName) => {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
  return Number(rows?.[0]?.count || 0);
};

const collectIds = async (connection, sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
};

const withInClause = (baseSql, ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return {
    sql: `${baseSql} (${ids.map(() => "?").join(", ")})`,
    params: ids,
  };
};

const runDelete = async (connection, sql, params = []) => {
  const [result] = await connection.query(sql, params);
  return Number(result?.affectedRows || 0);
};

const hasTable = async (connection, tableName) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.count || 0) > 0;
};

const dropUnusedLegacyTables = async (connection, summary) => {
  for (const tableName of UNUSED_LEGACY_TABLES) {
    const before = await countRows(connection, tableName).catch(() => null);
    await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    summary.droppedTables.push({
      table: tableName,
      dropped: true,
      rowsBeforeDrop: before,
    });
  }
};

const cleanupDummyRecruitmentsAndGroups = async (connection, summary) => {
  const recruitmentTitlePlaceholders = DUMMY_RECRUITMENT_EXACT_TITLES.map(() => "?").join(", ");
  const recruitmentIds = await collectIds(
    connection,
    `SELECT DISTINCT id
     FROM study_recruitments
     WHERE title REGEXP ?
        OR title IN (${recruitmentTitlePlaceholders})`,
    [DUMMY_TEXT_REGEX, ...DUMMY_RECRUITMENT_EXACT_TITLES],
  );

  const groupIds = await collectIds(
    connection,
    `SELECT DISTINCT sg.id
     FROM study_groups sg
     LEFT JOIN study_match_teams smt ON smt.study_group_id = sg.id
     WHERE sg.name REGEXP ?
        OR COALESCE(sg.subject, '') REGEXP ?
        OR smt.recruitment_id IN (${recruitmentIds.length > 0 ? recruitmentIds.map(() => "?").join(", ") : "0"})`,
    [DUMMY_TEXT_REGEX, DUMMY_TEXT_REGEX, ...recruitmentIds],
  );

  summary.recruitmentIds = recruitmentIds;
  summary.groupIds = groupIds;

  if (groupIds.length > 0) {
    const groupDelete = withInClause(
      `DELETE al
       FROM attendance_logs al
       JOIN study_sessions ss ON ss.id = al.study_session_id
       WHERE ss.study_group_id IN`,
      groupIds,
    );
    summary.deleted.attendanceLogs += await runDelete(connection, groupDelete.sql, groupDelete.params);

    const noteDelete = withInClause(
      `DELETE sn
       FROM study_notes sn
       JOIN study_sessions ss ON ss.id = sn.study_session_id
       WHERE ss.study_group_id IN`,
      groupIds,
    );
    summary.deleted.studyNotes += await runDelete(connection, noteDelete.sql, noteDelete.params);

    const sessionDelete = withInClause(`DELETE FROM study_sessions WHERE study_group_id IN`, groupIds);
    summary.deleted.studySessions += await runDelete(connection, sessionDelete.sql, sessionDelete.params);

    const memberDelete = withInClause(`DELETE FROM study_group_members WHERE study_group_id IN`, groupIds);
    summary.deleted.studyGroupMembers += await runDelete(connection, memberDelete.sql, memberDelete.params);

    const inventoryDelete = withInClause(`DELETE FROM reward_inventories WHERE study_group_id IN`, groupIds);
    summary.deleted.rewardInventories += await runDelete(connection, inventoryDelete.sql, inventoryDelete.params);

    const spinLogDelete = withInClause(`DELETE FROM reward_spin_logs WHERE study_group_id IN`, groupIds);
    summary.deleted.rewardSpinLogs += await runDelete(connection, spinLogDelete.sql, spinLogDelete.params);

    const groupDeleteSql = withInClause(`DELETE FROM study_groups WHERE id IN`, groupIds);
    summary.deleted.studyGroups += await runDelete(connection, groupDeleteSql.sql, groupDeleteSql.params);
  }

  if (recruitmentIds.length > 0) {
    const recruitmentDelete = withInClause(`DELETE FROM study_recruitments WHERE id IN`, recruitmentIds);
    summary.deleted.studyRecruitments += await runDelete(connection, recruitmentDelete.sql, recruitmentDelete.params);
  }
};

const cleanupDummyUsers = async (connection, summary) => {
  const userIds = await collectIds(
    connection,
    `SELECT DISTINCT id
     FROM users
     WHERE login_id LIKE ?
        OR login_id LIKE ?
        OR name LIKE ?`,
    [...DUMMY_USER_LOGIN_PATTERNS, ...DUMMY_USER_NAME_PATTERNS],
  );

  summary.userIds = userIds;
  if (userIds.length === 0) return;

  const friendshipsDelete = withInClause(
    `DELETE FROM friendships
     WHERE requester_user_id IN`,
    userIds,
  );
  summary.deleted.friendships += await runDelete(connection, friendshipsDelete.sql, friendshipsDelete.params);

  const friendshipsDelete2 = withInClause(
    `DELETE FROM friendships
     WHERE addressee_user_id IN`,
    userIds,
  );
  summary.deleted.friendships += await runDelete(connection, friendshipsDelete2.sql, friendshipsDelete2.params);

  const queries = [
    { key: "attendanceLogs", sql: `DELETE FROM attendance_logs WHERE user_id IN` },
    { key: "studyNotes", sql: `DELETE FROM study_notes WHERE user_id IN` },
    { key: "studyGroupMembers", sql: `DELETE FROM study_group_members WHERE user_id IN` },
    { key: "studySessions", sql: `DELETE FROM study_sessions WHERE created_by IN` },
    { key: "studyGroups", sql: `DELETE FROM study_groups WHERE created_by IN` },
    { key: "uploadedMaterials", sql: `DELETE FROM uploaded_materials WHERE user_id IN` },
    { key: "materialAiFeedbacks", sql: `DELETE FROM material_ai_feedbacks WHERE user_id IN` },
    { key: "materialAiTopicRecommendations", sql: `DELETE FROM material_ai_topic_recommendations WHERE user_id IN` },
    { key: "rewards", sql: `DELETE FROM rewards WHERE user_id IN` },
    { key: "userStudyStats", sql: `DELETE FROM user_study_stats WHERE user_id IN` },
    { key: "studyMatchingBatches", sql: `DELETE FROM study_matching_batches WHERE requested_by_user_id IN` },
  ];

  for (const query of queries) {
    const built = withInClause(query.sql, userIds);
    summary.deleted[query.key] += await runDelete(connection, built.sql, built.params);
  }

  if (await hasTable(connection, "ai_feedbacks")) {
    const built = withInClause(`DELETE FROM ai_feedbacks WHERE user_id IN`, userIds);
    summary.deleted.legacyAiFeedbacks += await runDelete(connection, built.sql, built.params);
  }
  if (await hasTable(connection, "ai_topic_recommendations")) {
    const built = withInClause(`DELETE FROM ai_topic_recommendations WHERE user_id IN`, userIds);
    summary.deleted.legacyAiTopicRecommendations += await runDelete(connection, built.sql, built.params);
  }

  const usersDelete = withInClause(`DELETE FROM users WHERE id IN`, userIds);
  summary.deleted.users += await runDelete(connection, usersDelete.sql, usersDelete.params);
};

const dropDummyTenantDatabases = async (connection, userIds, summary) => {
  const tenantPrefix = String(process.env.TENANT_DB_PREFIX || "spo-tenant-").trim() || "spo-tenant-";
  for (const userId of userIds) {
    const dbName = `${tenantPrefix}${userId}`;
    await connection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`);
    summary.droppedTenantDatabases.push(dbName);
  }
};

const run = async () => {
  const summary = {
    droppedTables: [],
    droppedTenantDatabases: [],
    recruitmentIds: [],
    groupIds: [],
    userIds: [],
    deleted: {
      attendanceLogs: 0,
      studyNotes: 0,
      studySessions: 0,
      studyGroupMembers: 0,
      rewardInventories: 0,
      rewardSpinLogs: 0,
      studyGroups: 0,
      studyRecruitments: 0,
      friendships: 0,
      uploadedMaterials: 0,
      materialAiFeedbacks: 0,
      materialAiTopicRecommendations: 0,
      legacyAiFeedbacks: 0,
      legacyAiTopicRecommendations: 0,
      rewards: 0,
      userStudyStats: 0,
      studyMatchingBatches: 0,
      users: 0,
    },
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await cleanupDummyRecruitmentsAndGroups(connection, summary);
    await cleanupDummyUsers(connection, summary);
    await connection.commit();

    await dropUnusedLegacyTables(connection, summary);
    await dropDummyTenantDatabases(connection, summary.userIds, summary);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    connection.release();
  }

  console.log(`[cleanup] summary: ${JSON.stringify(summary, null, 2)}`);
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup] failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
