const AUTH_QUERIES = {
  SELECT_DUPLICATE_USER_BY_LOGIN_ID_OR_EMAIL: `SELECT id, login_id, email
                                               FROM users
                                               WHERE login_id = ? OR email = ?
                                               LIMIT 1`,
  SELECT_USER_BY_LOGIN_ID: `SELECT id
                            FROM users
                            WHERE login_id = ?
                            LIMIT 1`,
  INSERT_USER: `INSERT INTO users (login_id, email, password_hash, name, phone_number, profile_image_url, role)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
  SELECT_USER_BY_LOGIN_OR_EMAIL_FOR_SIGN_IN: `SELECT id, login_id, email, password_hash, name, phone_number, profile_image_url, role, status, created_at
                                              FROM users
                                              WHERE login_id = ? OR email = ?
                                              LIMIT 1`,
  SELECT_LOGIN_ID_BY_NAME_AND_EMAIL: `SELECT login_id, name, created_at
                                      FROM users
                                      WHERE name = ? AND email = ?
                                      LIMIT 1`,
  SELECT_USER_FOR_PASSWORD_RESET: `SELECT id, login_id, email, password_hash
                                   FROM users
                                   WHERE (login_id = ? OR email = ?) AND email = ?
                                   LIMIT 1`,
  UPDATE_USER_PASSWORD_BY_ID: `UPDATE users
                               SET password_hash = ?
                               WHERE id = ?`,
};

module.exports = {
  AUTH_QUERIES,
};
