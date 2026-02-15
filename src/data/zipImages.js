import { state } from "../state.js";

export function clearZipObjectUrls() {
  for (const url of state.zipObjectUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  state.zipObjectUrls = new Map();
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
  if (!state.zip || !state.zipIndex.has(fileBase)) return null;
  if (state.zipObjectUrls.has(fileBase)) return state.zipObjectUrls.get(fileBase);

  const path = state.zipIndex.get(fileBase);
  const blob = await state.zip.file(path).async("blob");
  const url = URL.createObjectURL(blob);
  state.zipObjectUrls.set(fileBase, url);
  return url;
}
