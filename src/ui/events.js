import { $, toast } from "../utils.js";
import { state, resetEditorState } from "../state.js";
import { loadJsonFiles, syncQuestionToSource, buildDatasetExports } from "../data/loaders.js";
import { buildImagesZipBlob, clearLocalImageObjectUrls, loadZipFile } from "../data/zipImages.js";
import { filterByExams, filterByImageMode, filterByTopics, searchQuestions } from "../quiz/filters.js";
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
    imageFilter: "all",
    query: "",
    inAnswers: false,
  };
}

function buildSearchConfigFromUi() {
  return {
    exams: selectedExamsFromList(),
    topics: selectedTopicsFromList(),
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
  qs = filterByImageMode(qs, config.imageFilter);
  return searchQuestions(qs, { query: config.query, inAnswers: config.inAnswers });
}

function resetSearchConfig() {
  $("imageFilterSearch").value = "all";
  $("searchText").value = "";
  $("searchInAnswers").checked = false;
  $("pageSize").value = "50";
  $("pageNumber").value = "1";
  $("bulkSearchText").value = "";
  $("bulkReplaceText").value = "";
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
  const items = Array.isArray(source?.superTopics) ? source.superTopics : [];
  const superTopics = [];
  const allSubTopics = new Set();
  const subTopicsBySuper = {};

  for (const item of items) {
    const superName = String(item?.name || "").trim();
    if (!superName) continue;

    const subs = Array.isArray(item?.subtopics)
      ? item.subtopics.map((s) => String(s || "").trim()).filter(Boolean)
      : [];

    superTopics.push(superName);
    subTopicsBySuper[superName] = subs;
    subs.forEach((s) => allSubTopics.add(s));
  }

  return {
    superTopics: Array.from(new Set(superTopics)).sort(),
    subTopicsBySuper,
    allSubTopics: Array.from(allSubTopics).sort(),
  };
}

async function loadTopicTreeFromFile(file) {
  if (!file) {
    state.topicCatalog = null;
    const hint = $("topicTreeHint");
    if (hint) hint.textContent = "Keine Themenquelle geladen.";
    await renderAll();
    return;
  }

  try {
    const txt = await file.text();
    state.topicCatalog = parseTopicTree(txt);
    const hint = $("topicTreeHint");
    if (hint) {
      hint.textContent = `Geladen: ${file.name} · ${state.topicCatalog.superTopics.length} Überthemen`; 
    }
    await renderAll();
    toast("Themenstruktur geladen.");
  } catch (err) {
    alert("Themenstruktur konnte nicht gelesen werden. Erwartetes Format: { superTopics: [{ name, subtopics: [] }] }");
  }
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

async function loadFromResolvedFiles({ exportJsonFile, zipFile, folderName, handles = null, uiSnapshot = null }) {
  clearLocalImageObjectUrls();
  await loadJsonFiles([exportJsonFile]);
  await loadZipFile(zipFile);

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

  try {
    const folderName = getFolderNameFromEntry(exportJson);
    await loadFromResolvedFiles({ exportJsonFile: exportJson, zipFile, folderName });
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

    await loadFromResolvedFiles({
      exportJsonFile,
      zipFile,
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

  const topicTreeInput = $("topicTreeInput");
  if (topicTreeInput) {
    topicTreeInput.addEventListener("change", async () => {
      const file = topicTreeInput.files?.[0] || null;
      await loadTopicTreeFromFile(file);
    });
  }

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

  ["imageFilterSearch", "searchText", "searchInAnswers"].forEach((id) => {
    const el = $(id);
    el.addEventListener(el.tagName === "INPUT" ? "input" : "change", async () => {
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
