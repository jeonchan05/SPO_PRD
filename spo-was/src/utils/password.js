const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

const hashPassword = async (plainPassword) => {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const derivedKey = await scryptAsync(plainPassword, salt, KEY_LENGTH);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
};

const verifyPassword = async (plainPassword, storedHash) => {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  const [salt, hashedPassword] = storedHash.split(":");
  const derivedKey = await scryptAsync(plainPassword, salt, KEY_LENGTH);
  const hashedBuffer = Buffer.from(hashedPassword, "hex");

  if (hashedBuffer.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashedBuffer, Buffer.from(derivedKey));
};

module.exports = {
  hashPassword,
  verifyPassword,
};
