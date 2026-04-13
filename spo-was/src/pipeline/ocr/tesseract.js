const { runCommandSafe } = require("../utils/shell");

const cleanText = (value) =>
  String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const runImageOcr = async ({ imagePath, language = "kor+eng", timeoutMs = 90000 }) => {
  const result = await runCommandSafe("tesseract", [imagePath, "stdout", "-l", language], {
    timeoutMs,
  });

  if (result.error) {
    return {
      ok: false,
      text: "",
      reason: "tesseract_failed",
      stderr: String(result.stderr || "").slice(0, 400),
    };
  }

  const text = cleanText(result.stdout || "");
  return {
    ok: Boolean(text),
    text,
    reason: text ? "ok" : "empty_text",
    stderr: String(result.stderr || "").slice(0, 400),
  };
};

const checkOcrTooling = async () => {
  const result = await runCommandSafe("tesseract", ["--version"], { timeoutMs: 5000 });
  return {
    tesseract: !result.error,
  };
};

module.exports = {
  cleanText,
  runImageOcr,
  checkOcrTooling,
};
