const COMMON_USER_QUERIES = {
  SELECT_USER_BY_ID: `SELECT id, login_id, email, name, phone_number, profile_image_url, role, status, created_at, updated_at
                      FROM users
                      WHERE id = ?
                      LIMIT 1`,
};

const fetchUserById = async (executor, userId) => {
  const [rows] = await executor.query(COMMON_USER_QUERIES.SELECT_USER_BY_ID, [userId]);
  return rows[0] || null;
};

module.exports = {
  COMMON_USER_QUERIES,
  fetchUserById,
};
