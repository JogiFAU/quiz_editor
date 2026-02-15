import { mulberry32, sampleK, shuffle } from "../utils.js";

export function filterByExams(qs, examNames) {
  if (!examNames || examNames.length === 0) return qs;
  const set = new Set(examNames);
  return qs.filter(q => q.examName && set.has(q.examName));
}

export function filterByImageMode(qs, mode) {
  if (!mode || mode === "all") return qs;
  if (mode === "with") return qs.filter(q => (q.imageFiles || []).length > 0);
  if (mode === "without") return qs.filter(q => (q.imageFiles || []).length === 0);
  return qs;
}

export function filterByTopics(qs, topicFilters = []) {
  if (!topicFilters || topicFilters.length === 0) return qs;
  const set = new Set(topicFilters);

  return qs.filter((q) => {
    const superTopic = String(q.superTopic || "").trim() || "(Ohne Überthema)";
    const subTopic = String(q.subTopic || "").trim();
    if (set.has(`super::${superTopic}`)) return true;
    if (subTopic && set.has(`sub::${superTopic}::${subTopic}`)) return true;
    return false;
  });
}

export function applyRandomAndShuffle(qs, { randomN = 0, shuffleQuestions = false } = {}) {
  const rng = mulberry32(Date.now());

  let out = qs.slice();
  if (randomN > 0 && randomN < out.length) {
    out = sampleK(out, randomN, rng);
  }
  if (shuffleQuestions) {
    out = shuffle(out, rng);
  }
  return out;
}

export function searchQuestions(qs, { query = "", inAnswers = false } = {}) {
  const terms = String(query || "")
    .split(";")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!terms.length) return qs;

  return qs.filter((item) => {
    const text = (item.text || "").toLowerCase();
    const answers = inAnswers
      ? (item.answers || []).map((a) => (a.text || "").toLowerCase())
      : [];

    return terms.every((term) => {
      if (text.includes(term)) return true;
      if (!inAnswers) return false;
      return answers.some((aText) => aText.includes(term));
    });
  });
}

export function questionIdIndex(qs) {
  const m = new Map();
  for (const q of qs) m.set(q.id, q);
  return m;
}
