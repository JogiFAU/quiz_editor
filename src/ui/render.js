import { state } from "../state.js";
import { $, letter, toast } from "../utils.js";
import { isMultiCorrect } from "../quiz/evaluate.js";
import { submitAnswer, unsubmitAnswer } from "../quiz/session.js";
import { getImageUrl } from "../data/zipImages.js";
import { qMetaHtml, buildExplainPrompt } from "./components.js";
import { questionIdIndex } from "../quiz/filters.js";
import { getLatestAnsweredResultsByQuestion } from "../data/storage.js";

const MAX_RENDER_NO_PAGING = 1000;
let notebookLmWindow = null;
const NOTEBOOK_TAB_NAME = "examgenNotebookLmTab";

function getQuizMode() {
  return $("quizMode")?.value || state.quizConfig?.quizMode || "practice";
}

function computeQuizProgress() {
  const total = state.questionOrder.length;
  const submitted = state.submitted.size;
  let correct = 0;
  for (const qid of state.submitted) if (state.results.get(qid) === true) correct++;
  const pct = submitted ? Math.round((correct / submitted) * 100) : 0;
  return { total, submitted, correct, pct };
}

function solutionsVisible() {
  if (getQuizMode() === "practice") return true;
  return state.view === "review";
}

export function renderHeaderProgress() {
  const subtitle = $("headerSubtitle");
  const progText = $("headerProgressText");
  const pctEl = $("headerCorrectPct");
  const bar = $("headerProgressBar");

  if (!state.activeDataset) {
    subtitle.textContent = "Datensatz laden und Abfrage konfigurieren";
    progText.textContent = "—";
    pctEl.textContent = "—";
    bar.style.width = "0%";
    bar.style.background = "";
    return;
  }

  const modeLabel = state.view === "quiz" ? "Abfragemodus" :
                    state.view === "review" ? "Auswertung" :
                    state.view === "search" ? "Suchmodus" : "Konfiguration";

  subtitle.textContent = `${state.activeDataset.label || state.activeDataset.id} · ${modeLabel}`;

  if (state.view !== "quiz" && state.view !== "review") {
    progText.textContent = "—";
    pctEl.textContent = "—";
    bar.style.width = "0%";
    bar.style.background = "";
    return;
  }

  const { total, submitted, correct, pct } = computeQuizProgress();
  progText.textContent = `${submitted}/${total}`;
  bar.style.width = total ? `${(submitted / total) * 100}%` : "0%";

  const canShowQuality = !(getQuizMode() === "exam" && !solutionsVisible());
  if (!canShowQuality || submitted === 0) {
    bar.style.background = "";
  } else {
    const corrPct = Math.round((correct / submitted) * 100);
    bar.style.background = `linear-gradient(90deg, rgba(52,211,153,.95) 0%, rgba(22,163,74,.95) ${corrPct}%, rgba(252,165,165,.95) ${corrPct}%, rgba(198,40,40,.95) 100%)`;
  }

  if (!canShowQuality) pctEl.textContent = "—";
  else pctEl.textContent = `${pct}%`;
}

function setSidebarVisibility() {
  const isSession = (state.view === "quiz" || state.view === "review");
  $("sidebarConfig").hidden = isSession;
  $("sidebarSession").hidden = !isSession;

  // In search view, force-highlight the search tab (user is logically in search workflow)
  const tab = (state.view === "search") ? "search" : state.configTab;

  $("tabQuiz").classList.toggle("active", tab === "quiz");
  $("tabSearch").classList.toggle("active", tab === "search");

  const showQuizConfig = (state.view === "config" && tab === "quiz");
  const showSearchConfig = ((state.view === "config" && tab === "search") || state.view === "search");

  $("configQuiz").hidden = !showQuizConfig;
  $("configSearch").hidden = !showSearchConfig;

  const configDisplay = $("displayControlsConfig");
  if (configDisplay && state.view === "config") configDisplay.hidden = true;

  // Search view controls
  const startSearchBtn = $("startSearchBtn");
  if (startSearchBtn) startSearchBtn.textContent = "Suche aktualisieren";

  // Session buttons
  const endBtn = $("endQuizBtn");
  if (endBtn) {
    endBtn.hidden = !(state.view === "quiz" || state.view === "review");
    endBtn.disabled = (state.view !== "quiz");
  }

  const ab = $("abortQuizBtn");
  if (ab) {
    ab.hidden = !(state.view === "quiz" || state.view === "review");
    ab.textContent = (state.view === "review") ? "Neue Abfrage" : "Abfrage abbrechen";
  }

  const hint = $("sessionHint");
  if (hint) {
    hint.textContent = (state.view === "review")
      ? "Auswertung abgeschlossen. Starte eine neue Abfrage oder gehe zurück zur Konfiguration."
      : "Abfrage läuft.";
  }
}

function setPagingSectionsVisibility(isPaging) {
  const sess = $("displayControlsSession");
  if (sess) sess.hidden = !isPaging;
  // Config controls are optional; we hide them when not needed (events.js toggles in config/search)
}

function highlightText(el, text, query) {
  const raw = String(text || "");
  const q = String(query || "").trim();
  el.textContent = "";
  if (!q) {
    el.textContent = raw;
    return;
  }

  const lower = raw.toLowerCase();
  const needle = q.toLowerCase();
  let start = 0;

  while (start < raw.length) {
    const idx = lower.indexOf(needle, start);
    if (idx < 0) {
      el.appendChild(document.createTextNode(raw.slice(start)));
      break;
    }
    if (idx > start) el.appendChild(document.createTextNode(raw.slice(start, idx)));

    const mark = document.createElement("mark");
    mark.className = "hl";
    mark.textContent = raw.slice(idx, idx + needle.length);
    el.appendChild(mark);
    start = idx + needle.length;
  }
}

function getQuestionsByOrder(order) {
  const idx = questionIdIndex(state.questionsAll);
  const out = [];
  for (const qid of order) {
    const q = idx.get(qid);
    if (q) out.push(q);
  }
  return out;
}

function getExamStatsMap() {
  const datasetId = state.activeDataset?.id;
  if (!datasetId) return new Map();

  const latestAnswered = getLatestAnsweredResultsByQuestion(datasetId);
  if (!latestAnswered.size) return new Map();

  const byExam = new Map();
  for (const q of state.questionsAll) {
    const exam = q?.examName || null;
    if (!exam) continue;
    if (!byExam.has(exam)) byExam.set(exam, []);
    byExam.get(exam).push(q.id);
  }

  const out = new Map();
  for (const [exam, qids] of byExam.entries()) {
    const total = qids.length;
    let answered = 0, correct = 0;
    for (const qid of qids) {
      if (!latestAnswered.has(qid)) continue;
      answered++;
      if (latestAnswered.get(qid) === true) correct++;
    }

    if (!answered) continue;

    const wrong = answered - correct;
    const unanswered = total - answered;
    const complete = unanswered === 0 && total > 0;

    const pct = answered ? Math.round((correct / answered) * 100) : 0;
    out.set(exam, { total, answered, correct, wrong, unanswered, pct, complete });
  }

  return out;
}

export function updateExamLists() {
  const exams = Array.from(new Set(state.questionsAll.map(q => q.examName).filter(Boolean))).sort();
  const stats = getExamStatsMap();
  renderExamList("examListQuiz", exams, stats);
  renderExamList("examListSearch", exams, stats);
}

function renderExamList(containerId, exams, statsMap) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = "";

  for (const exam of exams) {
    const item = document.createElement("div");
    item.className = "examitem";

    const left = document.createElement("div");
    left.className = "examleft";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.exam = exam;
    cb.addEventListener("click", (e) => e.stopPropagation());

    const name = document.createElement("div");
    name.className = "examname";
    name.textContent = exam;

    left.appendChild(cb);
    left.appendChild(name);
    item.appendChild(left);

    const stats = statsMap.get(exam);
    const right = document.createElement("div");
    right.className = "examstats";

    if (stats) {
      const bar = document.createElement("div");
      bar.className = "exambar";

      const segOk = document.createElement("div");
      segOk.className = "examseg ok";
      segOk.style.width = `${(stats.correct / stats.total) * 100}%`;

      const segBad = document.createElement("div");
      segBad.className = "examseg bad";
      segBad.style.width = `${(stats.wrong / stats.total) * 100}%`;

      const segNeu = document.createElement("div");
      segNeu.className = "examseg neu";
      segNeu.style.width = `${(stats.unanswered / stats.total) * 100}%`;

      bar.appendChild(segOk);
      bar.appendChild(segBad);
      bar.appendChild(segNeu);

      const pct = document.createElement("div");
      pct.className = "exampct";
      pct.textContent = `${stats.pct}%`;

      right.appendChild(bar);
      right.appendChild(pct);
    } else {
      const pct = document.createElement("div");
      pct.className = "exampct placeholder";
      pct.textContent = "Auswertung nach Abschluss";
      right.appendChild(pct);
    }

    item.appendChild(right);

    const syncSelected = () => item.classList.toggle("selected", cb.checked);
    syncSelected();
    cb.addEventListener("change", syncSelected);

    item.addEventListener("click", () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });

    el.appendChild(item);
  }
}

export function renderPager(totalCount, suffix="") {
  const pageSizeEl = $("pageSize" + suffix);
  const pageNumberEl = $("pageNumber" + suffix);
  const pageInfoEl = $("pageInfo" + suffix);

  const pageSize = Math.max(10, Math.min(300, Number(pageSizeEl.value || 50)));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  let page = Number(pageNumberEl.value || 1);
  page = Math.max(1, Math.min(totalPages, page));

  pageNumberEl.value = String(page);
  pageInfoEl.textContent = `Seite ${page}/${totalPages} · ${totalCount} Fragen`;
  return { page, pageSize, totalPages };
}

async function notebookExplain(q) {
  const nb = state.activeDataset?.notebookUrl;
  const prompt = buildExplainPrompt(q, state.answers.get(q.id) || []);

  try {
    await navigator.clipboard.writeText(prompt);
    toast("Fragen-Prompt wurde in die Zwischenablage kopiert.");
  } catch {
    toast("Prompt konnte nicht automatisch kopiert werden (Browser-Rechte).");
  }

  if (!nb) {
    toast("Kein Notebook-Link im Datensatz hinterlegt.");
    return;
  }

  if (notebookLmWindow && !notebookLmWindow.closed) {
    try {
      if (notebookLmWindow.location?.href !== nb) notebookLmWindow.location.href = nb;
      notebookLmWindow.focus();
      return;
    } catch {
      notebookLmWindow = null;
    }
  }

  notebookLmWindow = window.open(nb, NOTEBOOK_TAB_NAME);
  notebookLmWindow?.focus();
}

function renderToc() {
  const list = $("tocList");
  const summary = $("tocSummary");
  list.innerHTML = "";

  const { total, submitted } = computeQuizProgress();
  summary.textContent = total ? `Beantwortet: ${submitted}/${total}` : "—";

  const showSol = solutionsVisible();
  const quizMode = getQuizMode();

  const qs = getQuestionsByOrder(state.questionOrder);
  qs.forEach((q, i) => {
    const qid = q.id;
    const item = document.createElement("div");
    item.className = "tocitem";
    item.dataset.qid = qid;

    const dot = document.createElement("div");
    dot.className = "tocdot";

    if (!state.submitted.has(qid)) dot.classList.add("neu");
    else {
      if (quizMode === "exam" && !showSol) dot.classList.add("answered");
      else dot.classList.add(state.results.get(qid) ? "ok" : "bad");
    }

    const title = document.createElement("div");
    title.className = "toctitle";
    title.textContent = (q.text || "").slice(0, 60) + ((q.text || "").length > 60 ? "…" : "");

    const num = document.createElement("div");
    num.className = "tocnum";
    num.textContent = `#${i+1}`;

    item.appendChild(dot);
    item.appendChild(title);
    item.appendChild(num);

    item.addEventListener("click", async () => {
      await jumpToQuestion(qid);
    });

    list.appendChild(item);
  });
}

async function jumpToQuestion(qid) {
  const idx = state.questionOrder.indexOf(qid);
  if (idx < 0) return;

  const usePaging = state.questionOrder.length > MAX_RENDER_NO_PAGING;

  if (usePaging) {
    const pageSize = Math.max(10, Math.min(300, Number($("pageSize").value || 50)));
    const page = Math.floor(idx / pageSize) + 1;
    $("pageNumber").value = String(page);
    $("pageNumber2").value = String(page);
    await renderAll();
  }

  const el = document.getElementById("q_" + qid);
  if (el) {
    const header = document.querySelector("header.top");
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const rect = el.getBoundingClientRect();
    const y = window.scrollY + rect.top - headerH - 10;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    el.animate([{ transform: "scale(1.005)" }, { transform: "scale(1.0)" }], { duration: 220, easing: "ease-out" });
  }
}

export async function renderMain() {
  renderHeaderProgress();
  setSidebarVisibility();

  const mainInfo = $("mainInfo");
  const list = $("questionList");
  list.innerHTML = "";

  if (!state.activeDataset) {
    mainInfo.innerHTML = `
      <div class="hero">
        <div class="hero__title">Willkommen im Exam Generator</div>
        <div class="hero__lead">
          Wähle links zuerst einen Datensatz aus und lade ihn. Danach kannst du direkt im Abfragemodus starten oder im Suchmodus nach Inhalten suchen.
        </div>
        <div class="hero__stats">
          <div class="pill">🔎 Suche nach Stichwörtern</div>
          <div class="pill">🗂️ Filter nach Altklausuren</div>
          <div class="pill">🏷️ Filter nach Schlagwörtern</div>
          <div class="pill">🧪 Themen-Filter (in construction)</div>
        </div>
      </div>
    `;
    return;
  }

  if (state.view === "config") {
    const qc = state.preview?.quizCount ?? 0;
    const sc = state.preview?.searchCount ?? 0;
    const isSearchTab = state.configTab === "search";

    mainInfo.innerHTML = `
      <div class="hero">
        <div class="hero__title">${isSearchTab ? "Suchmodus konfigurieren" : "Abfragemodus konfigurieren"}</div>
        <div class="hero__lead">
          ${isSearchTab
            ? "Wähle Klausuren und Suchfilter im linken Bereich. Die Anzahl der im Suchmodus sichtbaren Fragen wird hier live aktualisiert."
            : "Wähle Klausuren und Filter im linken Bereich. Die Anzahl der aktuell ausgewählten Fragen wird hier live aktualisiert."}
        </div>
        <div class="hero__stats">
          <div class="pill">${isSearchTab ? `Treffer im Suchmodus: ${sc}` : `Aktuell gewählte Fragen: ${qc}`}</div>
        </div>
      </div>
    `;
    return;
  }

  if (state.view === "search") {
    mainInfo.textContent = `Suchergebnisse: ${state.searchOrder.length} Treffer`;
    await renderQuestionList(getQuestionsByOrder(state.searchOrder), {
      allowSubmit: false,
      showSolutions: $("searchShowSolutions").checked
    });
    return;
  }

  // quiz or review
  renderToc();

  const { total, submitted, correct, pct } = computeQuizProgress();
  if (state.view === "quiz" && getQuizMode() === "exam") {
    mainInfo.textContent = `Abfrage läuft: ${submitted}/${total} beantwortet · Prüfungsmodus`;
  } else {
    const base = state.view === "review" ? "Auswertung" : "Abfrage läuft";
    mainInfo.textContent = `${base}: ${submitted}/${total} beantwortet · ${pct}% richtig (${correct}/${submitted || 0})`;
  }

  if (state.view === "review") {
    const summary = document.createElement("div");
    summary.className = "summary";
    const wrong = Math.max(0, submitted - correct);
    const unanswered = Math.max(0, total - submitted);
    const pctAnswered = submitted ? Math.round((correct / submitted) * 100) : 0;
    const pctAll = total ? Math.round((correct / total) * 100) : 0;
    const pctCards = unanswered === 0
      ? `<div class="sumcard"><div class="sumcard__k">% Richtig</div><div class="sumcard__v">${pctAll}%</div></div>`
      : `
        <div class="sumcard"><div class="sumcard__k">% (nur beantwortet)</div><div class="sumcard__v">${pctAnswered}%</div></div>
        <div class="sumcard"><div class="sumcard__k">% (alle)</div><div class="sumcard__v">${pctAll}%</div></div>
      `;
    summary.innerHTML = `
      <div class="hero__title" style="font-size:18px;">Auswertung</div>
      <div class="hero__lead" style="margin-bottom:0;">
        Platzhalter: Hier können später Klausur-Statistiken, Themenverteilung und Lernempfehlungen angezeigt werden.
      </div>
      <div class="summary__grid">
        <div class="sumcard"><div class="sumcard__k">Richtig</div><div class="sumcard__v">${correct}</div></div>
        <div class="sumcard"><div class="sumcard__k">Falsch</div><div class="sumcard__v">${wrong}</div></div>
        <div class="sumcard"><div class="sumcard__k">Offen</div><div class="sumcard__v">${unanswered}</div></div>
        ${pctCards}
      </div>
    `;
    list.appendChild(summary);
  }

  const qs = getQuestionsByOrder(state.questionOrder);
  const allowSubmit = (state.view === "quiz");
  await renderQuestionList(qs, { allowSubmit, showSolutions: solutionsVisible() });
}

async function renderQuestionList(qs, { allowSubmit, showSolutions }) {
  const isSession = (state.view === "quiz" || state.view === "review");
  const usePaging = qs.length > MAX_RENDER_NO_PAGING;

  if (isSession) setPagingSectionsVisibility(usePaging);

  let slice = qs;
  let offset = 0;

  if (usePaging) {
    const { page, pageSize } = renderPager(qs.length, "");

    // mirror session pager if visible
    if (isSession) {
      $("pageSize2").value = $("pageSize").value;
      $("pageNumber2").value = $("pageNumber").value;
      $("pageInfo2").textContent = $("pageInfo").textContent;
    }

    slice = qs.slice((page - 1) * pageSize, page * pageSize);
    offset = (page - 1) * pageSize;
  } else {
    // no paging: show all, hide pager sections (session) and keep page fields stable
    const pi = $("pageInfo");
    if (pi) pi.textContent = `${qs.length} Fragen`;
    const pi2 = $("pageInfo2");
    if (pi2) pi2.textContent = `${qs.length} Fragen`;
    $("pageNumber").value = "1";
    $("pageNumber2").value = "1";
  }

  const list = $("questionList");

  for (let idx = 0; idx < slice.length; idx++) {
    const q = slice[idx];
    const qid = q.id;
    const submitted = state.submitted.has(qid);
    const res = state.results.get(qid);

    const card = document.createElement("div");
    card.className = "qcard";
    card.id = "q_" + qid;

    if (submitted) {
      if (showSolutions && (allowSubmit || state.view === "review")) card.classList.add(res ? "ok" : "bad");
      else card.classList.add("neu");
    }

    const meta = document.createElement("div");
    meta.className = "qmeta";
    meta.innerHTML = qMetaHtml(q, offset + idx + 1);

    const text = document.createElement("div");
    text.className = "qtext";
    if (state.view === "search") highlightText(text, q.text, state.searchConfig?.query || "");
    else text.textContent = q.text;

    card.appendChild(meta);
    card.appendChild(text);

    // Images
    if (q.imageFiles && q.imageFiles.length) {
      if (!state.zip) {
        const note = document.createElement("div");
        note.className = "small";
        note.textContent = "Bilder vorhanden – ZIP nicht geladen (oder JSZip nicht verfügbar).";
        card.appendChild(note);
      } else {
        const imgRow = document.createElement("div");
        imgRow.className = "imgrow";
        for (const fb of q.imageFiles) {
          const url = await getImageUrl(fb);
          if (!url) continue;
          const img = document.createElement("img");
          img.loading = "lazy";
          img.src = url;
          img.alt = fb;
          imgRow.appendChild(img);
        }
        if (imgRow.children.length) card.appendChild(imgRow);
      }
    }

    const opts = document.createElement("div");
    opts.className = "opts";

    const selectedOriginal = state.answers.get(qid) || [];
    const correctSet = new Set(q.correctIndices || []);
    const multi = isMultiCorrect(q);
    const displayOrder = state.answerOrder.get(qid) || [...Array((q.answers || []).length).keys()];

    displayOrder.forEach((origIdx, displayIdx) => {
      const a = (q.answers || [])[origIdx];
      const wrap = document.createElement("label");
      wrap.className = "opt";

      const inp = document.createElement("input");
      inp.type = multi ? "checkbox" : "radio";
      inp.name = `q_${qid}`;
      inp.value = String(origIdx);
      inp.checked = selectedOriginal.includes(origIdx);
      inp.disabled = allowSubmit ? submitted : true;

      inp.addEventListener("change", () => {
        const cur = new Set(state.answers.get(qid) || []);
        if (multi) {
          if (inp.checked) cur.add(origIdx);
          else cur.delete(origIdx);
          state.answers.set(qid, Array.from(cur).sort((x,y)=>x-y));
        } else {
          state.answers.set(qid, [origIdx]);
        }
      });

      const t = document.createElement("div");
      t.className = "t";
      const answerText = `${letter(displayIdx)}) ${a?.text || ""}`;
      if (state.view === "search" && state.searchConfig?.inAnswers) {
        highlightText(t, answerText, state.searchConfig?.query || "");
      } else {
        t.textContent = answerText;
      }

      if (showSolutions) {
        const isSel = selectedOriginal.includes(origIdx);
        const isCorr = correctSet.has(origIdx);
        if (!allowSubmit) {
          if (isCorr) wrap.classList.add("ok");
          if (state.view === "review" && isSel && !isCorr) wrap.classList.add("bad");
        } else if (submitted) {
          if (isCorr) wrap.classList.add("ok");
          else if (isSel && !isCorr) wrap.classList.add("bad");
        }
      }

      wrap.appendChild(inp);
      wrap.appendChild(t);
      opts.appendChild(wrap);
    });

    card.appendChild(opts);

    if (allowSubmit) {
      const actions = document.createElement("div");
      actions.className = "actions";

      const submitBtn = document.createElement("button");
      submitBtn.className = "btn primary";
      submitBtn.textContent = "Antwort abgeben";
      submitBtn.disabled = submitted;
      submitBtn.addEventListener("click", async () => {
        const nextQid = (() => {
          const idx = state.questionOrder.indexOf(qid);
          if (idx < 0 || idx >= state.questionOrder.length - 1) return null;
          return state.questionOrder[idx + 1];
        })();

        submitAnswer(q);
        const shouldAutoAdvance = (
          state.view === "quiz" &&
          getQuizMode() === "practice" &&
          state.results.get(qid) === true &&
          !!nextQid
        );

        await renderAll();
        if (shouldAutoAdvance) await jumpToQuestion(nextQid);
      });

      const editBtn = document.createElement("button");
      editBtn.className = "btn";
      editBtn.textContent = "Antwort ändern";
      editBtn.disabled = !submitted;
      editBtn.addEventListener("click", async () => {
        unsubmitAnswer(qid);
        await renderAll();
      });

      actions.appendChild(submitBtn);
      actions.appendChild(editBtn);
      card.appendChild(actions);
    }

    // NotebookLM Explain
    if (!allowSubmit || submitted) {
      const explainWrap = document.createElement("div");
      explainWrap.className = "notebookActions";

      const explainBtn = document.createElement("button");
      explainBtn.className = "btn";
      explainBtn.textContent = "In NotebookLM erklären";
      explainBtn.addEventListener("click", async () => { await notebookExplain(q); });

      const hint = document.createElement("div");
      hint.className = "tooltipHint";

      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "tooltipHint__btn";
      hintBtn.textContent = "?";
      hintBtn.setAttribute("aria-label", "Hinweis zu NotebookLM");

      const hintText = document.createElement("div");
      hintText.className = "tooltipHint__text";
      hintText.textContent = "Öffnet Notebook und kopiert einen Prompt zur Frage in die Zwischenablage, den du direkt im Chat einfügen kannst.";

      hint.appendChild(hintBtn);
      hint.appendChild(hintText);

      explainWrap.appendChild(explainBtn);
      explainWrap.appendChild(hint);
      card.appendChild(explainWrap);
    }

    if (q.explanation && allowSubmit && submitted && showSolutions) {
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = "Notizen/Erklärung (Datensatz)";
      const p = document.createElement("div");
      p.className = "small";
      p.style.marginTop = "8px";
      p.textContent = q.explanation;
      det.appendChild(sum);
      det.appendChild(p);
      card.appendChild(det);
    }

    list.appendChild(card);
  }
}

export async function renderAll() {
  await renderMain();
}
