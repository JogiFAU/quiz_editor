import { state } from "../state.js";
import { $, letter } from "../utils.js";
import { getImageUrl } from "../data/zipImages.js";
import { questionIdIndex } from "../quiz/filters.js";

function setHeader() {
  const subtitle = $("headerSubtitle");
  const progressText = $("headerProgressText");
  const rightStat = $("headerCorrectPct");
  const bar = $("headerProgressBar");

  if (!state.activeDataset) {
    subtitle.textContent = "Datensatz laden und Bearbeitung konfigurieren";
    progressText.textContent = "—";
    rightStat.textContent = "—";
    bar.style.width = "0%";
    return;
  }

  const total = state.questionsAll.length;
  const shown = state.view === "search" ? state.searchOrder.length : 0;
  subtitle.textContent = `${state.activeDataset.label || state.activeDataset.id} · Editor`;
  progressText.textContent = `${shown}/${total}`;
  rightStat.textContent = state.dirty ? "ungespeichert" : "gespeichert";
  bar.style.width = total ? `${(shown / total) * 100}%` : "0%";
}

export function updateExamLists() {
  const exams = Array.from(new Set(state.questionsAll.map((q) => q.examName).filter(Boolean))).sort();
  renderExamList("examListSearch", exams);
}

function renderExamList(containerId, exams) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = "";

  for (const exam of exams) {
    const item = document.createElement("label");
    item.className = "examitem selected";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.exam = exam;
    cb.checked = true;

    const name = document.createElement("div");
    name.className = "examname";
    name.textContent = exam;

    item.appendChild(cb);
    item.appendChild(name);
    el.appendChild(item);
  }
}

export function renderPager(totalCount) {
  const pageSizeEl = $("pageSize");
  const pageNumberEl = $("pageNumber");
  const pageInfoEl = $("pageInfo");

  const pageSize = Math.max(10, Math.min(300, Number(pageSizeEl.value || 50)));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  let page = Number(pageNumberEl.value || 1);
  page = Math.max(1, Math.min(totalPages, page));

  pageNumberEl.value = String(page);
  pageInfoEl.textContent = `Seite ${page}/${totalPages} · ${totalCount} Fragen`;
  return { page, pageSize };
}

function getCurrentQuestions() {
  if (state.view !== "search") return [];
  const idx = questionIdIndex(state.questionsAll);
  return state.searchOrder.map((qid) => idx.get(qid)).filter(Boolean);
}

export async function renderMain() {
  setHeader();
  const list = $("questionList");
  const info = $("mainInfo");
  list.innerHTML = "";

  if (!state.activeDataset) {
    info.textContent = "Noch keine Daten geladen.";
    return;
  }

  if (state.view === "config") {
    info.textContent = "Filter wählen und dann auf „Fragen anzeigen“ klicken.";
    return;
  }

  const questions = getCurrentQuestions();
  info.textContent = `Bearbeitbare Fragen: ${questions.length}`;

  const { page, pageSize } = renderPager(questions.length);
  const start = (page - 1) * pageSize;
  const pageQs = questions.slice(start, start + pageSize);

  for (const q of pageQs) {
    const card = document.createElement("article");
    card.className = "qcard";
    card.id = `q_${q.id}`;

    const h = document.createElement("div");
    h.className = "qhead";
    h.innerHTML = `<div><strong>ID:</strong> ${q.id}</div>`;
    card.appendChild(h);

    const addField = (label, value, onChange, type = "text") => {
      const wrap = document.createElement("label");
      wrap.className = "editorField";
      const ttl = document.createElement("div");
      ttl.className = "small";
      ttl.textContent = label;

      const inp = document.createElement(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") inp.type = "text";
      inp.value = value || "";
      inp.addEventListener("input", () => { onChange(inp.value); state.dirty = true; });

      wrap.appendChild(ttl);
      wrap.appendChild(inp);
      card.appendChild(wrap);
    };

    addField("Klausur", q.examName, (v) => q.examName = v);
    addField("Jahr", q.examYear, (v) => q.examYear = v);
    addField("Topic/Thema", q.topic, (v) => q.topic = v);
    addField("Frage", q.text, (v) => q.text = v, "textarea");
    addField("Erklärung", q.explanation, (v) => q.explanation = v, "textarea");

    const ansWrap = document.createElement("div");
    ansWrap.className = "opts";

    q.answers.forEach((a, idx) => {
      const row = document.createElement("div");
      row.className = "opt editorAnswer";

      const correct = document.createElement("input");
      correct.type = "checkbox";
      correct.checked = !!a.isCorrect;
      correct.addEventListener("change", () => {
        a.isCorrect = correct.checked;
        state.dirty = true;
      });

      const text = document.createElement("textarea");
      text.value = `${letter(idx)}) ${a.text || ""}`;
      text.addEventListener("input", () => {
        a.text = text.value.replace(/^[A-Z]\)\s*/, "");
        state.dirty = true;
      });

      const del = document.createElement("button");
      del.className = "btn danger";
      del.type = "button";
      del.textContent = "Antwort löschen";
      del.addEventListener("click", () => {
        q.answers.splice(idx, 1);
        state.dirty = true;
        renderAll();
      });

      row.appendChild(correct);
      row.appendChild(text);
      row.appendChild(del);
      ansWrap.appendChild(row);
    });

    const addAnswerBtn = document.createElement("button");
    addAnswerBtn.className = "btn";
    addAnswerBtn.type = "button";
    addAnswerBtn.textContent = "Antwort hinzufügen";
    addAnswerBtn.addEventListener("click", () => {
      q.answers.push({ id: `ans_${q.id}_${Date.now()}`, text: "", isCorrect: false });
      state.dirty = true;
      renderAll();
    });

    card.appendChild(ansWrap);
    card.appendChild(addAnswerBtn);

    if ((q.imageFiles || []).length && state.zip) {
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

    list.appendChild(card);
  }
}

export async function renderAll() {
  await renderMain();
}
