import { wireUiEvents } from "./ui/events.js";
import { renderAll } from "./ui/render.js";

async function init() {
  wireUiEvents();
  await renderAll();
}

init();
