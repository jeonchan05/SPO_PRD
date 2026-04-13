const fs = require("fs/promises");
const path = require("path");

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, value) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const lines = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row));
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const listFiles = async (dirPath, pattern = /.*/) => {
  const entries = await fs.readdir(dirPath).catch(() => []);
  return entries
    .filter((name) => pattern.test(name))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => a.localeCompare(b));
};

module.exports = {
  ensureDir,
  writeJson,
  readJson,
  writeJsonl,
  readJsonl,
  listFiles,
};
