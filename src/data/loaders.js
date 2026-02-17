import { normSpace } from "../utils.js";
import { state } from "../state.js";
import {
  MAINTENANCE_TRAFFIC_RULES,
  evaluateMaintenanceTrafficRules,
  resolveAiDisplayText,
  resolveMaintenanceDisplayText,
  pickFirstNonEmptyString,
} from "../rules/questionPresentationRules.js";

function pickFirstKey(keys, preferred = [], matcher = null) {
  for (const key of preferred) {
    if (keys.includes(key)) return key;
  }
  if (!matcher) return null;
  return keys.find((k) => matcher.test(k)) || null;
}

function detectTopicKey(q) {
  const keys = Object.keys(q || {});
  return pickFirstKey(
    keys,
    ["topic", "aiTopic"],
    /topic|thema/i,
  );
}

function detectSuperTopicKey(q) {
  const keys = Object.keys(q || {});
  return pickFirstKey(
    keys,
    ["aiSuperTopic", "superTopic", "oberThema", "hauptThema"],
    /super.?topic|ober.?thema|haupt.?thema/i,
  );
}

function detectSubTopicKey(q) {
  const keys = Object.keys(q || {});
  return pickFirstKey(
    keys,
    ["aiSubtopic", "subTopic", "unterThema"],
    /sub.?topic|unter.?thema/i,
  );
}

function detectMaintenanceKey(q) {
  const keys = Object.keys(q || {});
  return keys.find((k) => /wartung|fehlerhaft|defekt|maintenance|needs.?review|invalid/i.test(k)) || null;
}

function parseLegacyTopic(topic) {
  const normalized = normSpace(topic || "");
  if (!normalized) return { superTopic: "", subTopic: "" };

  const match = normalized.match(/^(.+?)\s*(?:>|\/|::|->)\s*(.+)$/);
  if (!match) return { superTopic: normalized, subTopic: "" };
  return { superTopic: normSpace(match[1]), subTopic: normSpace(match[2]) };
}


function toUnitNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function extractTopicConfidence(q) {
  return toUnitNumber(
    q?.aiAudit?.topicFinal?.confidence
      ?? q?.aiAudit?.topicInitial?.confidence
      ?? q?.aiTopicConfidence,
  );
}

function extractAnswerConfidenceAndFlags(q) {
  const passB = q?.aiAudit?.answerPlausibility?.passB || null;
  const passA = q?.aiAudit?.answerPlausibility?.passA || null;
  const activePass = passB || passA || null;

  const answerConfidence = toUnitNumber(activePass?.confidence);
  const recommendChange = !!(activePass?.recommendChange ?? passA?.recommendChange ?? q?.recommendChange);
  const maintenance = q?.aiAudit?.maintenance || null;
  const needsMaintenance = !!(
    maintenance?.needsMaintenance
    ?? q?.aiNeedsMaintenance
    ?? q?.needsMaintenance
    ?? q?.needsMaintanence
  );

  return { answerConfidence, recommendChange, needsMaintenance };
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMaintenanceTrafficFacts({ q, topicConfidence, answerConfidence, needsMaintenance }) {
  const severity = toNumberOrNull(q?.aiAudit?.maintenance?.severity ?? q?.aiMaintenanceSeverity);
  const reasonCount = Array.isArray(q?.aiAudit?.maintenance?.reasons)
    ? q.aiAudit.maintenance.reasons.length
    : (Array.isArray(q?.aiMaintenanceReasons) ? q.aiMaintenanceReasons.length : 0);
  const thresholds = MAINTENANCE_TRAFFIC_RULES.thresholds;

  const hardIssue = Boolean(
    needsMaintenance
    || (severity != null && severity >= thresholds.hardSeverityMin)
  );

  let softIssueCount = 0;
  if (severity != null && severity >= thresholds.softSeverityMin) softIssueCount += 1;
  if (reasonCount > 0) softIssueCount += 1;
  if (answerConfidence != null && answerConfidence <= thresholds.lowConfidenceSoftMax) softIssueCount += 1;
  if (topicConfidence != null && topicConfidence <= thresholds.lowConfidenceSoftMax) softIssueCount += 1;
  if (answerConfidence != null && answerConfidence <= thresholds.lowConfidenceHardMax) softIssueCount += 1;
  if ((q?.answers || []).length < thresholds.minAnswerOptions) softIssueCount += 1;

  return { hardIssue, softIssueCount };
}


function extractAiInfo(q) {
  const topicFinal = q?.aiAudit?.topicFinal || null;
  const topicInitial = q?.aiAudit?.topicInitial || null;
  const passB = q?.aiAudit?.answerPlausibility?.passB || null;
  const passA = q?.aiAudit?.answerPlausibility?.passA || null;
  const activePass = passB || passA || null;

  return {
    topicReason: normSpace(resolveAiDisplayText(q, "topicReason") || topicFinal?.reasonShort || topicInitial?.reasonShort || ""),
    topicSource: String(topicFinal?.source || ""),
    answerReason: normSpace(resolveAiDisplayText(q, "solutionHint") || activePass?.reasonShort || ""),
    answerSource: passB ? "passB" : (passA ? "passA" : ""),
  };
}

function extractManualOverrides(q) {
  const maintenanceOverride = pickFirstNonEmptyString(q, [
    "Maintanance_manualOverride",
    "annotations.Maintanance_manualOverride",
  ]) || "";
  const answerOverride = pickFirstNonEmptyString(q, [
    "ExplanationAnswer_manualOverride",
    "annotations.ExplanationAnswer_manualOverride",
  ]) || "";
  const topicOverride = pickFirstNonEmptyString(q, [
    "ExplanationTopic_manualOverride",
    "annotations.ExplanationTopic_manualOverride",
  ]) || "";

  return {
    maintenanceOverride,
    answerOverride,
    topicOverride,
  };
}

function normalizeQuestion(q, fileIndex) {
  const id = String(q.id || "").trim();
  if (!id) return null;

  const topicKey = detectTopicKey(q);
  const superTopicKey = detectSuperTopicKey(q);
  const subTopicKey = detectSubTopicKey(q);
  const maintenanceKey = detectMaintenanceKey(q);
  const topic = topicKey ? normSpace(q[topicKey] || "") : "";
  const legacySplit = parseLegacyTopic(topic);
  const topicConfidence = extractTopicConfidence(q);
  const { answerConfidence, recommendChange, needsMaintenance } = extractAnswerConfidenceAndFlags(q);
  const { topicReason, topicSource, answerReason, answerSource } = extractAiInfo(q);
  const { maintenanceOverride, answerOverride, topicOverride } = extractManualOverrides(q);
  const needsReview = !!(maintenanceKey ? q[maintenanceKey] : false);

  const maintenanceTraffic = evaluateMaintenanceTrafficRules(
    buildMaintenanceTrafficFacts({ q, topicConfidence, answerConfidence, needsMaintenance }),
  );

  return {
    id,
    sourceFileIndex: fileIndex,
    sourceRef: q,
    topicKey,
    superTopicKey,
    subTopicKey,
    maintenanceKey,
    examName: q.examName || "",
    examYear: q.examYear != null ? String(q.examYear) : "",
    topic,
    superTopic: normSpace((superTopicKey ? q[superTopicKey] : "") || legacySplit.superTopic),
    subTopic: normSpace((subTopicKey ? q[subTopicKey] : "") || legacySplit.subTopic),
    needsReview,
    topicConfidence,
    answerConfidence,
    recommendChange,
    needsMaintenance,
    topicReason,
    topicSource,
    answerReason,
    answerSource,
    finalMaintenanceAssessment: resolveMaintenanceDisplayText(q, needsReview || needsMaintenance),
    maintenanceTrafficLevel: maintenanceTraffic.level,
    maintenanceTrafficLabel: maintenanceTraffic.label,
    hasManualMaintenanceOverride: !!maintenanceOverride,
    hasManualAnswerOverride: !!answerOverride,
    hasManualTopicOverride: !!topicOverride,
    manualEdited: !!(q.manualEdited || q?.annotations?.manualEdited || (Array.isArray(q.tags) && q.tags.includes("manualEdited"))),
    manualTopicEdited: false,
    text: normSpace(q.questionText || q.text || ""),
    explanation: normSpace(q.explanationText || q.explanation || ""),
    answers: (q.answers || []).map((a, idx) => ({
      id: a.id || `ans_${id}_${idx}`,
      text: normSpace(a.text || ""),
      isCorrect: !!a.isCorrect,
    })),
    imageFiles: Array.isArray(q.imageFiles) ? q.imageFiles.slice() : [],
  };
}

function ensureAnnotations(raw) {
  if (!raw.annotations || typeof raw.annotations !== "object" || Array.isArray(raw.annotations)) {
    raw.annotations = {};
  }
  return raw.annotations;
}

function setManualAnnotation(raw, key, value) {
  const annotations = ensureAnnotations(raw);
  if (value) {
    annotations[key] = value;
    raw[key] = value;
  } else {
    delete annotations[key];
  }
}

export function syncQuestionToSource(question) {
  const raw = question.sourceRef;
  if (!raw) return;

  raw.examName = question.examName || null;
  raw.examYear = question.examYear === "" ? null : Number(question.examYear);

  raw.questionText = question.text || "";
  if (Object.prototype.hasOwnProperty.call(raw, "questionHtml")) {
    raw.questionHtml = question.text || "";
  }

  raw.explanationText = question.explanation || "";
  if (Object.prototype.hasOwnProperty.call(raw, "explanationHtml")) {
    raw.explanationHtml = question.explanation || "";
  }

  const topicKey = question.topicKey || "topic";
  const canonicalTopic = [question.superTopic, question.subTopic].filter(Boolean).join(" > ");
  raw[topicKey] = canonicalTopic || question.topic || "";

  const superTopicKey = question.superTopicKey || "superTopic";
  const subTopicKey = question.subTopicKey || "subTopic";
  raw[superTopicKey] = question.superTopic || "";
  raw[subTopicKey] = question.subTopic || "";

  const maintenanceKey = question.maintenanceKey || "needsReview";
  raw[maintenanceKey] = !!question.needsReview;

  const maintenanceOverride = normSpace(question.finalMaintenanceAssessment || "");
  const answerOverride = normSpace(question.answerReason || "");
  const topicOverride = normSpace(question.topicReason || "");

  if (question.hasManualMaintenanceOverride) {
    setManualAnnotation(raw, "Maintanance_manualOverride", maintenanceOverride || null);
  }
  if (question.hasManualAnswerOverride) {
    setManualAnnotation(raw, "ExplanationAnswer_manualOverride", answerOverride || null);
  }

  if (question.hasManualTopicOverride) {
    if (topicOverride) {
      setManualAnnotation(raw, "ExplanationTopic_manualOverride", topicOverride);
    } else if (question.manualTopicEdited) {
      setManualAnnotation(raw, "ExplanationTopic_manualOverride", "manualOverride");
    } else {
      setManualAnnotation(raw, "ExplanationTopic_manualOverride", null);
    }
  }

  raw.answers = (question.answers || []).map((a, idx) => ({
    ...(raw.answers?.[idx] || {}),
    id: a.id || raw.answers?.[idx]?.id || `ans_${question.id}_${idx}`,
    text: a.text || "",
    html: a.text || "",
    isCorrect: !!a.isCorrect,
  }));

  raw.imageFiles = Array.isArray(question.imageFiles)
    ? question.imageFiles.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const correctIndices = [];
  raw.answers.forEach((a, idx) => {
    if (a.isCorrect) correctIndices.push(idx);
  });
  raw.correctIndices = correctIndices;
  raw.correctAnswers = correctIndices.map((idx) => ({
    index: idx,
    text: raw.answers[idx]?.text || "",
    html: raw.answers[idx]?.html || "",
  }));

  if (question.manualEdited) {
    raw.manualEdited = true;
    const annotations = ensureAnnotations(raw);
    annotations.manualEdited = true;
    const tags = Array.isArray(raw.tags) ? raw.tags.slice() : [];
    if (!tags.includes("manualEdited")) tags.push("manualEdited");
    raw.tags = tags;
  }
}

export async function loadJsonUrls(urls) {
  const byId = new Map();
  state.datasetFiles = [];

  for (let fileIndex = 0; fileIndex < urls.length; fileIndex++) {
    const url = urls[fileIndex];
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`JSON HTTP ${res.status}: ${url}`);
    const payload = await res.json();
    state.datasetFiles.push({ url, payload });

    for (const q of payload.questions || []) {
      const nq = normalizeQuestion(q, fileIndex);
      if (!nq) continue;
      byId.set(nq.id, nq);
    }
  }

  state.questionsAll = Array.from(byId.values());
}


export async function loadJsonFiles(files) {
  const byId = new Map();
  state.datasetFiles = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const txt = await file.text();
    const payload = JSON.parse(txt);
    state.datasetFiles.push({ url: file.name, payload });

    for (const q of payload.questions || []) {
      const nq = normalizeQuestion(q, fileIndex);
      if (!nq) continue;
      byId.set(nq.id, nq);
    }
  }

  state.questionsAll = Array.from(byId.values());
}

export function buildDatasetExports() {
  return state.datasetFiles.map((entry) => ({
    url: entry.url,
    payload: entry.payload,
  }));
}
