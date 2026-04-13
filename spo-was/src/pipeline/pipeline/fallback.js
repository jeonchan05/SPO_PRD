const shouldTriggerOcrFallback = (pageAnalysis, options = {}) => {
  const minConfidence = Number(options.minConfidence || 0.62);
  const minVisibleTextChars = Number(options.minVisibleTextChars || 26);

  const reasons = [];
  const confidence = Number(pageAnalysis?.confidence || 0);
  if (confidence < minConfidence) {
    reasons.push(`low_confidence:${confidence.toFixed(2)}`);
  }

  const role = String(pageAnalysis?.slide_role || "other");
  const title = String(pageAnalysis?.title || "").trim();
  const mainPointText = Array.isArray(pageAnalysis?.main_points) ? pageAnalysis.main_points.join(" ") : "";
  const keywordText = Array.isArray(pageAnalysis?.keywords) ? pageAnalysis.keywords.join(" ") : "";
  const factsText = Array.isArray(pageAnalysis?.facts) ? pageAnalysis.facts.join(" ") : "";
  const visibleText = `${title} ${mainPointText} ${keywordText} ${factsText}`.trim();

  if (!title && role === "other") {
    reasons.push("role_unresolved_and_no_title");
  }

  if (visibleText.length < minVisibleTextChars) {
    reasons.push(`text_too_short:${visibleText.length}`);
  }

  const signals = pageAnalysis?.signals || {};
  if (signals.small_text_likelihood != null && Number(signals.small_text_likelihood) >= 0.7) {
    reasons.push("small_text_likelihood_high");
  }
  if (signals.scan_quality != null && String(signals.scan_quality).toLowerCase() === "poor") {
    reasons.push("scan_quality_poor");
  }

  return {
    shouldUseOcr: reasons.length > 0,
    reasons,
  };
};

module.exports = {
  shouldTriggerOcrFallback,
};
