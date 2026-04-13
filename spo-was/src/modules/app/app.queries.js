const APP_QUERIES = {
  SELECT_USER_STUDY_STATS_BY_USER_ID: `SELECT total_study_minutes, total_attendance_count, total_absence_count, current_streak_days, participation_score, updated_at
                                       FROM user_study_stats
                                       WHERE user_id = ?
                                       LIMIT 1`,
  SELECT_DUPLICATE_EMAIL_EXCLUDING_USER: `SELECT id
                                          FROM users
                                          WHERE email = ? AND id <> ?
                                          LIMIT 1`,
  UPDATE_USER_PROFILE_BY_ID: `UPDATE users
                              SET name = ?, email = ?
                              WHERE id = ?`,
  UPDATE_USER_PROFILE_IMAGE_BY_ID: `UPDATE users
                                    SET profile_image_url = ?
                                    WHERE id = ?`,
  SELECT_USER_PASSWORD_HASH_BY_ID: `SELECT password_hash
                                    FROM users
                                    WHERE id = ?
                                    LIMIT 1`,
  UPDATE_USER_PASSWORD_HASH_BY_ID: `UPDATE users
                                    SET password_hash = ?
                                    WHERE id = ?`,
  SELECT_ACADEMIES_BY_QUERY: `SELECT id, name, address
                              FROM academies
                              WHERE is_active = 1
                                AND name LIKE CONCAT('%', ?, '%')
                              ORDER BY name ASC
                              LIMIT 20`,
  SELECT_ACADEMIES_DEFAULT_LIST: `SELECT id, name, address
                                  FROM academies
                                  WHERE is_active = 1
                                  ORDER BY name ASC
                                  LIMIT 20`,
  SELECT_ACADEMY_BY_ID_WITH_REGISTRATION_CODE: `SELECT id, name, address, registration_code
                                                FROM academies
                                                WHERE id = ? AND is_active = 1
                                                LIMIT 1`,
  SELECT_STUDY_RECRUITMENTS_BASE: `SELECT r.id,
                                          r.academy_id,
                                          a.name AS academy_name,
                                          a.address AS academy_address,
                                          r.title,
                                          r.target_class,
                                          r.review_scope,
                                          r.ai_topic_examples,
                                          r.recruitment_start_at,
                                          r.recruitment_end_at,
                                          r.min_applicants,
                                          r.max_applicants,
                                          r.team_size,
                                          r.matching_guide,
                                          r.application_check_config,
                                          r.status,
                                          r.created_by,
                                          r.created_at,
                                          r.updated_at
                                   FROM study_recruitments r
                                   LEFT JOIN academies a ON a.id = r.academy_id`,
  SELECT_STUDY_RECRUITMENT_BY_ID: `SELECT r.id,
                                          r.academy_id,
                                          a.name AS academy_name,
                                          a.address AS academy_address,
                                          r.title,
                                          r.target_class,
                                          r.review_scope,
                                          r.ai_topic_examples,
                                          r.recruitment_start_at,
                                          r.recruitment_end_at,
                                          r.min_applicants,
                                          r.max_applicants,
                                          r.team_size,
                                          r.matching_guide,
                                          r.application_check_config,
                                          r.status,
                                          r.created_by,
                                          r.created_at,
                                          r.updated_at
                                   FROM study_recruitments r
                                   LEFT JOIN academies a ON a.id = r.academy_id
                                   WHERE r.id = ?
                                   LIMIT 1`,
  SELECT_MY_STUDY_RECRUITMENT_APPLICATION: `SELECT id,
                                                   recruitment_id,
                                                   user_id,
                                                   participation_intent,
                                                   available_time_slots,
                                                   preferred_style,
                                                   mbti_type,
                                                   custom_responses,
                                                   presentation_level,
                                                   created_at,
                                                   updated_at
                                            FROM study_recruitment_applications
                                            WHERE recruitment_id = ? AND user_id = ?
                                            LIMIT 1`,
  UPSERT_STUDY_RECRUITMENT_APPLICATION: `INSERT INTO study_recruitment_applications (
                                           recruitment_id,
                                           user_id,
                                           participation_intent,
                                           available_time_slots,
                                           preferred_style,
                                           mbti_type,
                                           custom_responses,
                                           presentation_level
                                         )
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                         ON DUPLICATE KEY UPDATE
                                           participation_intent = VALUES(participation_intent),
                                           available_time_slots = VALUES(available_time_slots),
                                           preferred_style = VALUES(preferred_style),
                                           mbti_type = VALUES(mbti_type),
                                           custom_responses = VALUES(custom_responses),
                                           presentation_level = VALUES(presentation_level),
                                           updated_at = CURRENT_TIMESTAMP`,
  SELECT_RECRUITMENT_MATCHING_BATCH_SUMMARY: `SELECT id,
                                                     recruitment_id,
                                                     requested_by_user_id,
                                                     matching_seed,
                                                     total_applicants,
                                                     assigned_applicants,
                                                     waitlisted_applicants,
                                                     status,
                                                     completed_at,
                                                     created_at,
                                                     updated_at
                                              FROM study_matching_batches
                                              WHERE recruitment_id = ? AND status = 'completed'
                                              ORDER BY id DESC
                                              LIMIT 1`,
  SELECT_RECRUITMENT_APPLICANTS_FOR_MATCHING: `SELECT a.id,
                                                      a.recruitment_id,
                                                      a.user_id,
                                                      a.participation_intent,
                                                      a.available_time_slots,
                                                      a.preferred_style,
                                                      a.mbti_type,
                                                      a.custom_responses,
                                                      a.presentation_level,
                                                      a.created_at,
                                                      a.updated_at,
                                                      u.name AS user_name,
                                                      u.login_id
                                               FROM study_recruitment_applications a
                                               JOIN users u ON u.id = a.user_id
                                               WHERE a.recruitment_id = ?
                                                 AND a.participation_intent = 'join'
                                               ORDER BY a.updated_at ASC, a.id ASC`,
  SELECT_RECRUITMENT_MATCH_TEAM_ASSIGNMENTS_BY_BATCH: `SELECT tm.user_id,
                                                              tm.role,
                                                              t.team_number
                                                       FROM study_match_teams t
                                                       JOIN study_match_team_members tm ON tm.team_id = t.id
                                                       WHERE t.recruitment_id = ?
                                                         AND t.batch_id = ?
                                                       ORDER BY t.team_number ASC, tm.id ASC`,
  SELECT_RECRUITMENT_MATCH_WAITLIST_BY_BATCH: `SELECT user_id,
                                                      waitlist_order
                                               FROM study_match_waitlist
                                               WHERE recruitment_id = ?
                                                 AND batch_id = ?
                                               ORDER BY waitlist_order ASC, id ASC`,
  INSERT_STUDY_MATCHING_BATCH: `INSERT INTO study_matching_batches (
                                  recruitment_id,
                                  requested_by_user_id,
                                  matching_seed,
                                  total_applicants,
                                  assigned_applicants,
                                  waitlisted_applicants,
                                  status
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?)`,
  COMPLETE_STUDY_MATCHING_BATCH: `UPDATE study_matching_batches
                                  SET assigned_applicants = ?,
                                      waitlisted_applicants = ?,
                                      status = ?,
                                      completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
                                  WHERE id = ?`,
  UPDATE_STUDY_RECRUITMENT_STATUS_BY_ID: `UPDATE study_recruitments
                                          SET status = ?
                                          WHERE id = ?`,
  INSERT_STUDY_MATCH_TEAM: `INSERT INTO study_match_teams (
                              batch_id,
                              recruitment_id,
                              team_number,
                              study_group_id,
                              first_meeting_at,
                              first_meeting_label
                            )
                            VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_STUDY_MATCH_TEAM_MEMBER: `INSERT INTO study_match_team_members (
                                     team_id,
                                     recruitment_id,
                                     user_id,
                                     role
                                   )
                                   VALUES (?, ?, ?, ?)`,
  INSERT_STUDY_MATCH_WAITLIST: `INSERT INTO study_match_waitlist (
                                  batch_id,
                                  recruitment_id,
                                  user_id,
                                  waitlist_order
                                )
                                VALUES (?, ?, ?, ?)`,
  SELECT_RECRUITMENT_TOTAL_JOIN_APPLICANTS: `SELECT COUNT(*) AS count
                                             FROM study_recruitment_applications
                                             WHERE recruitment_id = ?
                                               AND participation_intent = 'join'`,
  SELECT_MY_MATCH_TEAM_BY_RECRUITMENT: `SELECT t.id AS team_id,
                                               t.team_number,
                                               t.study_group_id,
                                               t.first_meeting_at,
                                               t.first_meeting_label
                                        FROM study_match_teams t
                                        JOIN study_match_team_members tm ON tm.team_id = t.id
                                        WHERE t.recruitment_id = ?
                                          AND tm.user_id = ?
                                        ORDER BY t.id DESC
                                        LIMIT 1`,
  SELECT_MATCH_TEAM_MEMBERS: `SELECT tm.user_id,
                                     tm.role,
                                     u.name,
                                     u.login_id
                              FROM study_match_team_members tm
                              JOIN users u ON u.id = tm.user_id
                              WHERE tm.team_id = ?
                              ORDER BY FIELD(tm.role, 'leader', 'member'), u.name ASC, tm.user_id ASC`,
  SELECT_MY_WAITLIST_INFO_BY_RECRUITMENT: `SELECT w.waitlist_order
                                           FROM study_match_waitlist w
                                           WHERE w.recruitment_id = ?
                                             AND w.user_id = ?
                                           ORDER BY w.id DESC
                                           LIMIT 1`,
  SELECT_MY_STUDY_GROUPS: `SELECT
                              sg.id,
                              sg.name,
                              sg.subject,
                              sg.description,
                              sg.created_by,
                              sg.max_members,
                              sg.is_active,
                              sg.created_at,
                              sg.updated_at,
                              COALESCE(academy_direct.id, group_academy.academy_id) AS academy_id,
                              COALESCE(academy_direct.name, group_academy.academy_name) AS academy_name,
                              group_academy.matching_guide,
                              COALESCE(member_stats.member_count, 0) AS member_count,
                              sgm_me.member_role AS my_role,
                              leader_stats.leader_name
                           FROM study_groups sg
                           LEFT JOIN (
                             SELECT study_group_id, COUNT(*) AS member_count
                             FROM study_group_members
                             GROUP BY study_group_id
                           ) member_stats ON member_stats.study_group_id = sg.id
                           LEFT JOIN study_group_members sgm_me
                             ON sgm_me.study_group_id = sg.id AND sgm_me.user_id = ?
                           LEFT JOIN (
                             SELECT sgm.study_group_id, MAX(u.name) AS leader_name
                             FROM study_group_members sgm
                             JOIN users u ON u.id = sgm.user_id
                             WHERE sgm.member_role = 'leader'
                             GROUP BY sgm.study_group_id
                           ) leader_stats ON leader_stats.study_group_id = sg.id
                           LEFT JOIN academies academy_direct ON academy_direct.id = sg.academy_id
                           LEFT JOIN (
                             SELECT smt.study_group_id,
                                    sr.academy_id,
                                    a.name AS academy_name,
                                    sr.matching_guide
                             FROM study_match_teams smt
                             JOIN (
                               SELECT study_group_id, MAX(id) AS latest_team_id
                               FROM study_match_teams
                               WHERE study_group_id IS NOT NULL
                               GROUP BY study_group_id
                             ) latest_team ON latest_team.latest_team_id = smt.id
                             JOIN study_recruitments sr ON sr.id = smt.recruitment_id
                             LEFT JOIN academies a ON a.id = sr.academy_id
                           ) group_academy ON group_academy.study_group_id = sg.id
                           WHERE sg.created_by = ? OR sgm_me.user_id = ?
                           ORDER BY sg.created_at DESC`,
  INSERT_STUDY_GROUP: `INSERT INTO study_groups (name, subject, description, created_by, academy_id, max_members)
                       VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_STUDY_GROUP_LEADER: `INSERT INTO study_group_members (study_group_id, user_id, member_role)
                              VALUES (?, ?, 'leader')`,
  SELECT_CREATED_STUDY_GROUP: `SELECT sg.*, academy.name AS academy_name, 1 AS member_count, 'leader' AS my_role, u.name AS leader_name
                               FROM study_groups sg
                               JOIN users u ON u.id = sg.created_by
                               LEFT JOIN academies academy ON academy.id = sg.academy_id
                               WHERE sg.id = ?`,
  SELECT_STUDY_GROUP_MEMBERSHIP_ROLE: `SELECT member_role
                                       FROM study_group_members
                                       WHERE study_group_id = ? AND user_id = ?
                                       LIMIT 1`,
  UPDATE_STUDY_GROUP_BY_ID: `UPDATE study_groups
                             SET name = ?, subject = ?, description = ?, max_members = ?, is_active = COALESCE(?, is_active)
                             WHERE id = ?`,
  SELECT_STUDY_GROUP_BY_ID_WITH_MEMBER_COUNT: `SELECT sg.*, academy.name AS academy_name, COUNT(DISTINCT sgm.id) AS member_count, 'leader' AS my_role, u.name AS leader_name
                                               FROM study_groups sg
                                               LEFT JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                               LEFT JOIN users u ON u.id = sg.created_by
                                               LEFT JOIN academies academy ON academy.id = sg.academy_id
                                               WHERE sg.id = ?
                                               GROUP BY sg.id`,
  SELECT_JOINABLE_GROUP_BY_ID_WITH_MEMBER_COUNT: `SELECT sg.*, COUNT(sgm.id) AS member_count
                                                  FROM study_groups sg
                                                  LEFT JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                                  WHERE sg.id = ?
                                                  GROUP BY sg.id`,
  INSERT_IGNORE_STUDY_GROUP_MEMBER: `INSERT IGNORE INTO study_group_members (study_group_id, user_id, member_role)
                                     VALUES (?, ?, 'member')`,
  SELECT_STUDY_SESSIONS_BY_USER_ID: `SELECT ss.*, sg.name AS group_name, sg.subject,
                                            COUNT(DISTINCT al.id) AS attendance_count,
                                            SUM(CASE WHEN al.attendance_status = 'present' THEN 1 ELSE 0 END) AS present_count,
                                            SUM(CASE WHEN al.attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
                                            SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count
                                     FROM study_sessions ss
                                     JOIN study_groups sg ON sg.id = ss.study_group_id
                                     JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                     LEFT JOIN attendance_logs al ON al.study_session_id = ss.id
                                     WHERE sgm.user_id = ?
                                     GROUP BY ss.id
                                     ORDER BY COALESCE(ss.scheduled_start_at, ss.created_at) ASC, ss.id ASC`,
  INSERT_STUDY_SESSION: `INSERT INTO study_sessions (
                           study_group_id,
                           topic_title,
                           topic_description,
                           scheduled_start_at,
                           started_at,
                           ended_at,
                           status,
                           created_by,
                           study_duration_minutes,
                           study_started_at,
                           ai_reviewed_at
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  SELECT_STUDY_SESSION_BY_ID: `SELECT ss.*, sg.name AS group_name, sg.subject, 0 AS attendance_count, 0 AS present_count, 0 AS late_count, 0 AS absent_count
                               FROM study_sessions ss
                               JOIN study_groups sg ON sg.id = ss.study_group_id
                               WHERE ss.id = ?`,
  SELECT_STUDY_SESSION_EDIT_PERMISSION: `SELECT ss.id, ss.created_by, sgm.user_id AS member_user_id
                                         FROM study_sessions ss
                                         JOIN study_group_members sgm ON sgm.study_group_id = ss.study_group_id
                                         WHERE ss.id = ? AND sgm.user_id = ?
                                         LIMIT 1`,
  UPDATE_STUDY_SESSION_BY_ID: `UPDATE study_sessions
                               SET topic_title = ?, topic_description = ?, scheduled_start_at = ?,
                                   started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
                                   ended_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP WHEN ? <> 'completed' THEN NULL ELSE ended_at END,
                                   status = ?,
                                   study_duration_minutes = CASE WHEN ? IS NULL THEN study_duration_minutes ELSE GREATEST(0, ?) END,
                                   study_started_at = CASE WHEN ? IS NULL THEN study_started_at ELSE ? END,
                                   ai_reviewed_at = CASE WHEN ? IS NULL THEN ai_reviewed_at ELSE ? END
                               WHERE id = ?`,
  SELECT_STUDY_SESSION_WITH_ATTENDANCE_BY_ID: `SELECT ss.*, sg.name AS group_name, sg.subject,
                                                      COUNT(DISTINCT al.id) AS attendance_count,
                                                      SUM(CASE WHEN al.attendance_status = 'present' THEN 1 ELSE 0 END) AS present_count,
                                                      SUM(CASE WHEN al.attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
                                                      SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count
                                               FROM study_sessions ss
                                               JOIN study_groups sg ON sg.id = ss.study_group_id
                                               LEFT JOIN attendance_logs al ON al.study_session_id = ss.id
                                               WHERE ss.id = ?
                                               GROUP BY ss.id`,
  SELECT_STUDY_SESSION_MEMBERSHIP_FOR_ATTENDANCE: `SELECT sgm.member_role
                                                   FROM study_sessions ss
                                                   JOIN study_group_members sgm ON sgm.study_group_id = ss.study_group_id
                                                   WHERE ss.id = ? AND sgm.user_id = ?
                                                   LIMIT 1`,
  UPSERT_ATTENDANCE_LOG: `INSERT INTO attendance_logs (study_session_id, user_id, attendance_status, checked_in_at, checked_out_at, participation_minutes)
                          VALUES (?, ?, ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE
                            attendance_status = VALUES(attendance_status),
                            checked_in_at = VALUES(checked_in_at),
                            checked_out_at = VALUES(checked_out_at),
                            participation_minutes = VALUES(participation_minutes)`,
  UPSERT_STUDY_TIME_ATTENDANCE_LOG: `INSERT INTO attendance_logs (
                                       study_session_id,
                                       user_id,
                                       attendance_status,
                                       checked_in_at,
                                       checked_out_at,
                                       participation_minutes
                                     )
                                     VALUES (?, ?, 'present', ?, ?, ?)
                                     ON DUPLICATE KEY UPDATE
                                       checked_in_at = COALESCE(checked_in_at, VALUES(checked_in_at)),
                                       checked_out_at = VALUES(checked_out_at),
                                       participation_minutes = VALUES(participation_minutes)`,
  SELECT_ATTENDANCE_BY_SESSION_AND_USER: `SELECT al.*, u.name AS user_name, u.login_id, ss.topic_title, sg.name AS group_name
                                          FROM attendance_logs al
                                          JOIN users u ON u.id = al.user_id
                                          JOIN study_sessions ss ON ss.id = al.study_session_id
                                          JOIN study_groups sg ON sg.id = ss.study_group_id
                                          WHERE al.study_session_id = ? AND al.user_id = ?
                                          LIMIT 1`,
  SELECT_ATTENDANCE_STATS_BY_USER_ID: `SELECT
                                          COALESCE(SUM(participation_minutes), 0) AS total_study_minutes,
                                          COALESCE(SUM(CASE WHEN attendance_status IN ('present', 'late') THEN 1 ELSE 0 END), 0) AS total_attendance_count,
                                          COALESCE(SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END), 0) AS total_absence_count,
                                          COALESCE(SUM(CASE WHEN attendance_status = 'present' THEN 1 WHEN attendance_status = 'late' THEN 0.7 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 0) AS participation_score
                                       FROM attendance_logs
                                       WHERE user_id = ?`,
  UPSERT_USER_STUDY_STATS: `INSERT INTO user_study_stats (user_id, total_study_minutes, total_attendance_count, total_absence_count, current_streak_days, participation_score)
                            VALUES (?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                              total_study_minutes = VALUES(total_study_minutes),
                              total_attendance_count = VALUES(total_attendance_count),
                              total_absence_count = VALUES(total_absence_count),
                              current_streak_days = VALUES(current_streak_days),
                              participation_score = VALUES(participation_score)`,
  SELECT_ATTENDANCE_SUMMARY_BY_USER_ID: `SELECT
                                            COUNT(*) AS totalRecords,
                                            SUM(CASE WHEN al.attendance_status = 'present' THEN 1 ELSE 0 END) AS presentCount,
                                            SUM(CASE WHEN al.attendance_status = 'late' THEN 1 ELSE 0 END) AS lateCount,
                                            SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
                                            COALESCE(SUM(al.participation_minutes), 0) AS totalMinutes
                                         FROM attendance_logs al
                                         WHERE al.user_id = ?`,
  SELECT_DASHBOARD_GROUPS_BY_USER_ID: `SELECT sg.*, COUNT(DISTINCT sgm_all.id) AS member_count,
                                              MAX(CASE WHEN sgm_me.user_id = ? THEN sgm_me.member_role END) AS my_role
                                       FROM study_groups sg
                                       JOIN study_group_members sgm_me ON sgm_me.study_group_id = sg.id AND sgm_me.user_id = ?
                                       LEFT JOIN study_group_members sgm_all ON sgm_all.study_group_id = sg.id
                                       GROUP BY sg.id
                                       ORDER BY sg.created_at DESC
                                       LIMIT 5`,
  SELECT_DASHBOARD_SESSIONS_BY_USER_ID: `SELECT ss.*, sg.name AS group_name, sg.subject,
                                                COUNT(DISTINCT al.id) AS attendance_count,
                                                SUM(CASE WHEN al.attendance_status = 'present' THEN 1 ELSE 0 END) AS present_count,
                                                SUM(CASE WHEN al.attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
                                                SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count
                                         FROM study_sessions ss
                                         JOIN study_groups sg ON sg.id = ss.study_group_id
                                         JOIN study_group_members sgm ON sgm.study_group_id = sg.id AND sgm.user_id = ?
                                         LEFT JOIN attendance_logs al ON al.study_session_id = ss.id
                                         GROUP BY ss.id
                                         ORDER BY COALESCE(ss.scheduled_start_at, ss.created_at) ASC
                                         LIMIT 6`,
  SELECT_DASHBOARD_REWARDS_BY_USER_ID: `SELECT reward_type, reward_name, reward_amount, reward_status, granted_at, created_at
                                        FROM rewards
                                        WHERE user_id = ?
                                        ORDER BY created_at DESC
                                        LIMIT 3`,
  SELECT_DASHBOARD_TODAY_SCHEDULE_BY_USER_ID: `SELECT ss.id, ss.topic_title, ss.scheduled_start_at, ss.status, sg.name AS group_name
                                               FROM study_sessions ss
                                               JOIN study_groups sg ON sg.id = ss.study_group_id
                                               JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                               WHERE sgm.user_id = ?
                                                 AND DATE(COALESCE(ss.scheduled_start_at, ss.created_at)) = CURRENT_DATE()
                                               ORDER BY COALESCE(ss.scheduled_start_at, ss.created_at) ASC`,
};

const buildListAttendanceQuery = (withStudySessionFilter) => `SELECT combined.*
                                                              FROM (
                                                                SELECT al.id,
                                                                       al.study_session_id,
                                                                       al.user_id,
                                                                       al.attendance_status,
                                                                       al.checked_in_at,
                                                                       al.checked_out_at,
                                                                       al.participation_minutes,
                                                                       al.created_at,
                                                                       al.updated_at,
                                                                       u.name AS user_name,
                                                                       u.login_id,
                                                                       ss.topic_title,
                                                                       sg.name AS group_name
                                                                FROM attendance_logs al
                                                                JOIN users u ON u.id = al.user_id
                                                                JOIN study_sessions ss ON ss.id = al.study_session_id
                                                                JOIN study_groups sg ON sg.id = ss.study_group_id
                                                                JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                                                WHERE sgm.user_id = ?${withStudySessionFilter ? " AND al.study_session_id = ?" : ""}
                                                                UNION ALL
                                                                SELECT -ss.id AS id,
                                                                       ss.id AS study_session_id,
                                                                       ss.created_by AS user_id,
                                                                       'present' AS attendance_status,
                                                                       COALESCE(ss.study_started_at, ss.scheduled_start_at, ss.created_at) AS checked_in_at,
                                                                       COALESCE(
                                                                         ss.ai_reviewed_at,
                                                                         ss.study_started_at,
                                                                         ss.scheduled_start_at,
                                                                         ss.updated_at,
                                                                         ss.created_at
                                                                       ) AS checked_out_at,
                                                                       GREATEST(0, COALESCE(ss.study_duration_minutes, 0)) AS participation_minutes,
                                                                       COALESCE(ss.ai_reviewed_at, ss.updated_at, ss.created_at) AS created_at,
                                                                       COALESCE(ss.updated_at, ss.created_at) AS updated_at,
                                                                       u_creator.name AS user_name,
                                                                       u_creator.login_id,
                                                                       ss.topic_title,
                                                                       sg.name AS group_name
                                                                FROM study_sessions ss
                                                                JOIN study_groups sg ON sg.id = ss.study_group_id
                                                                JOIN study_group_members sgm ON sgm.study_group_id = sg.id
                                                                JOIN users u_creator ON u_creator.id = ss.created_by
                                                                LEFT JOIN attendance_logs al_existing
                                                                  ON al_existing.study_session_id = ss.id
                                                                 AND al_existing.user_id = ss.created_by
                                                                WHERE sgm.user_id = ?${withStudySessionFilter ? " AND ss.id = ?" : ""}
                                                                  AND al_existing.id IS NULL
                                                                  AND (
                                                                    COALESCE(ss.study_duration_minutes, 0) > 0
                                                                    OR ss.study_started_at IS NOT NULL
                                                                    OR ss.ai_reviewed_at IS NOT NULL
                                                                  )
                                                              ) AS combined
                                                              ORDER BY combined.created_at DESC, combined.id DESC`;

module.exports = {
  APP_QUERIES,
  buildListAttendanceQuery,
};
