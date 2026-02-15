import { $, toast } from "../utils.js";
import { state, resetEditorState } from "../state.js";
import { loadJsonFiles, syncQuestionToSource, buildDatasetExports } from "../data/loaders.js";
import { buildImagesZipBlob, clearLocalImageObjectUrls, loadZipFile } from "../data/zipImages.js";
import { filterByExams, filterByImageMode, filterByQuality, filterByTopics, searchQuestions } from "../quiz/filters.js";
import { refreshHeaderStatus, renderAll, updateExamLists, updateTopicList } from "./render.js";

function selectedExamsFromList() {
  const el = $("examListSearch");
  if (!el) return [];
  return Array.from(el.querySelectorAll("input[type=checkbox][data-exam]:checked"))
    .map((x) => x.dataset.exam)
    .filter(Boolean);
}


function selectedTopicsFromList() {
  const el = $("topicListSearch");
  if (!el) return [];
  return Array.from(el.querySelectorAll("input[type=checkbox][data-topic-type]:checked"))
    .map((x) => {
      if (x.dataset.topicType === "super") return `super::${x.dataset.topicValue || ""}`;
      return `sub::${x.dataset.parentTopic || ""}::${x.dataset.topicValue || ""}`;
    })
    .filter((v) => v !== "super::" && v !== "sub::::");
}

function syncSuperTopicState(superTopic) {
  const list = $("topicListSearch");
  if (!list) return;

  const superCb = list.querySelector(`input[data-topic-type="super"][data-topic-value="${CSS.escape(superTopic)}"]`);
  if (!superCb) return;

  const childCbs = Array.from(list.querySelectorAll(`input[data-topic-type="sub"][data-parent-topic="${CSS.escape(superTopic)}"]`));
  if (!childCbs.length) return;

  const checkedCount = childCbs.filter((cb) => cb.checked).length;
  superCb.indeterminate = checkedCount > 0 && checkedCount < childCbs.length;
  superCb.checked = checkedCount === childCbs.length;
}

function syncAllSuperTopicStates() {
  const list = $("topicListSearch");
  if (!list) return;
  const supers = Array.from(list.querySelectorAll('input[data-topic-type="super"]'));
  supers.forEach((cb) => syncSuperTopicState(cb.dataset.topicValue || ""));
}

function defaultSearchConfig() {
  return {
    exams: [],
    topics: [],
    topicConfidenceMin: 1,
    answerConfidenceMin: 1,
    onlyRecommendChange: false,
    onlyNeedsMaintenance: false,
    imageFilter: "all",
    query: "",
    inAnswers: false,
  };
}

function buildSearchConfigFromUi() {
  return {
    exams: selectedExamsFromList(),
    topics: selectedTopicsFromList(),
    topicConfidenceMin: clampCutoff($("topicConfidenceMinSearch")?.value ?? 1),
    answerConfidenceMin: clampCutoff($("answerConfidenceMinSearch")?.value ?? 1),
    onlyRecommendChange: !!$("onlyRecommendChangeSearch")?.checked,
    onlyNeedsMaintenance: !!$("onlyNeedsMaintenanceSearch")?.checked,
    imageFilter: $("imageFilterSearch").value,
    query: $("searchText").value,
    inAnswers: $("searchInAnswers").checked,
  };
}

function applySearchConfigToUi(config) {
  const cfg = config || defaultSearchConfig();
  $("imageFilterSearch").value = cfg.imageFilter || "all";
  $("searchText").value = cfg.query || "";
  $("searchInAnswers").checked = !!cfg.inAnswers;
  syncConfidenceControl("topic", Number(cfg.topicConfidenceMin ?? 1));
  syncConfidenceControl("answer", Number(cfg.answerConfidenceMin ?? 1));
  $("onlyRecommendChangeSearch").checked = !!cfg.onlyRecommendChange;
  $("onlyNeedsMaintenanceSearch").checked = !!cfg.onlyNeedsMaintenance;
  updateSliderLabels();

  const selectedExams = new Set(cfg.exams || []);
  const examList = $("examListSearch");
  if (examList) {
    examList.querySelectorAll("input[type=checkbox][data-exam]").forEach((cb) => {
      cb.checked = selectedExams.has(cb.dataset.exam);
    });
  }

  const selectedTopics = new Set(cfg.topics || []);
  const topicList = $("topicListSearch");
  if (topicList) {
    topicList.querySelectorAll('input[data-topic-type="super"]').forEach((cb) => {
      cb.checked = selectedTopics.has(`super::${cb.dataset.topicValue || ""}`);
      cb.indeterminate = false;
    });
    topicList.querySelectorAll('input[data-topic-type="sub"]').forEach((cb) => {
      cb.checked = selectedTopics.has(`sub::${cb.dataset.parentTopic || ""}::${cb.dataset.topicValue || ""}`);
    });
    syncAllSuperTopicStates();
  }
}

function computeSearchSubset(config) {
  let qs = state.questionsAll.slice();
  qs = filterByExams(qs, config.exams);
  qs = filterByTopics(qs, config.topics);
  qs = filterByQuality(qs, {
    topicConfidenceMin: config.topicConfidenceMin,
    answerConfidenceMin: config.answerConfidenceMin,
    onlyRecommendChange: config.onlyRecommendChange,
    onlyNeedsMaintenance: config.onlyNeedsMaintenance,
  });
  qs = filterByImageMode(qs, config.imageFilter);
  return searchQuestions(qs, { query: config.query, inAnswers: config.inAnswers });
}

function resetSearchConfig() {
  $("imageFilterSearch").value = "all";
  $("searchText").value = "";
  $("searchInAnswers").checked = false;
  syncConfidenceControl("topic", 1);
  syncConfidenceControl("answer", 1);
  $("onlyRecommendChangeSearch").checked = false;
  $("onlyNeedsMaintenanceSearch").checked = false;
  updateSliderLabels();
  $("pageSize").value = "50";
  $("pageNumber").value = "1";
  $("bulkSearchText").value = "";
  $("bulkReplaceText").value = "";
}

function clampCutoff(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function syncConfidenceControl(kind, rawValue, source = "range") {
  const value = clampCutoff(rawValue);
  const isTopic = kind === "topic";
  const rangeEl = $(isTopic ? "topicConfidenceMinSearch" : "answerConfidenceMinSearch");
  const inputEl = $(isTopic ? "topicConfidenceMinInput" : "answerConfidenceMinInput");
  const labelEl = $(isTopic ? "topicConfidenceMinValue" : "answerConfidenceMinValue");
  if (!rangeEl || !inputEl || !labelEl) return value;

  const fixed = value.toFixed(2);
  if (source !== "range") rangeEl.value = String(value);
  if (source !== "input") inputEl.value = fixed;
  labelEl.textContent = fixed;
  return value;
}

function updateSliderLabels() {
  syncConfidenceControl("topic", $("topicConfidenceMinSearch")?.value ?? 1, "range");
  syncConfidenceControl("answer", $("answerConfidenceMinSearch")?.value ?? 1, "range");
}

function baseFilenameFromUrl(url) {
  const clean = String(url || "").split("?")[0];
  const seg = clean.split("/").filter(Boolean).pop();
  return seg || "export.json";
}

function hasFileSystemAccessApi() {
  return typeof window.showDirectoryPicker === "function";
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function writeBlobToHandle(fileHandle, blob) {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function syncAllQuestions() {
  for (const q of state.questionsAll) syncQuestionToSource(q);
}

function captureUiSnapshot() {
  return {
    searchConfig: buildSearchConfigFromUi(),
    view: state.view,
    pageSize: $("pageSize").value,
    pageNumber: $("pageNumber").value,
  };
}

function applySnapshotAfterReload(snapshot) {
  if (!snapshot) return;

  applySearchConfigToUi(snapshot.searchConfig);
  $("pageSize").value = snapshot.pageSize || "50";
  $("pageNumber").value = snapshot.pageNumber || "1";

  state.searchConfig = snapshot.searchConfig;
  if (snapshot.view === "search") {
    state.view = "search";
    state.searchOrder = computeSearchSubset(snapshot.searchConfig).map((q) => q.id);
  }
}

async function reloadCurrentDatasetPreservingUi(snapshot) {
  if (!state.activeDataset?.directoryHandle || !state.activeDataset?.exportJsonHandle) return;

  const exportJsonFile = await state.activeDataset.exportJsonHandle.getFile();
  let zipFile = null;
  if (state.activeDataset.zipHandle) {
    zipFile = await state.activeDataset.zipHandle.getFile();
  }

  await loadFromResolvedFiles({
    exportJsonFile,
    zipFile,
    folderName: state.activeDataset.label || state.activeDataset.directoryHandle.name || "Ordner",
    handles: {
      directoryHandle: state.activeDataset.directoryHandle,
      exportJsonHandle: state.activeDataset.exportJsonHandle,
      zipHandle: state.activeDataset.zipHandle,
    },
    uiSnapshot: snapshot,
  });
}

async function saveAsOriginalDownload() {
  syncAllQuestions();
  const exports = buildDatasetExports();
  const zipBlob = await buildImagesZipBlob();

  if (state.activeDataset?.directoryHandle && state.activeDataset?.exportJsonHandle) {
    const payload = exports[0]?.payload || { questions: [] };
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const uiSnapshot = captureUiSnapshot();

    await writeBlobToHandle(state.activeDataset.exportJsonHandle, jsonBlob);

    let zipHandle = state.activeDataset.zipHandle;
    if (!zipHandle) {
      zipHandle = await state.activeDataset.directoryHandle.getFileHandle("images.zip", { create: true });
      state.activeDataset.zipHandle = zipHandle;
      state.activeDataset.zipFileName = "images.zip";
    }
    await writeBlobToHandle(zipHandle, zipBlob);

    await reloadCurrentDatasetPreservingUi(uiSnapshot);
    state.dirty = false;
    await renderAll();
    toast("Datensatz gespeichert und neu geladen.");
    return;
  }

  exports.forEach((entry) => {
    downloadJson(entry.payload, baseFilenameFromUrl(entry.url));
  });
  downloadBlob(zipBlob, state.activeDataset?.zipFileName || "images.zip");
  state.dirty = false;
  await renderAll();
  toast("JSON und images.zip mit Original-Dateinamen heruntergeladen.");
}

async function saveAsCopyDownload() {
  syncAllQuestions();
  const suffix = ($("copySuffix")?.value || "bearbeitet").trim() || "bearbeitet";
  const exports = buildDatasetExports();
  const base = baseFilenameFromUrl(exports[0]?.url || "export.json").replace(/\.json$/i, "");
  const zipBase = (state.activeDataset?.zipFileName || "images.zip").replace(/\.zip$/i, "");
  const jsonName = `${base}_${suffix}.json`;
  const zipName = `${zipBase}_${suffix}.zip`;
  const zipBlob = await buildImagesZipBlob();

  if (state.activeDataset?.directoryHandle) {
    const payload = exports[0]?.payload || { questions: [] };
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const jsonHandle = await state.activeDataset.directoryHandle.getFileHandle(jsonName, { create: true });
    const zipHandle = await state.activeDataset.directoryHandle.getFileHandle(zipName, { create: true });
    await writeBlobToHandle(jsonHandle, jsonBlob);
    await writeBlobToHandle(zipHandle, zipBlob);
    toast(`Kopie im Ordner gespeichert: ${jsonName} + ${zipName}`);
    return;
  }

  downloadJson(exports[0]?.payload || { questions: [] }, jsonName);
  downloadBlob(zipBlob, zipName);
  toast("Bearbeitete JSON + images.zip als Kopie heruntergeladen.");
}

function getFolderNameFromEntry(file) {
  const rel = String(file?.webkitRelativePath || "");
  const seg = rel.split("/").filter(Boolean);
  return seg.length > 1 ? seg[0] : "Ordner";
}

function parseTopicTree(raw) {
  const source = typeof raw === "string" ? JSON.parse(raw) : raw;
  const superTopics = [];
  const allSubTopics = new Set();
  const subTopicsBySuper = {};

  const pushNode = (superName, subName = "") => {
    const over = String(superName || "").trim();
    if (!over) return;
    if (!subTopicsBySuper[over]) {
      subTopicsBySuper[over] = [];
      superTopics.push(over);
    }
    const under = String(subName || "").trim();
    if (under && !subTopicsBySuper[over].includes(under)) {
      subTopicsBySuper[over].push(under);
      allSubTopics.add(under);
    }
  };

  const walk = (node, currentSuper = "") => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry, currentSuper));
      return;
    }

    if (typeof node === "string") {
      if (currentSuper) pushNode(currentSuper, node);
      return;
    }

    const name = String(node.name || node.superTopic || node.title || "").trim();
    const superName = name || currentSuper;

    if (superName && !currentSuper) {
      pushNode(superName);
    }

    const candidates = [node.subtopics, node.subTopics, node.children, node.topics];
    const firstArray = candidates.find((x) => Array.isArray(x));
    if (firstArray) {
      firstArray.forEach((child) => walk(child, superName));
    }

    const explicitSub = String(node.subtopic || node.subTopic || "").trim();
    if (explicitSub && superName) {
      pushNode(superName, explicitSub);
    }
  };

  const roots = Array.isArray(source?.superTopics)
    ? source.superTopics
    : (Array.isArray(source?.topics) ? source.topics : source);
  walk(roots, "");

  return {
    superTopics: Array.from(new Set(superTopics)).sort(),
    subTopicsBySuper: Object.fromEntries(
      Object.entries(subTopicsBySuper).map(([k, vals]) => [k, Array.from(new Set(vals)).sort()]),
    ),
    allSubTopics: Array.from(allSubTopics).sort(),
  };
}


async function loadTopicTreeFromFile(file, { quiet = false } = {}) {
  if (!file) {
    state.topicCatalog = null;
    return;
  }

  try {
    const txt = await file.text();
    state.topicCatalog = parseTopicTree(txt);
    if (!quiet) {
      toast(`Themenstruktur geladen: ${file.name}`);
    }
  } catch (err) {
    state.topicCatalog = null;
    if (!quiet) {
      alert("Themenstruktur konnte nicht gelesen werden. Erwartetes Format: { superTopics: [{ name, subtopics: [] }] }");
    }
  }
}

function findTopicTreeFile(directoryFiles) {
  const candidates = ["topic-tree.json", "topic_tree.json", "topicTree.json"];
  const files = directoryFiles || [];
  const byLower = new Map(files.map((f) => [String(f.name || "").toLowerCase(), f]));
  for (const candidate of candidates) {
    const match = byLower.get(candidate.toLowerCase());
    if (match) return match;
  }
  return files.find((file) => /topic[-_]?tree.*\.json$/i.test(String(file?.name || ""))) || null;
}

async function getTopicTreeFileFromDirectoryHandle(directoryHandle) {
  const candidates = ["topic-tree.json", "topic_tree.json", "topicTree.json"];
  for (const candidate of candidates) {
    try {
      const handle = await directoryHandle.getFileHandle(candidate);
      const file = await handle.getFile();
      return file;
    } catch {
      // try next candidate
    }
  }

  try {
    for await (const handle of directoryHandle.values()) {
      if (handle.kind === "file" && /topic[-_]?tree.*\.json$/i.test(handle.name)) {
        return await handle.getFile();
      }
    }
  } catch {
    // browser might not support iteration
  }

  return null;
}

function replaceAcrossQuestion(question, searchText, replaceText) {
  const apply = (value) => String(value || "").split(searchText).join(replaceText);
  let touched = false;

  const textNew = apply(question.text);
  if (textNew !== question.text) {
    question.text = textNew;
    touched = true;
  }

  const explanationNew = apply(question.explanation);
  if (explanationNew !== question.explanation) {
    question.explanation = explanationNew;
    touched = true;
  }

  question.answers.forEach((a) => {
    const next = apply(a.text);
    if (next !== a.text) {
      a.text = next;
      touched = true;
    }
  });

  return touched;
}

async function applyBulkReplace() {
  if (state.view !== "search") {
    alert("Bitte zuerst über „Fragen anzeigen“ eine Trefferliste erzeugen.");
    return;
  }

  const searchText = $("bulkSearchText").value;
  const replaceText = $("bulkReplaceText").value;
  if (!searchText) {
    alert("Bitte einen Suchtext für Ersetzen eingeben.");
    return;
  }

  const ids = new Set(state.searchOrder);
  let changed = 0;
  state.questionsAll.forEach((q) => {
    if (!ids.has(q.id)) return;
    if (replaceAcrossQuestion(q, searchText, replaceText)) changed++;
  });

  if (!changed) {
    toast("Keine Treffer für Suchen/Ersetzen gefunden.");
    return;
  }

  state.dirty = true;
  await renderAll();
  toast(`Suchen/Ersetzen auf ${changed} Frage(n) angewendet.`);
}

async function loadFromResolvedFiles({ exportJsonFile, zipFile, topicTreeFile = null, folderName, handles = null, uiSnapshot = null }) {
  clearLocalImageObjectUrls();
  await loadJsonFiles([exportJsonFile]);
  await loadZipFile(zipFile);
  await loadTopicTreeFromFile(topicTreeFile, { quiet: true });

  state.activeDataset = {
    id: "upload",
    label: folderName,
    zipFileName: zipFile?.name || "images.zip",
    directoryHandle: handles?.directoryHandle || null,
    exportJsonHandle: handles?.exportJsonHandle || null,
    zipHandle: handles?.zipHandle || null,
  };

  resetEditorState();
  const startConfig = uiSnapshot?.searchConfig || defaultSearchConfig();
  state.searchConfig = startConfig;

  resetSearchConfig();
  updateExamLists(startConfig.exams || []);
  updateTopicList(startConfig.topics || []);
  applySearchConfigToUi(startConfig);
  applySnapshotAfterReload(uiSnapshot);

  await renderAll();

  const fileHint = $("loadedFileHint");
  if (fileHint) {
    const mode = handles ? "(Live)" : "";
    const zipHint = zipFile ? ` + ${zipFile.name}` : "";
    fileHint.textContent = `Geladen ${mode} aus Ordner „${folderName}“: ${exportJsonFile.name}${zipHint}`.trim();
  }
}

async function loadDatasetFromDirectoryFiles(directoryFiles) {
  if (!directoryFiles.length) {
    alert("Bitte einen Ordner auswählen.");
    return;
  }

  const exportJson = directoryFiles.find((file) => file.name.toLowerCase() === "export.json");
  if (!exportJson) {
    alert("Im gewählten Ordner wurde keine export.json gefunden.");
    return;
  }

  const zipFile = directoryFiles.find((file) => file.name.toLowerCase() === "images.zip") || null;
  const topicTreeFile = findTopicTreeFile(directoryFiles);

  try {
    const folderName = getFolderNameFromEntry(exportJson);
    await loadFromResolvedFiles({ exportJsonFile: exportJson, zipFile, topicTreeFile, folderName });
    toast("Ordner geladen.");
  } catch (e) {
    alert("Fehler beim Laden des Ordners: " + e);
  }
}

async function pickAndLoadDirectoryLive() {
  if (!hasFileSystemAccessApi()) {
    alert("Live-Bearbeitung ist in diesem Browser nicht verfügbar. Bitte den normalen Ordner-Import nutzen.");
    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const exportJsonHandle = await directoryHandle.getFileHandle("export.json");
    const exportJsonFile = await exportJsonHandle.getFile();

    let zipHandle = null;
    let zipFile = null;
    try {
      zipHandle = await directoryHandle.getFileHandle("images.zip");
      zipFile = await zipHandle.getFile();
    } catch {
      zipHandle = null;
      zipFile = null;
    }

    const topicTreeFile = await getTopicTreeFileFromDirectoryHandle(directoryHandle);

    await loadFromResolvedFiles({
      exportJsonFile,
      zipFile,
      topicTreeFile,
      folderName: directoryHandle.name || "Ordner",
      handles: { directoryHandle, exportJsonHandle, zipHandle },
    });

    toast("Ordner mit Schreibzugriff geladen (Live-Speichern aktiv).");
  } catch (e) {
    if (e?.name === "AbortError") return;
    alert("Fehler beim Live-Laden des Ordners: " + e);
  }
}

export function wireUiEvents() {
  updateSliderLabels();
  const folderInput = $("datasetFolderInput");
  const pickFolderBtn = $("pickFolderBtn");

  if (pickFolderBtn) {
    pickFolderBtn.hidden = !hasFileSystemAccessApi();
    pickFolderBtn.addEventListener("click", async () => {
      await pickAndLoadDirectoryLive();
    });
  }

  const updateSelectedFileHint = () => {
    const files = Array.from(folderInput.files || []);
    const exportJson = files.find((file) => file.name.toLowerCase() === "export.json");
    const zipFile = files.find((file) => file.name.toLowerCase() === "images.zip") || null;
    const fileHint = $("loadedFileHint");
    if (!fileHint) return;

    if (!files.length) {
      fileHint.textContent = "Noch kein Ordner ausgewählt.";
      return;
    }

    const folderName = getFolderNameFromEntry(files[0]);
    if (!exportJson) {
      fileHint.textContent = `Ausgewählter Ordner „${folderName}“ enthält keine export.json.`;
      return;
    }

    const zipHint = zipFile ? ` + ${zipFile.name}` : "";
    fileHint.textContent = `Ausgewählt: Ordner „${folderName}“ mit ${exportJson.name}${zipHint}`;
  };

  folderInput.addEventListener("change", updateSelectedFileHint);

  $("loadFilesBtn").addEventListener("click", async () => {
    const folderFiles = Array.from(folderInput.files || []);
    await loadDatasetFromDirectoryFiles(folderFiles);
  });

  $("startSearchBtn").addEventListener("click", async () => {
    if (!state.activeDataset) {
      alert("Bitte zuerst einen Datensatz laden.");
      return;
    }

    const cfg = buildSearchConfigFromUi();
    const subset = computeSearchSubset(cfg);
    state.searchConfig = cfg;
    state.searchOrder = subset.map((q) => q.id);
    state.view = "search";
    $("pageNumber").value = "1";
    await renderAll();
  });

  $("applyReplaceBtn").addEventListener("click", async () => {
    await applyBulkReplace();
  });

  $("resetConfigSearchBtn").addEventListener("click", async () => {
    resetSearchConfig();
    state.searchConfig = defaultSearchConfig();
    updateExamLists([]);
    updateTopicList([]);
    if (state.activeDataset) {
      state.view = "config";
      state.searchOrder = [];
      await renderAll();
    }
  });

  $("saveOriginalBtn").addEventListener("click", async () => {
    if (!state.activeDataset) return;
    await saveAsOriginalDownload();
  });

  $("saveCopyBtn").addEventListener("click", async () => {
    if (!state.activeDataset) return;
    await saveAsCopyDownload();
  });

  ["prevPage", "nextPage"].forEach((id) => {
    $(id).addEventListener("click", async () => {
      const cur = Number($("pageNumber").value || 1);
      $("pageNumber").value = String(id === "prevPage" ? Math.max(1, cur - 1) : cur + 1);
      await renderAll();
    });
  });
  ["pageSize", "pageNumber"].forEach((id) => $(id).addEventListener("change", async () => await renderAll()));

  ["imageFilterSearch", "searchText", "searchInAnswers", "topicConfidenceMinSearch", "answerConfidenceMinSearch", "topicConfidenceMinInput", "answerConfidenceMinInput", "onlyRecommendChangeSearch", "onlyNeedsMaintenanceSearch"].forEach((id) => {
    const el = $(id);
    el.addEventListener(el.tagName === "INPUT" ? "input" : "change", async () => {
      if (id === "topicConfidenceMinSearch") {
        syncConfidenceControl("topic", el.value, "range");
      } else if (id === "answerConfidenceMinSearch") {
        syncConfidenceControl("answer", el.value, "range");
      } else if (id === "topicConfidenceMinInput") {
        syncConfidenceControl("topic", el.value, "input");
      } else if (id === "answerConfidenceMinInput") {
        syncConfidenceControl("answer", el.value, "input");
      } else {
        updateSliderLabels();
      }

      if (state.view === "search") {
        const cfg = buildSearchConfigFromUi();
        state.searchConfig = cfg;
        state.searchOrder = computeSearchSubset(cfg).map((q) => q.id);
      }
      await renderAll();
    });
  });

  $("examListSearch").addEventListener("change", async () => {
    if (state.view === "search") {
      const cfg = buildSearchConfigFromUi();
      state.searchConfig = cfg;
      state.searchOrder = computeSearchSubset(cfg).map((q) => q.id);
    }
    await renderAll();
  });

  const topicList = $("topicListSearch");
  if (topicList) {
    topicList.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;

      if (target.dataset.topicType === "super") {
        const superTopic = target.dataset.topicValue || "";
        topicList
          .querySelectorAll(`input[data-topic-type="sub"][data-parent-topic="${CSS.escape(superTopic)}"]`)
          .forEach((subCb) => {
            subCb.checked = target.checked;
          });
        target.indeterminate = false;
      } else if (target.dataset.topicType === "sub") {
        syncSuperTopicState(target.dataset.parentTopic || "");
      }

      if (state.view === "search") {
        const cfg = buildSearchConfigFromUi();
        state.searchConfig = cfg;
        state.searchOrder = computeSearchSubset(cfg).map((q) => q.id);
      }
      await renderAll();
    });
  }

  const questionList = $("questionList");
  ["input", "change"].forEach((evt) => {
    questionList.addEventListener(evt, () => {
      state.dirty = true;
      refreshHeaderStatus();
    });
  });
}
