const normalizeString = (value) => String(value || "").trim();

const normalizeNullableString = (value) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeEmail = (value) => normalizeString(value).toLowerCase();
const normalizeLoginId = (value) => normalizeString(value).toLowerCase();
const normalizeName = (value) => normalizeString(value);

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toNumberOrDefault = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

module.exports = {
  normalizeString,
  normalizeNullableString,
  normalizeEmail,
  normalizeLoginId,
  normalizeName,
  toPositiveInt,
  toNumberOrDefault,
  parseDateTime,
};
