const fs = require("fs/promises");
const path = require("path");

const PROMPT_DIR = __dirname;

const loadPrompt = async (fileName) => {
  const filePath = path.join(PROMPT_DIR, fileName);
  return fs.readFile(filePath, "utf8");
};

const loadAllPrompts = async () => {
  const [pageAnalysis, documentSummary, discussionTopics] = await Promise.all([
    loadPrompt("page_analysis.txt"),
    loadPrompt("document_summary.txt"),
    loadPrompt("discussion_topics.txt"),
  ]);

  return {
    pageAnalysis,
    documentSummary,
    discussionTopics,
  };
};

module.exports = {
  loadPrompt,
  loadAllPrompts,
};
