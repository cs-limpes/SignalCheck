import { scanDocumentsForMatches } from "./matcher";
import type { ReportItem, ReviewReport, RuleMatch, TextDocument, SignalRule } from "./signal-types";

export const REPORT_SAFETY_NOTE =
  "This report identifies possible context-dependent signals for human review. It must not be used to label a person or account as extremist.";

export const REPORT_PRIVACY_NOTE =
  "Screenshots are processed locally in the browser for this MVP. No upload endpoint, database write, or third-party analysis API is used by this app.";

export function generateReviewReport(
  documents: TextDocument[],
  rules: SignalRule[],
  generatedAt = new Date().toISOString()
): ReviewReport {
  const matches = scanDocumentsForMatches(documents, rules).sort(sortMatches);
  const items = matches.map(toReportItem);

  return {
    title: "SignalCheck Human Review Report",
    generatedAt,
    safetyNote: REPORT_SAFETY_NOTE,
    privacyNote: REPORT_PRIVACY_NOTE,
    summary: summarize(items),
    itemCount: items.length,
    items
  };
}

export function reportToMarkdown(report: ReviewReport): string {
  const lines = [
    `# ${report.title}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Safety note: ${report.safetyNote}`,
    "",
    `Privacy note: ${report.privacyNote}`,
    "",
    "## Summary",
    "",
    report.summary,
    ""
  ];

  if (report.items.length === 0) {
    lines.push("## Evidence Items", "", "No rule matches were found in the reviewed OCR text or visual observations.", "");
    return lines.join("\n");
  }

  lines.push("## Evidence Items", "");

  report.items.forEach((item, index) => {
    lines.push(
      `### ${index + 1}. Possible signal: \`${item.flaggedItem}\``,
      "",
      `- Evidence type: ${formatEvidenceType(item.evidenceType)}`,
      `- Category: ${item.category}`,
      `- Where it appeared: ${item.whereAppeared}`,
      `- What it can mean: ${item.whatItCanMean}`,
      `- Why context matters: ${item.whyContextMatters}`,
      `- Confidence level: ${item.confidenceLevel}`,
      `- Human review note: ${item.humanReviewNote}`,
      "",
      `> ${item.evidenceSnippet}`,
      ""
    );
  });

  return lines.join("\n");
}

function toReportItem(match: RuleMatch): ReportItem {
  return {
    id: match.id,
    evidenceType: match.sourceType,
    flaggedItem: match.matchedText,
    category: match.rule.category,
    whereAppeared:
      match.sourceType === "visual_observation"
        ? `${match.fileName}, ${match.sourceLabel}`
        : `${match.fileName}, OCR line ${match.lineNumber}`,
    whatItCanMean: match.rule.meaning,
    whyContextMatters: match.rule.context_note,
    confidenceLevel: match.rule.risk,
    humanReviewNote: match.rule.review_guidance,
    evidenceSnippet: match.snippet,
    ruleId: match.rule.id,
    sourceId: match.sourceId
  };
}

function sortMatches(first: RuleMatch, second: RuleMatch): number {
  const fileCompare = first.fileName.localeCompare(second.fileName);

  if (fileCompare !== 0) {
    return fileCompare;
  }

  const sourceCompare = first.sourceType.localeCompare(second.sourceType);

  if (sourceCompare !== 0) {
    return sourceCompare;
  }

  return first.startIndex - second.startIndex;
}

function summarize(items: ReportItem[]): string {
  if (items.length === 0) {
    return "No rule matches were found in the extracted text or reviewer-entered visual observations. This does not prove the absence of extremist signaling; it only means the current editable rules did not match the available evidence.";
  }

  const highCount = items.filter((item) => item.confidenceLevel === "high").length;
  const mediumCount = items.filter((item) => item.confidenceLevel === "medium").length;
  const visualCount = items.filter((item) => item.evidenceType === "visual_observation").length;
  const visualSummary = visualCount ? ` ${visualCount} item(s) came from reviewer-entered visual observations.` : "";

  if (highCount >= 2) {
    return `Strong concern based on repeated possible signals: ${items.length} evidence item(s) matched the editable rules, including ${highCount} high-confidence item(s).${visualSummary} Human review is required before drawing any conclusion.`;
  }

  if (highCount === 1 || mediumCount > 0) {
    return `${items.length} possible signal(s) matched the editable rules.${visualSummary} At least one item deserves careful context review before any conclusion is considered.`;
  }

  return `${items.length} low-confidence possible signal(s) matched the editable rules.${visualSummary} Treat these as weak, context-dependent leads for review.`;
}

function formatEvidenceType(evidenceType: ReportItem["evidenceType"]): string {
  return evidenceType === "visual_observation" ? "visual observation" : "OCR text";
}
