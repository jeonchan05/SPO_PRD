const { runPageAnalysisStage } = require("./pipeline/page-analysis.stage");
const { runDocumentSummaryStage } = require("./pipeline/document-summary.stage");
const { runTopicsStage } = require("./pipeline/topics.stage");
const { runFullPipeline } = require("./pipeline/run-pipeline");

module.exports = {
  runPageAnalysisStage,
  runDocumentSummaryStage,
  runTopicsStage,
  runFullPipeline,
};
