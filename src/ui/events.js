import { $, toast, confirmDialog } from "../utils.js";
import { state, resetQuizSession, resetSearch } from "../state.js";
import { loadJsonUrls } from "../data/loaders.js";
import { loadZipUrl } from "../data/zipImages.js";
import { getSelectedDataset } from "../data/manifest.js";
import { filterByExams, filterByImageMode, applyRandomAndShuffle, searchQuestions } from "../quiz/filters.js";
import { startQuizSession, startSearchView, finishQuizSession, abortQuizSession, exitToConfig } from "../quiz/session.js";
import { renderAll, updateExamLists } from "./render.js";
import { listSessions, deleteSession, exportBackupAllDatasets, importBackupAllDatasets, getLatestAnsweredResultsByQuestion, clearAllSessionData } from "../data/storage.js";


const THEME_STORAGE_KEY = "examgen:theme";

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);

  const btn = $("themeToggleBtn");
  if (btn) {
    const isLight = nextTheme === "light";
    btn.textContent = isLight ? "🌙" : "☀️";
    btn.title = isLight ? "Zu Darkmode wechseln" : "Zu Lightmode wechseln";
    btn.setAttribute("aria-label", btn.title);
  }
}

function initThemeToggle() {
  const btn = $("themeToggleBtn");
  const stored = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  applyTheme(stored);

  if (!btn) return;
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

function selectedExamsFromList(containerId) {
  const el = $(containerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll("input[type=checkbox][data-exam]:checked"))
    .map(x => x.dataset.exam)
    .filter(Boolean);
}

function buildQuizConfigFromUi() {
  const rawN = ($("randomN")?.value || "").trim();
  const n = rawN ? Number(rawN) : 0;

  return {
    exams: selectedExamsFromList("examListQuiz"),
    imageFilter: $("imageFilterQuiz").value,
    wrongOnly: !!$("wrongOnlyQuiz")?.checked,
    randomN: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    keyword: ($("keywordFilter")?.value || "").trim(),
    keywordInAnswers: !!$("keywordInAnswers")?.checked,
    shuffleQuestions: $("shuffleQuestions").checked,
    shuffleAnswers: $("shuffleAnswers").checked,
    quizMode: $("quizMode").value,
  };
}

function getWrongQuestionIdSet() {
  const datasetId = state.activeDataset?.id;
  if (!datasetId) return new Set();
  const latestAnswered = getLatestAnsweredResultsByQuestion(datasetId);
  const wrong = new Set();
  for (const [qid, isCorrect] of latestAnswered.entries()) {
    if (isCorrect === false) wrong.add(qid);
  }
  return wrong;
}

function refreshWrongOnlyControl() {
  const wrong = getWrongQuestionIdSet();
  const count = wrong.size;

  [["wrongOnlyQuiz", "wrongOnlyQuizLabel"], ["wrongOnlySearch", "wrongOnlySearchLabel"]].forEach(([cbId, labelId]) => {
    const cb = $(cbId);
    const label = $(labelId);
    if (!cb) return;

    cb.disabled = (count === 0);
    if (count === 0) cb.checked = false;

    if (label) {
      label.textContent = count > 0
        ? `Nur aktuell falsch beantwortete Fragen (${count})`
        : "Nur aktuell falsch beantwortete Fragen (keine vorhanden)";
    }
  });

  return count;
}

function buildSearchConfigFromUi() {
  return {
    exams: selectedExamsFromList("examListSearch"),
    imageFilter: $("imageFilterSearch").value,
    query: $("searchText").value,
    inAnswers: $("searchInAnswers").checked,
    wrongOnly: !!$("wrongOnlySearch")?.checked,
    showSolutions: $("searchShowSolutions").checked,
  };
}

function computeQuizSubset(config) {
  let qs = state.questionsAll.slice();
  qs = filterByExams(qs, config.exams);
  qs = filterByImageMode(qs, config.imageFilter);

  if (config.wrongOnly) {
    const wrong = getWrongQuestionIdSet();
    qs = qs.filter(q => wrong.has(q.id));
  }

  if (config.keyword) {
    qs = searchQuestions(qs, { query: config.keyword, inAnswers: config.keywordInAnswers });
  }

  qs = applyRandomAndShuffle(qs, {
    randomN: config.randomN,
    shuffleQuestions: config.shuffleQuestions
  });
  return qs;
}

function computeSearchSubset(config) {
  let qs = state.questionsAll.slice();
  qs = filterByExams(qs, config.exams);
  qs = filterByImageMode(qs, config.imageFilter);

  if (config.wrongOnly) {
    const wrong = getWrongQuestionIdSet();
    qs = qs.filter(q => wrong.has(q.id));
  }

  qs = searchQuestions(qs, { query: config.query, inAnswers: config.inAnswers });
  return qs;
}

function refreshSavedSessionsUi() {
  const datasetId = state.activeDataset?.id;
  const sel = $("savedSessionsSelect");
  sel.innerHTML = "";
  if (!datasetId) return;

  const sessions = listSessions(datasetId);
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const dt = new Date(s.updatedAt || s.createdAt || Date.now());
    const kind = s.kind || "quiz";
    const extra = (s.finishedAt ? "✓ beendet" : "… offen");
    opt.textContent = `${dt.toLocaleString()} · ${kind} · ${s.quizConfig?.quizMode || ""} · ${s.questionOrder?.length || 0} Fragen · ${extra}`;
    sel.appendChild(opt);
  }
}

async function loadDatasetFromManifest(autoToast = false) {
  const d = getSelectedDataset();
  if (!d) {
    alert("Kein Datensatz gefunden (manifest.json).");
    return;
  }
  try {
    const jsonUrls = Array.isArray(d.json) ? d.json : [d.json];
    await loadJsonUrls(jsonUrls);
    await loadZipUrl(d.zip || null);

    state.activeDataset = { ...d };
    const datasetMetaHint = $("datasetMetaHint");
    if (datasetMetaHint) {
      datasetMetaHint.textContent = d.notebookUrl
        ? 'NotebookLM-Link hinterlegt. Beim Klick auf "In NotebookLM erklären" wird der Prompt in die Zwischenablage kopiert.'
        : "Kein NotebookLM-Link hinterlegt (manifest.json: notebookUrl).";
    }

    resetQuizSession();
    resetSearch();
    state.view = "config";
    state.configTab = "quiz";

    updateExamLists();
    resetAllConfigs();

    $("pageNumber").value = "1";
    $("pageNumber2").value = "1";
    $("pageSize2").value = $("pageSize").value;

    refreshSavedSessionsUi();
    updatePreviewTexts();

    await renderAll();
    if (autoToast) toast("Datensatz geladen.");
  } catch (e) {
    alert("Fehler beim Laden des Datensatzes: " + e);
  }
}

function updatePreviewTexts() {
  if (!state.activeDataset) return;

  refreshWrongOnlyControl();

  const quizCfg = buildQuizConfigFromUi();
  const quizSubset = computeQuizSubset(quizCfg);
  const searchCfg = buildSearchConfigFromUi();
  const searchSubset = computeSearchSubset(searchCfg);
  state.preview = { quizCount: quizSubset.length, searchCount: searchSubset.length };

  const activeCount = state.configTab === "search" ? searchSubset.length : quizSubset.length;
  const needPaging = activeCount > 1000;
  const dc = $("displayControlsConfig");
  if (dc) dc.hidden = (state.view === "config") ? true : !needPaging;
}


function bindExamListChange(containerId) {
  const el = $(containerId);
  el.addEventListener("change", async () => {
    updatePreviewTexts();
    if (state.view === "config") await renderAll();
  });
}

function resetQuizConfig() {
  for (const cb of document.querySelectorAll("#examListQuiz input[type=checkbox]")) cb.checked = false;
  $("imageFilterQuiz").value = "all";
  const rn = $("randomN");
  if (rn) rn.value = "";
  const wo = $("wrongOnlyQuiz");
  if (wo) wo.checked = false;
  const kf = $("keywordFilter");
  if (kf) kf.value = "";
  const kia = $("keywordInAnswers");
  if (kia) kia.checked = false;

  $("shuffleQuestions").checked = false;
  $("shuffleAnswers").checked = false;
  $("quizMode").value = "practice";
  updatePreviewTexts();
}

function resetSearchConfig() {
  for (const cb of document.querySelectorAll("#examListSearch input[type=checkbox]")) cb.checked = false;
  $("imageFilterSearch").value = "all";
  $("searchText").value = "";
  $("searchInAnswers").checked = false;
  const wo = $("wrongOnlySearch");
  if (wo) wo.checked = false;
  $("searchShowSolutions").checked = false;
  updatePreviewTexts();
}

function resetAllConfigs() {
  resetQuizConfig();
  resetSearchConfig();
}


export function wireUiEvents() {
  initThemeToggle();
  // Tabs
  $("tabQuiz").addEventListener("click", async () => {
    if (state.view === "search") {
      state.view = "config";
      resetSearch();
      resetAllConfigs();
      updateExamLists();
      refreshSavedSessionsUi();
    }
    state.configTab = "quiz";
    await renderAll();
  });
  $("tabSearch").addEventListener("click", async () => {
    state.configTab = "search";
    await renderAll();
  });

  $("loadDatasetBtn").addEventListener("click", async () => {
    await loadDatasetFromManifest(true);
  });

  $("resetConfigQuizBtn").addEventListener("click", () => resetQuizConfig());
  $("resetConfigSearchBtn").addEventListener("click", async () => {
    resetSearchConfig();
    if (state.view === "search") {
      resetSearch();
      state.view = "config";
      state.configTab = "search";
      updateExamLists();
      refreshSavedSessionsUi();
      await renderAll();
    }
  });

  [
    "imageFilterQuiz","wrongOnlyQuiz","randomN","keywordFilter","keywordInAnswers","shuffleQuestions","shuffleAnswers","quizMode",
    "imageFilterSearch","searchText","searchInAnswers","wrongOnlySearch","searchShowSolutions"
  ].forEach(id => {
    const el = $(id);
    el.addEventListener(el.tagName === "INPUT" ? "input" : "change", async () => {
      updatePreviewTexts();
      if (state.view === "config") await renderAll();
    });
  });
  bindExamListChange("examListQuiz");
  bindExamListChange("examListSearch");

  $("startQuizBtn").addEventListener("click", async () => {
    if (!state.activeDataset) {
      alert("Bitte zuerst einen Datensatz laden.");
      return;
    }
    const cfg = buildQuizConfigFromUi();
    const subset = computeQuizSubset(cfg);
    if (!subset.length) {
      alert("Keine Fragen im Subset. Filter anpassen.");
      return;
    }
    startQuizSession({ subset, config: cfg });
    initNavObserver();
    $("pageNumber").value = "1";
    $("pageNumber2").value = "1";
    $("pageSize2").value = $("pageSize").value;
    await renderAll();
  });

  $("endQuizBtn").addEventListener("click", async () => {
    if (state.view === "quiz") {
      const unanswered = Math.max(0, state.questionOrder.length - state.submitted.size);
      if (unanswered > 0) {
        const verb = unanswered === 1 ? "ist" : "sind";
        const ok = await confirmDialog({
          title: "Zur Auswertung wechseln?",
          message: `${unanswered} Frage${unanswered === 1 ? "" : "n"} ${verb} noch nicht beantwortet. Trotzdem zur Auswertung wechseln?`,
          confirmText: "Zur Auswertung"
        });
        if (!ok) return;
      }
    }

    finishQuizSession();
    initNavObserver();
    refreshSavedSessionsUi();
    await renderAll();
    window.scrollTo({ top: 0, behavior: "auto" });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  });

  $("abortQuizBtn").addEventListener("click", async () => {
    if (state.view === "quiz") {
      const ok = await confirmDialog({
        title: "Abfrage abbrechen?",
        message: "Abfrage wirklich abbrechen und zur Konfiguration zurückkehren?",
        confirmText: "Abfrage abbrechen",
        cancelText: "Zurück"
      });
      if (!ok) return;
      abortQuizSession();
    } else if (state.view === "review") {
      exitToConfig();
    }
    resetAllConfigs();
    updateExamLists();
    refreshSavedSessionsUi();
    await renderAll();
  });

  
  $("startSearchBtn").addEventListener("click", async () => {
    state.configTab = "search";
    if (!state.activeDataset) {
      alert("Bitte zuerst einen Datensatz laden.");
      return;
    }
    const cfg = buildSearchConfigFromUi();
    const subset = computeSearchSubset(cfg);
    startSearchView({ subset, config: cfg });
    initNavObserver();
    $("pageNumber").value = "1";
    await renderAll();
  });

  // Paging main
  $("prevPage").addEventListener("click", async () => {
    $("pageNumber").value = String(Math.max(1, Number($("pageNumber").value || 1) - 1));
    await renderAll();
  });
  $("nextPage").addEventListener("click", async () => {
    $("pageNumber").value = String(Number($("pageNumber").value || 1) + 1);
    await renderAll();
  });
  ["pageSize","pageNumber"].forEach(id => $(id).addEventListener("change", async () => await renderAll()));

  // Paging session mirror
  $("prevPage2").addEventListener("click", async () => {
    $("pageNumber2").value = String(Math.max(1, Number($("pageNumber2").value || 1) - 1));
    $("pageNumber").value = $("pageNumber2").value;
    await renderAll();
  });
  $("nextPage2").addEventListener("click", async () => {
    $("pageNumber2").value = String(Number($("pageNumber2").value || 1) + 1);
    $("pageNumber").value = $("pageNumber2").value;
    await renderAll();
  });
  ["pageSize2","pageNumber2"].forEach(id => {
    $(id).addEventListener("change", async () => {
      $("pageSize").value = $("pageSize2").value;
      $("pageNumber").value = $("pageNumber2").value;
      await renderAll();
    });
  });

  // Storage
  $("deleteSessionBtn").addEventListener("click", () => {
    const datasetId = state.activeDataset?.id;
    if (!datasetId) return;
    const sessionId = $("savedSessionsSelect").value;
    if (!sessionId) return;
    deleteSession(datasetId, sessionId);
    refreshSavedSessionsUi();
    updateExamLists();
    updatePreviewTexts();
    toast("Session gelöscht.");
  });


  $("clearAllLocalDataBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Alle lokalen Daten löschen?",
      message: "Dadurch werden alle gespeicherten Abfragen für alle Datensätze aus diesem Browser entfernt.",
      confirmText: "Alles löschen"
    });
    if (!ok) return;

    const removed = clearAllSessionData();
    refreshSavedSessionsUi();
    updateExamLists();
    updatePreviewTexts();
    toast(removed > 0 ? `Lokale Daten gelöscht (${removed} Speicherstände).` : "Keine lokalen Daten vorhanden.");
  });

  $("downloadBackupBtn").addEventListener("click", () => {
    const backup = exportBackupAllDatasets();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "examgen_backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("importBackupFile").addEventListener("change", async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      importBackupAllDatasets(obj);
      refreshSavedSessionsUi();
      updateExamLists();
      updatePreviewTexts();
    } catch (err) {
      alert("Backup konnte nicht importiert werden: " + err);
    } finally {
      e.target.value = "";
    }
  });

  // Mobile helper button: show "back to navigation" when TOC is out of view
  const navBtn = $("jumpToNavBtn");
  const mq = window.matchMedia("(max-width: 980px)");

  const setNavBtnHidden = (hidden) => {
    if (!navBtn) return;
    navBtn.hidden = hidden;
  };

  const shouldUseNavBtn = () => (mq.matches && (state.view === "quiz" || state.view === "review"));

  if (navBtn) {
    navBtn.addEventListener("click", () => {
      const target = $("sidebarSession");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  let observer = null;
  const initNavObserver = () => {
    if (observer) observer.disconnect();
    if (!shouldUseNavBtn()) {
      setNavBtnHidden(true);
      return;
    }
    const target = $("sidebarSession");
    if (!target) {
      setNavBtnHidden(true);
      return;
    }
    observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!shouldUseNavBtn()) {
        setNavBtnHidden(true);
        return;
      }
      setNavBtnHidden(entry && entry.isIntersecting);
    }, { threshold: 0.15 });

    observer.observe(target);
    setNavBtnHidden(true);
  };

  mq.addEventListener?.("change", () => initNavObserver());

  // re-init on scroll (cheap guard for dynamic layout changes)
  window.addEventListener("scroll", () => {
    if (!navBtn) return;
    if (!shouldUseNavBtn()) { setNavBtnHidden(true); return; }
  }, { passive: true });

  initNavObserver();

}
