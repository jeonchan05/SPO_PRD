const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_ID_REGEX = /^[a-z0-9._-]{4,30}$/;
const PHONE_NUMBER_REGEX = /^\+?[0-9]{7,20}$/;

const validateEmail = (email) => EMAIL_REGEX.test(email) && email.length <= 191;
const validateLoginId = (loginId) => LOGIN_ID_REGEX.test(loginId);
const validateName = (name) => typeof name === "string" && name.length >= 2 && name.length <= 100;
const validatePhoneNumber = (phoneNumber) =>
  typeof phoneNumber === "string" && PHONE_NUMBER_REGEX.test(phoneNumber);

const validatePassword = (password) => {
  if (typeof password !== "string") return false;
  if (password.length < 8 || password.length > 72) return false;

  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  return hasLetter && hasNumber && hasSpecial;
};

module.exports = {
  validateEmail,
  validateLoginId,
  validateName,
  validatePhoneNumber,
  validatePassword,
};
