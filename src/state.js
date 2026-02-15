export const state = {
  questionsAll: [],
  activeDataset: null,
  // Original JSON files loaded from file upload (for saving exports)
  datasetFiles: [], // [{ url, payload }]

  // ZIP for images
  zip: null,
  zipIndex: new Map(),
  zipObjectUrls: new Map(),
  localImages: new Map(), // fileBase -> { fileName, blob, url }

  // View / workflow
  view: "config", // "config" | "search"

  // Search / filter config
  searchConfig: null,
  searchOrder: [],

  // UI state
  dirty: false,

  // Optional uploaded taxonomy source for topic suggestions
  topicCatalog: null,
};

export function resetEditorState() {
  state.view = "config";
  state.searchConfig = null;
  state.searchOrder = [];
  state.dirty = false;
  state.topicCatalog = null;
}
