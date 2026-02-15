import { $, toast } from "../utils.js";
import { state, resetEditorState } from "../state.js";
import { loadJsonFiles, syncQuestionToSource, buildDatasetExports } from "../data/loaders.js";
import { buildImagesZipBlob, clearLocalImageObjectUrls, loadZipFile } from "../data/zipImages.js";
import { filterByExams, filterByImageMode, searchQuestions } from "../quiz/filters.js";
import { renderAll, updateExamLists } from "./render.js";

function selectedExamsFromList() {
  const el = $("examListSearch");
  if (!el) return [];
  return Array.from(el.querySelectorAll("input[type=checkbox][data-exam]:checked"))
    .map((x) => x.dataset.exam)
    .filter(Boolean);
}

function buildSearchConfigFromUi() {
  return {
    exams: selectedExamsFromList(),
    imageFilter: $("imageFilterSearch").value,
    query: $("searchText").value,
    inAnswers: $("searchInAnswers").checked,
  };
}

function computeSearchSubset(config) {
  let qs = state.questionsAll.slice();
  qs = filterByExams(qs, config.exams);
  qs = filterByImageMode(qs, config.imageFilter);
  return searchQuestions(qs, { query: config.query, inAnswers: config.inAnswers });
}

function resetSearchConfig() {
  $("imageFilterSearch").value = "all";
  $("searchText").value = "";
  $("searchInAnswers").checked = false;
  $("pageSize").value = "50";
  $("pageNumber").value = "1";
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

async function saveAsOriginalDownload() {
  syncAllQuestions();
  const exports = buildDatasetExports();
  const zipBlob = await buildImagesZipBlob();

  if (state.activeDataset?.directoryHandle && state.activeDataset?.exportJsonHandle) {
    const payload = exports[0]?.payload || { questions: [] };
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    await writeBlobToHandle(state.activeDataset.exportJsonHandle, jsonBlob);

    let zipHandle = state.activeDataset.zipHandle;
    if (!zipHandle) {
      zipHandle = await state.activeDataset.directoryHandle.getFileHandle("images.zip", { create: true });
      state.activeDataset.zipHandle = zipHandle;
      state.activeDataset.zipFileName = "images.zip";
    }
    await writeBlobToHandle(zipHandle, zipBlob);

    state.dirty = false;
    await renderAll();
    toast("Datensatz im gewählten Ordner aktualisiert.");
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

async function loadFromResolvedFiles({ exportJsonFile, zipFile, folderName, handles = null }) {
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
  updateExamLists();
  resetSearchConfig();
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

  $("resetConfigSearchBtn").addEventListener("click", async () => {
    resetSearchConfig();
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
        state.searchOrder = computeSearchSubset(cfg).map((q) => q.id);
      }
      await renderAll();
    });
  });

  $("examListSearch").addEventListener("change", async () => {
    if (state.view === "search") {
      const cfg = buildSearchConfigFromUi();
      state.searchOrder = computeSearchSubset(cfg).map((q) => q.id);
    }
    await renderAll();
  });

  $("questionList").addEventListener("input", () => {
    state.dirty = true;
  });
}
