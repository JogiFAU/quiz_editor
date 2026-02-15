export const state = {
  questionsAll: [],
  activeDataset: null,
  manifest: null,

  // Original JSON files loaded from manifest (for saving exports)
  datasetFiles: [], // [{ url, payload }]

  // ZIP for images
  zip: null,
  zipIndex: new Map(),
  zipObjectUrls: new Map(),

  // View / workflow
  view: "config", // "config" | "search"

  // Search / filter config
  searchConfig: null,
  searchOrder: [],

  // UI state
  dirty: false,
};

export function resetEditorState() {
  state.view = "config";
  state.searchConfig = null;
  state.searchOrder = [];
  state.dirty = false;
}
