import { state } from "../state.js";

export function clearZipObjectUrls() {
  for (const url of state.zipObjectUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  state.zipObjectUrls = new Map();
}

export function clearLocalImageObjectUrls() {
  for (const entry of state.localImages.values()) {
    try { URL.revokeObjectURL(entry.url); } catch {}
  }
  state.localImages = new Map();
}

function imageBaseName(filename) {
  const cleaned = String(filename || "").trim();
  return cleaned.replace(/\.[^.]+$/, "");
}

export function registerLocalImage(file) {
  if (!file) return null;

  const ext = String(file.name || "").split(".").pop() || "png";
  const base = imageBaseName(file.name) || `bild_${Date.now()}`;
  let candidate = base;
  let idx = 2;

  while (state.localImages.has(candidate) || state.zipIndex.has(candidate)) {
    candidate = `${base}_${idx}`;
    idx += 1;
  }

  const url = URL.createObjectURL(file);
  state.localImages.set(candidate, {
    fileName: `${candidate}.${ext}`,
    blob: file,
    url,
  });
  return candidate;
}

export function removeLocalImage(fileBase) {
  if (!state.localImages.has(fileBase)) return;
  const entry = state.localImages.get(fileBase);
  const url = entry?.url;
  try { URL.revokeObjectURL(url); } catch {}
  state.localImages.delete(fileBase);
}

function requireJSZip() {
  if (typeof window.JSZip === "undefined") {
    throw new Error("JSZip ist nicht verfügbar (CDN blockiert?). Bilder-ZIP kann nicht geladen werden.");
  }
  return window.JSZip;
}

export async function loadZipUrl(url) {
  clearZipObjectUrls();
  if (!url) { state.zip = null; state.zipIndex = new Map(); return; }

  const JSZip = requireJSZip();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ZIP HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  state.zip = zip;
  state.zipIndex = new Map();

  zip.forEach((path, entry) => {
    const base = path.split("/").pop();
    const m = base.match(/^(.+)\.(png|jpg|jpeg|webp|gif)$/i);
    if (m) state.zipIndex.set(m[1], path);
  });
}


export async function loadZipFile(file) {
  clearZipObjectUrls();
  if (!file) { state.zip = null; state.zipIndex = new Map(); return; }

  const JSZip = requireJSZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  state.zip = zip;
  state.zipIndex = new Map();

  zip.forEach((path, entry) => {
    const base = path.split("/").pop();
    const m = base.match(/^(.+)\.(png|jpg|jpeg|webp|gif)$/i);
    if (m) state.zipIndex.set(m[1], path);
  });
}

export async function getImageUrl(fileBase) {
  if (state.localImages.has(fileBase)) {
    return state.localImages.get(fileBase).url;
  }

  if (!state.zip || !state.zipIndex.has(fileBase)) return null;
  if (state.zipObjectUrls.has(fileBase)) return state.zipObjectUrls.get(fileBase);

  const path = state.zipIndex.get(fileBase);
  const blob = await state.zip.file(path).async("blob");
  const url = URL.createObjectURL(blob);
  state.zipObjectUrls.set(fileBase, url);
  return url;
}

export async function buildImagesZipBlob() {
  const JSZip = requireJSZip();
  const out = new JSZip();

  if (state.zip) {
    const copyTasks = [];
    state.zip.forEach((path, entry) => {
      if (entry.dir) return;
      copyTasks.push(
        entry.async("arraybuffer").then((buf) => {
          out.file(path, buf);
        })
      );
    });
    await Promise.all(copyTasks);
  }

  for (const local of state.localImages.values()) {
    out.file(local.fileName, local.blob);
  }

  return out.generateAsync({ type: "blob" });
}
