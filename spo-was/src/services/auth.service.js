const { pool } = require("../config/db");
const { defaultProfileImageUrl } = require("../config/minio");
const { hashPassword, verifyPassword } = require("../utils/password");
const {
  normalizeString,
  normalizeNullableString,
  normalizeEmail,
  normalizeLoginId,
  normalizeName,
} = require("../modules/common/value.utils");
const { mapAuthUser } = require("../modules/common/user.mapper");
const { fetchUserById } = require("../modules/common/user.repository");
const { getTenantPool } = require("../modules/common/tenant-db");
const { AUTH_QUERIES } = require("../modules/auth/auth.queries");
const {
  validateEmail,
  validateLoginId,
  validateName,
  validatePhoneNumber,
  validatePassword,
} = require("../modules/auth/auth.validation");
const { uploadProfileImage, removeProfileImage } = require("../modules/auth/profile-image.storage");

const normalizePhoneNumber = (value) => {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized.replace(/[()\s-]/g, "");
};

const normalizeTermsAgreement = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes";
};

const normalizeUserType = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "academy" || normalized === "mentor") return "academy";
  return "student";
};

const normalizeBusinessRegistrationNumber = (value) => {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized.replace(/[^0-9]/g, "");
};

const validateBusinessRegistrationNumber = (value) => /^[0-9]{10}$/.test(String(value || ""));

let signUpSchemaReady = false;
let signUpSchemaInitPromise = null;

const ensureTenantAcademyMembershipTable = async (userId) => {
  const { pool: tenantPool } = await getTenantPool(userId);
  await tenantPool.query(
    `CREATE TABLE IF NOT EXISTS user_academies (
      academy_id BIGINT UNSIGNED NOT NULL,
      registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academy_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  return tenantPool;
};

const ensureSignUpSchema = async () => {
  if (signUpSchemaReady) return;
  if (signUpSchemaInitPromise) {
    await signUpSchemaInitPromise;
    return;
  }

  signUpSchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      const [roleColumnRows] = await connection.query(
        `SELECT COLUMN_TYPE
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'users'
           AND column_name = 'role'
         LIMIT 1`,
      );
      const roleColumnType = String(roleColumnRows[0]?.COLUMN_TYPE || "");
      if (!roleColumnType.includes("'academy'")) {
        await connection.query(
          `ALTER TABLE users
           MODIFY COLUMN role ENUM('student', 'academy', 'mentor', 'operator', 'admin')
           NOT NULL DEFAULT 'student'`,
        );
      }

      const [academyTableRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'`,
      );
      if (Number(academyTableRows[0]?.count || 0) === 0) {
        await connection.query(
          `CREATE TABLE academies (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(120) NOT NULL,
            address VARCHAR(255) NULL,
            business_registration_number VARCHAR(30) NULL,
            registration_code VARCHAR(40) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_academies_name (name),
            UNIQUE KEY uq_academies_business_registration_number (business_registration_number),
            KEY idx_academies_is_active (is_active)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
      }

      const [businessColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'
           AND column_name = 'business_registration_number'`,
      );
      if (Number(businessColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academies
           ADD COLUMN business_registration_number VARCHAR(30) NULL AFTER address`,
        );
      }

      const [businessIndexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'
           AND index_name = 'uq_academies_business_registration_number'`,
      );
      if (Number(businessIndexRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academies
           ADD UNIQUE KEY uq_academies_business_registration_number (business_registration_number)`,
        );
      }

      signUpSchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      signUpSchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (signUpSchemaReady) {
        signUpSchemaInitPromise = null;
      }
    });

  await signUpSchemaInitPromise;
};

const checkLoginIdAvailability = async ({ loginId }) => {
  const normalizedLoginId = normalizeLoginId(loginId);

  if (!validateLoginId(normalizedLoginId)) {
    return {
      status: 400,
      body: {
        message: "아이디 형식이 올바르지 않습니다. (영문 소문자/숫자/._- 4~30자)",
      },
    };
  }

  const [rows] = await pool.query(AUTH_QUERIES.SELECT_USER_BY_LOGIN_ID, [normalizedLoginId]);
  const available = rows.length === 0;

  return {
    status: 200,
    body: {
      message: available ? "사용 가능한 아이디입니다." : "이미 사용 중인 아이디입니다.",
      loginId: normalizedLoginId,
      available,
    },
  };
};

const signUp = async (
  {
    userType,
    loginId,
    email,
    password,
    passwordConfirm,
    name,
    phoneNumber,
    termsAgreed,
    academyName,
    academyAddress,
    businessRegistrationNumber,
  },
  profileImageFile,
) => {
  await ensureSignUpSchema();

  const normalizedUserType = normalizeUserType(userType);
  const normalizedLoginId = normalizeLoginId(loginId);
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const agreedToTerms = normalizeTermsAgreement(termsAgreed);
  const normalizedAcademyName = normalizeString(academyName);
  const normalizedAcademyAddress = normalizeNullableString(academyAddress);
  const normalizedBusinessRegistrationNumber = normalizeBusinessRegistrationNumber(businessRegistrationNumber);

  if (
    !validateLoginId(normalizedLoginId) ||
    !validateEmail(normalizedEmail) ||
    !validateName(normalizedName) ||
    !validatePassword(password)
  ) {
    return {
      status: 400,
      body: {
        message:
          "이름(2~100자), 아이디(영문 소문자/숫자/._- 4~30자), 올바른 이메일, 비밀번호(8~72자/영문+숫자+특수문자)를 입력해주세요.",
      },
    };
  }

  if (password !== passwordConfirm) {
    return {
      status: 400,
      body: {
        message: "비밀번호 확인이 일치하지 않습니다.",
      },
    };
  }

  if (normalizedPhoneNumber && !validatePhoneNumber(normalizedPhoneNumber)) {
    return {
      status: 400,
      body: {
        message: "전화번호 형식이 올바르지 않습니다.",
      },
    };
  }

  if (!agreedToTerms) {
    return {
      status: 400,
      body: {
        message: "이용약관 및 개인정보 수집·이용에 동의해주세요.",
      },
    };
  }

  if (normalizedUserType === "academy") {
    if (!normalizedAcademyName || normalizedAcademyName.length < 2) {
      return {
        status: 400,
        body: {
          message: "학원 가입자는 학원명을 2자 이상 입력해주세요.",
        },
      };
    }

    if (!normalizedAcademyAddress) {
      return {
        status: 400,
        body: {
          message: "학원 가입자는 학원 주소를 입력해주세요.",
        },
      };
    }

    if (!validateBusinessRegistrationNumber(normalizedBusinessRegistrationNumber)) {
      return {
        status: 400,
        body: {
          message: "사업자번호는 숫자 10자리로 입력해주세요.",
        },
      };
    }
  }

  const connection = await pool.getConnection();
  let uploadedObjectName = null;

  try {
    await connection.beginTransaction();
    const [duplicateRows] = await connection.query(AUTH_QUERIES.SELECT_DUPLICATE_USER_BY_LOGIN_ID_OR_EMAIL, [
      normalizedLoginId,
      normalizedEmail,
    ]);

      if (duplicateRows.length > 0) {
      await connection.rollback();
      const duplicate = duplicateRows[0];
      return {
        status: 409,
        body: {
          message:
            duplicate.login_id === normalizedLoginId
              ? "이미 사용 중인 아이디입니다."
              : "이미 가입된 이메일입니다.",
        },
      };
    }

    let finalProfileImageUrl = defaultProfileImageUrl;
    if (profileImageFile) {
      try {
        const uploaded = await uploadProfileImage(profileImageFile);
        uploadedObjectName = uploaded.objectName;
        finalProfileImageUrl = uploaded.publicUrl;
      } catch (error) {
        if (error && error.code === "MINIO_NOT_CONFIGURED") {
          await connection.rollback();
          return {
            status: 503,
            body: {
              message: "이미지 저장소(MinIO) 설정이 되어있지 않아 프로필 업로드를 처리할 수 없습니다.",
            },
          };
        }

        await connection.rollback();
        return {
          status: 500,
          body: {
            message: "프로필 이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.",
          },
        };
      }
    }

    let academyId = null;
    if (normalizedUserType === "academy") {
      const [duplicateAcademyRows] = await connection.query(
        `SELECT id
         FROM academies
         WHERE business_registration_number = ?
         LIMIT 1`,
        [normalizedBusinessRegistrationNumber],
      );

      if (duplicateAcademyRows.length > 0) {
        await connection.rollback();
        return {
          status: 409,
          body: {
            message: "이미 등록된 사업자번호입니다.",
          },
        };
      }

      const registrationCode = `ACA${Date.now().toString().slice(-8)}`;
      const [academyResult] = await connection.query(
        `INSERT INTO academies (name, address, business_registration_number, registration_code, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [
          normalizedAcademyName,
          normalizedAcademyAddress,
          normalizedBusinessRegistrationNumber,
          registrationCode,
        ],
      );
      academyId = Number(academyResult.insertId || 0) || null;
    }

    const passwordHash = await hashPassword(password);
    const [result] = await connection.query(AUTH_QUERIES.INSERT_USER, [
      normalizedLoginId,
      normalizedEmail,
      passwordHash,
      normalizedName,
      normalizedPhoneNumber,
      finalProfileImageUrl,
      normalizedUserType,
    ]);

    if (normalizedUserType === "academy" && academyId) {
      const tenantPool = await ensureTenantAcademyMembershipTable(result.insertId);
      await tenantPool.query(`INSERT IGNORE INTO user_academies (academy_id) VALUES (?)`, [academyId]);
    }

    await connection.commit();

    const user = await fetchUserById(connection, result.insertId);
    if (!user) {
      await connection.rollback();
      return {
        status: 500,
        body: {
          message: "회원가입 처리 후 사용자 조회에 실패했습니다.",
        },
      };
    }

    return {
      status: 201,
      body: {
        message: "회원가입이 완료되었습니다.",
        user: mapAuthUser(user),
      },
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // no-op
    }
    if (uploadedObjectName) {
      await removeProfileImage(uploadedObjectName);
    }
    throw error;
  } finally {
    connection.release();
  }
};

const signIn = async ({ loginIdOrEmail, password }) => {
  const loginValue = normalizeString(loginIdOrEmail).toLowerCase();

  if (!loginValue || typeof password !== "string" || password.length === 0 || password.length > 200) {
    return {
      status: 400,
      body: {
        message: "아이디 또는 이메일과 비밀번호를 입력해주세요.",
      },
    };
  }

  const [rows] = await pool.query(AUTH_QUERIES.SELECT_USER_BY_LOGIN_OR_EMAIL_FOR_SIGN_IN, [
    loginValue,
    loginValue,
  ]);

  if (rows.length === 0) {
    return {
      status: 401,
      body: {
        message: "아이디/이메일 또는 비밀번호가 올바르지 않습니다.",
      },
    };
  }

  const user = rows[0];

  if (user.status !== "active") {
    return {
      status: 403,
      body: {
        message: "비활성화된 계정입니다. 관리자에게 문의해주세요.",
      },
    };
  }

  const isValidPassword = await verifyPassword(password, user.password_hash);

  if (!isValidPassword) {
    return {
      status: 401,
      body: {
        message: "아이디/이메일 또는 비밀번호가 올바르지 않습니다.",
      },
    };
  }

  return {
    status: 200,
    body: {
      message: "로그인에 성공했습니다.",
      user: mapAuthUser(user),
    },
  };
};

const findLoginId = async ({ name, email }) => {
  const normalizedName = normalizeName(name);
  const normalizedEmail = normalizeEmail(email);

  if (!validateName(normalizedName) || !validateEmail(normalizedEmail)) {
    return {
      status: 400,
      body: {
        message: "이름과 이메일 형식을 확인해주세요.",
      },
    };
  }

  const [rows] = await pool.query(AUTH_QUERIES.SELECT_LOGIN_ID_BY_NAME_AND_EMAIL, [
    normalizedName,
    normalizedEmail,
  ]);

  if (rows.length === 0) {
    return {
      status: 404,
      body: {
        message: "일치하는 회원 정보를 찾을 수 없습니다.",
      },
    };
  }

  return {
    status: 200,
    body: {
      message: "회원님의 아이디를 찾았습니다.",
      loginId: rows[0].login_id,
      name: rows[0].name,
      joinedAt: rows[0].created_at,
    },
  };
};

const resetPassword = async ({ loginIdOrEmail, email, newPassword }) => {
  const loginValue = normalizeString(loginIdOrEmail).toLowerCase();
  const normalizedEmail = normalizeEmail(email);

  if (!loginValue || !validateEmail(normalizedEmail) || !validatePassword(newPassword)) {
    return {
      status: 400,
      body: {
        message:
          "아이디/이메일, 가입 이메일, 새 비밀번호(8~72자/영문+숫자+특수문자)를 입력해주세요.",
      },
    };
  }

  const [rows] = await pool.query(AUTH_QUERIES.SELECT_USER_FOR_PASSWORD_RESET, [
    loginValue,
    loginValue,
    normalizedEmail,
  ]);

  if (rows.length === 0) {
    return {
      status: 404,
      body: {
        message: "입력한 정보와 일치하는 회원을 찾을 수 없습니다.",
      },
    };
  }

  const isSamePassword = await verifyPassword(newPassword, rows[0].password_hash);
  if (isSamePassword) {
    return {
      status: 400,
      body: {
        message: "새 비밀번호는 기존 비밀번호와 다르게 설정해주세요.",
      },
    };
  }

  const passwordHash = await hashPassword(newPassword);
  await pool.query(AUTH_QUERIES.UPDATE_USER_PASSWORD_BY_ID, [passwordHash, rows[0].id]);

  return {
    status: 200,
    body: {
      message: "비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.",
      loginId: rows[0].login_id,
      email: rows[0].email,
    },
  };
};

const getSessionUser = async (userId) => {
  const user = await fetchUserById(pool, userId);
  if (!user) {
    return {
      status: 404,
      body: {
        message: "사용자 정보를 찾을 수 없습니다.",
      },
    };
  }

  if (user.status !== "active") {
    return {
      status: 403,
      body: {
        message: "비활성화된 계정입니다. 관리자에게 문의해주세요.",
      },
    };
  }

  return {
    status: 200,
    body: {
      message: "인증된 사용자입니다.",
      user: mapAuthUser(user),
    },
  };
};

module.exports = {
  checkLoginIdAvailability,
  signUp,
  signIn,
  findLoginId,
  resetPassword,
  getSessionUser,
};
