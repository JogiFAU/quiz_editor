import { normSpace } from "../utils.js";
import { state } from "../state.js";

function detectTopicKey(q) {
  const keys = Object.keys(q || {});
  return keys.find((k) => /topic|thema/i.test(k)) || null;
}

function detectSuperTopicKey(q) {
  const keys = Object.keys(q || {});
  return keys.find((k) => /super.?topic|ober.?thema|haupt.?thema/i.test(k)) || null;
}

function detectSubTopicKey(q) {
  const keys = Object.keys(q || {});
  return keys.find((k) => /sub.?topic|unter.?thema/i.test(k)) || null;
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

function normalizeQuestion(q, fileIndex) {
  const id = String(q.id || "").trim();
  if (!id) return null;

  const topicKey = detectTopicKey(q);
  const superTopicKey = detectSuperTopicKey(q);
  const subTopicKey = detectSubTopicKey(q);
  const maintenanceKey = detectMaintenanceKey(q);
  const topic = topicKey ? normSpace(q[topicKey] || "") : "";
  const legacySplit = parseLegacyTopic(topic);

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
    needsReview: !!(maintenanceKey ? q[maintenanceKey] : false),
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
