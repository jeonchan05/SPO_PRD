const fs = require("fs/promises");
const path = require("path");
const { ensureDir, listFiles } = require("../utils/fs");
const { runCommand, runCommandSafe } = require("../utils/shell");

const parsePdfPageCount = (stdout) => {
  const match = String(stdout || "").match(/Pages:\s*(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 0;
};

const getPdfPageCount = async (pdfPath) => {
  const { stdout } = await runCommand("pdfinfo", [pdfPath], { timeoutMs: 30000 });
  const count = parsePdfPageCount(stdout);
  if (!count) {
    throw new Error("pdfinfo 결과에서 페이지 수를 파악하지 못했습니다.");
  }
  return count;
};

const renderSinglePage = async ({ pdfPath, pageNumber, outDir, dpi = 180, overwrite = false }) => {
  const fileBase = `page-${String(pageNumber).padStart(4, "0")}`;
  const outputBasePath = path.join(outDir, fileBase);
  const outputImagePath = `${outputBasePath}.png`;

  if (!overwrite) {
    const exists = await fs
      .stat(outputImagePath)
      .then((st) => st.isFile())
      .catch(() => false);
    if (exists) return outputImagePath;
  }

  await runCommand("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-png", "-r", String(dpi), pdfPath, outputBasePath], {
    timeoutMs: 120000,
  });

  const generated = await fs
    .stat(outputImagePath)
    .then((st) => st.isFile())
    .catch(() => false);

  if (!generated) {
    throw new Error(`페이지 이미지 생성 실패: ${outputImagePath}`);
  }

  return outputImagePath;
};

const convertPdfToImages = async ({ pdfPath, outDir, dpi = 180, overwrite = false, logger, onPageDone }) => {
  await ensureDir(outDir);
  const pageCount = await getPdfPageCount(pdfPath);
  logger?.info?.(`[pdf] total pages=${pageCount}, dpi=${dpi}`);

  const imagePaths = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const imagePath = await renderSinglePage({
      pdfPath,
      pageNumber,
      outDir,
      dpi,
      overwrite,
    });
    imagePaths.push(imagePath);
    if (typeof onPageDone === "function") {
      onPageDone({ pageNumber, pageCount, imagePath });
    }
  }

  return {
    pageCount,
    imagePaths,
  };
};

const collectPageImages = async (pagesDir) => {
  return listFiles(pagesDir, /^page-\d+\.png$/i);
};

const checkPdfTooling = async () => {
  const pdfInfo = await runCommandSafe("pdfinfo", ["-v"], { timeoutMs: 5000 });
  const pdftoppm = await runCommandSafe("pdftoppm", ["-v"], { timeoutMs: 5000 });
  return {
    pdfinfo: !pdfInfo.error,
    pdftoppm: !pdftoppm.error,
  };
};

module.exports = {
  parsePdfPageCount,
  getPdfPageCount,
  convertPdfToImages,
  collectPageImages,
  checkPdfTooling,
};
