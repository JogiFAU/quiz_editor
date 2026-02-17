import { normSpace } from "../utils.js";

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function pickFirstNonEmptyString(source, paths = []) {
  for (const path of paths) {
    const value = normSpace(String(getByPath(source, path) || ""));
    if (value) return value;
  }
  return null;
}

export const AI_DISPLAY_RULES = {
  solutionHintPaths: [
    "AnswerReasonDetailed",
    "answerReasonDetailed",
    "aiAnswerReasonDetailed",
    "AnswerReasonShort",
    "answerReasonShort",
    "aiAnswerReasonShort",
    // Falls vorhanden, hat der explizite finalPass Vorrang vor älteren Schritten.
    "aiAudit.answerPlausibility.finalPass.reasonDetailed",
    "aiAudit.answerPlausibility.finalPass.reasonShort",
    "aiAudit.answerPlausibility.verification.reasonDetailed",
    "aiAudit.answerPlausibility.verification.reasonShort",
    "aiAudit.answerPlausibility.passA.reasonDetailed",
    "aiAudit.answerPlausibility.passA.reasonShort",
    "aiAudit.answerPlausibility.passB.reasonDetailed",
    "aiAudit.answerPlausibility.passB.reasonShort"
  ],
  topicReasonPaths: [
    "aiTopicReason",
    "aiAudit.topicFinal.reasonShort",
    "aiAudit.topicInitial.reasonShort"
  ]
};

export function resolveAiDisplayText(question, type) {
  if (type === "solutionHint") {
    return pickFirstNonEmptyString(question, AI_DISPLAY_RULES.solutionHintPaths);
  }
  if (type === "topicReason") {
    return pickFirstNonEmptyString(question, AI_DISPLAY_RULES.topicReasonPaths);
  }
  return null;
}

export function evaluateAiChangedLabel({ changedInDataset, originalCorrectIndices, finalCorrectIndices }) {
  if (typeof changedInDataset === "boolean") return changedInDataset;
  if (!Array.isArray(originalCorrectIndices) || !Array.isArray(finalCorrectIndices)) return false;
  if (!originalCorrectIndices.length || !finalCorrectIndices.length) return false;
  if (originalCorrectIndices.length !== finalCorrectIndices.length) return true;
  for (let i = 0; i < originalCorrectIndices.length; i++) {
    if (originalCorrectIndices[i] !== finalCorrectIndices[i]) return true;
  }
  return false;
}

export const MAINTENANCE_TRAFFIC_RULES = {
  levels: {
    green: { label: "gut", color: "green" },
    yellow: { label: "Wartung empfohlen", color: "yellow/orange" },
    red: { label: "kritisch", color: "red" }
  },
  thresholds: {
    hardSeverityMin: 3,
    softSeverityMin: 2,
    lowConfidenceSoftMax: 0.6,
    lowConfidenceHardMax: 0.45,
    minAnswerOptions: 3,
    softIssuesForRed: 2
  }
};

export function evaluateMaintenanceTrafficRules(facts) {
  const hardIssue = Boolean(facts.hardIssue);
  const softIssueCount = Number(facts.softIssueCount || 0);
  if (hardIssue || softIssueCount >= MAINTENANCE_TRAFFIC_RULES.thresholds.softIssuesForRed) {
    return { level: "red", ...MAINTENANCE_TRAFFIC_RULES.levels.red };
  }
  if (softIssueCount === 1) {
    return { level: "yellow", ...MAINTENANCE_TRAFFIC_RULES.levels.yellow };
  }
  return { level: "green", ...MAINTENANCE_TRAFFIC_RULES.levels.green };
}
