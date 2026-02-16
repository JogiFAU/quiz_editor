import { state } from "../state.js";
import { $, letter } from "../utils.js";
import { getImageUrl, registerLocalImage, removeLocalImage } from "../data/zipImages.js";
import { questionIdIndex } from "../quiz/filters.js";

function setHeader() {
  const subtitle = $("headerSubtitle");
  const progressText = $("headerProgressText");
  const rightStat = $("headerCorrectPct");
  const bar = $("headerProgressBar");

  if (!state.activeDataset) {
    subtitle.textContent = "Dateien laden und Bearbeitung konfigurieren";
    progressText.textContent = "—";
    rightStat.textContent = "—";
    bar.style.width = "0%";
    return;
  }

  const total = state.questionsAll.length;
  const shown = state.view === "search" ? state.searchOrder.length : 0;
  subtitle.textContent = `${state.activeDataset.label || state.activeDataset.id} · Editor`;
  progressText.textContent = `${shown}/${total}`;
  rightStat.textContent = state.dirty ? "Ungespeichert" : "Gespeichert";
  bar.style.width = total ? `${(shown / total) * 100}%` : "0%";
}


export function refreshHeaderStatus() {
  setHeader();
}

export function updateExamLists(selectedExams = []) {
  const exams = Array.from(new Set(state.questionsAll.map((q) => q.examName).filter(Boolean))).sort();
  renderExamList("examListSearch", exams, selectedExams);
}

export function updateTopicList(selectedTopics = []) {
  const el = $("topicListSearch");
  if (!el) return;
  el.innerHTML = "";

  const selected = new Set(selectedTopics || []);
  const grouped = new Map();

  for (const q of state.questionsAll) {
    const superTopic = String(q.superTopic || "").trim();
    const subTopic = String(q.subTopic || "").trim();
    if (!superTopic && !subTopic) continue;

    const superName = superTopic || "(Ohne Überthema)";
    if (!grouped.has(superName)) grouped.set(superName, new Set());
    if (subTopic) grouped.get(superName).add(subTopic);
  }

  const superTopics = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, "de"));

  for (const superTopic of superTopics) {
    const subTopics = Array.from(grouped.get(superTopic) || []).sort((a, b) => a.localeCompare(b, "de"));
    const superValue = `super::${superTopic}`;

    const superItem = document.createElement("label");
    superItem.className = "examitem selected topicitem topicitem--super";

    const superCb = document.createElement("input");
    superCb.type = "checkbox";
    superCb.dataset.topicType = "super";
    superCb.dataset.topicValue = superTopic;
    superCb.checked = selected.has(superValue);

    const superNameEl = document.createElement("div");
    superNameEl.className = "examname";
    superNameEl.textContent = superTopic;

    superItem.appendChild(superCb);
    superItem.appendChild(superNameEl);
    el.appendChild(superItem);

    for (const subTopic of subTopics) {
      const subItem = document.createElement("label");
      subItem.className = "examitem selected topicitem topicitem--sub";

      const subCb = document.createElement("input");
      subCb.type = "checkbox";
      subCb.dataset.topicType = "sub";
      subCb.dataset.topicValue = subTopic;
      subCb.dataset.parentTopic = superTopic;

      const subValue = `sub::${superTopic}::${subTopic}`;
      subCb.checked = selected.has(subValue);

      const subNameEl = document.createElement("div");
      subNameEl.className = "examname";
      subNameEl.textContent = subTopic;

      subItem.appendChild(subCb);
      subItem.appendChild(subNameEl);
      el.appendChild(subItem);
    }
  }
}

function renderExamList(containerId, exams, selectedExams = []) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = "";
  const selected = new Set(selectedExams || []);

  for (const exam of exams) {
    const item = document.createElement("label");
    item.className = "examitem selected";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.exam = exam;
    cb.checked = selected.has(exam);

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

function createImageEditor(question) {
  const wrap = document.createElement("div");
  wrap.className = "editorImageBlock";

  const heading = document.createElement("div");
  heading.className = "small";
  heading.textContent = "Bilder";
  wrap.appendChild(heading);

  const files = Array.isArray(question.imageFiles) ? question.imageFiles : [];
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "Keine Bildreferenz vorhanden.";
    wrap.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "imageRefList";

    files.forEach((fileBase, idx) => {
      const row = document.createElement("div");
      row.className = "imageRefRow";

      const name = document.createElement("code");
      name.textContent = fileBase;

      const del = document.createElement("button");
      del.className = "btn danger";
      del.type = "button";
      del.textContent = "Entfernen";
      del.addEventListener("click", () => {
        const removed = question.imageFiles.splice(idx, 1)[0];
        const stillUsed = state.questionsAll.some((q) => (q.imageFiles || []).includes(removed));
        if (!stillUsed) removeLocalImage(removed);
        state.dirty = true;
        renderAll();
      });

      row.appendChild(name);
      row.appendChild(del);
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.multiple = true;
  fileInput.hidden = true;

  fileInput.addEventListener("change", () => {
    const filesToAdd = Array.from(fileInput.files || []);
    if (!filesToAdd.length) return;

    if (!Array.isArray(question.imageFiles)) question.imageFiles = [];

    for (const file of filesToAdd) {
      const imageId = registerLocalImage(file);
      if (imageId && !question.imageFiles.includes(imageId)) {
        question.imageFiles.push(imageId);
      }
    }

    fileInput.value = "";
    state.dirty = true;
    renderAll();
  });

  const addImageBtn = document.createElement("button");
  addImageBtn.className = "btn";
  addImageBtn.type = "button";
  addImageBtn.textContent = "Bild hinzufügen";
  addImageBtn.addEventListener("click", () => fileInput.click());

  wrap.appendChild(addImageBtn);
  wrap.appendChild(fileInput);
  return wrap;
}

function updateTopicHints(question, overInput, underInput) {
  const catalog = state.topicCatalog;
  const over = catalog?.superTopics || [];

  const selectedOver = overInput?.value || question.superTopic || "";
  const under = selectedOver && catalog?.subTopicsBySuper?.[selectedOver]
    ? catalog.subTopicsBySuper[selectedOver]
    : catalog?.allSubTopics || [];
  return { over, under };
}

function normalizeTopicToken(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de");
}

function buildTopicCanonicalMap(values = []) {
  const map = new Map();
  values.forEach((value) => {
    const token = normalizeTopicToken(value);
    if (token && !map.has(token)) map.set(token, value);
  });
  return map;
}

function normalizeTopicValue(value, allowedValues = []) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const canonicalMap = buildTopicCanonicalMap(allowedValues);
  return canonicalMap.get(normalizeTopicToken(normalized)) || "";
}

function filterTopicOptions(options = [], typedValue = "") {
  const needle = normalizeTopicToken(typedValue);
  if (!needle) return options;
  return options.filter((opt) => normalizeTopicToken(opt).includes(needle));
}

function createTopicSuggestionList(input, wrap, getOptions, onPick) {
  const dropdown = document.createElement("div");
  dropdown.className = "editorTopicDropdown";
  dropdown.hidden = true;
  wrap.appendChild(dropdown);

  const hide = () => {
    dropdown.classList.remove("is-open");
    dropdown.hidden = true;
  };

  const show = () => {
    const options = getOptions(input.value).slice(0, 20);
    dropdown.innerHTML = "";
    if (!options.length) {
      hide();
      return;
    }

    options.forEach((optionText) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "editorTopicDropdown__item";
      item.textContent = optionText;
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onPick(optionText);
        hide();
      });
      dropdown.appendChild(item);
    });

    dropdown.hidden = false;
    dropdown.classList.add("is-open");
  };

  return { show, hide };
}

function bindTopicAutocomplete(question, superTopicInput, superTopicWrap, subTopicInput, subTopicWrap) {
  const pickedFromDropdown = new WeakSet();
  let activeInput = null;

  const refreshSuper = () => {
    const { over } = updateTopicHints(question, superTopicInput, subTopicInput);
    return filterTopicOptions(over, superTopicInput.value);
  };

  const refreshSub = () => {
    const { under } = updateTopicHints(question, superTopicInput, subTopicInput);
    return filterTopicOptions(under, subTopicInput.value);
  };

  const setInvalidState = (input, invalid) => {
    input.classList.toggle("editorInputInvalid", !!invalid);
  };

  const validateTopics = () => {
    if (!state.topicCatalog) return;
    const { over, under } = updateTopicHints(question, superTopicInput, subTopicInput);
    if (!over.length) return;

    let hasInvalid = false;
    const normalizedSuper = normalizeTopicValue(superTopicInput.value, over);
    const superRaw = String(superTopicInput.value || "").trim();
    if (superRaw && !normalizedSuper) {
      hasInvalid = true;
      setInvalidState(superTopicInput, true);
    } else {
      setInvalidState(superTopicInput, false);
    }

    if (normalizedSuper && normalizedSuper !== superTopicInput.value) {
      superTopicInput.value = normalizedSuper;
      superTopicInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const relevantUnder = normalizedSuper && state.topicCatalog?.subTopicsBySuper?.[normalizedSuper]
      ? state.topicCatalog.subTopicsBySuper[normalizedSuper]
      : under;
    const normalizedSub = normalizeTopicValue(subTopicInput.value, relevantUnder);
    const subRaw = String(subTopicInput.value || "").trim();
    if (subRaw && !normalizedSub) {
      hasInvalid = true;
      setInvalidState(subTopicInput, true);
    } else {
      setInvalidState(subTopicInput, false);
    }

    if (normalizedSub && normalizedSub !== subTopicInput.value) {
      subTopicInput.value = normalizedSub;
      subTopicInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    return !hasInvalid;
  };

  superTopicInput.addEventListener("focus", () => {
    activeInput = superTopicInput;
    superSuggestions.show();
    subSuggestions.hide();
  });

  subTopicInput.addEventListener("focus", () => {
    activeInput = subTopicInput;
    subSuggestions.show();
    superSuggestions.hide();
  });

  superTopicInput.addEventListener("input", () => {
    if (pickedFromDropdown.has(superTopicInput)) {
      pickedFromDropdown.delete(superTopicInput);
      superSuggestions.hide();
      subSuggestions.hide();
      superTopicInput.blur();
      return;
    }
    activeInput = superTopicInput;
    setInvalidState(superTopicInput, false);
    superSuggestions.show();
    subSuggestions.hide();
  });

  subTopicInput.addEventListener("input", () => {
    if (pickedFromDropdown.has(subTopicInput)) {
      pickedFromDropdown.delete(subTopicInput);
      superSuggestions.hide();
      subSuggestions.hide();
      subTopicInput.blur();
      return;
    }
    activeInput = subTopicInput;
    setInvalidState(subTopicInput, false);
    subSuggestions.show();
    superSuggestions.hide();
  });

  superTopicInput.addEventListener("blur", () => {
    validateTopics();
    activeInput = null;
    window.setTimeout(() => {
      if (activeInput) return;
      superSuggestions.hide();
      subSuggestions.hide();
    }, 120);
  });

  subTopicInput.addEventListener("blur", () => {
    validateTopics();
    activeInput = null;
    window.setTimeout(() => {
      if (activeInput) return;
      superSuggestions.hide();
      subSuggestions.hide();
    }, 120);
  });

  const applyAndDispatch = (input, value) => {
    pickedFromDropdown.add(input);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const superSuggestions = createTopicSuggestionList(
    superTopicInput,
    superTopicWrap,
    () => refreshSuper(),
    (value) => applyAndDispatch(superTopicInput, value),
  );

  const subSuggestions = createTopicSuggestionList(
    subTopicInput,
    subTopicWrap,
    () => refreshSub(),
    (value) => applyAndDispatch(subTopicInput, value),
  );
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

    const formatConfidence = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
    const topicConf = formatConfidence(q.topicConfidence);
    const answerConf = formatConfidence(q.answerConfidence);

    h.innerHTML = `<div class="qhead__id"><strong>ID:</strong> ${q.id}</div>`;
    card.appendChild(h);

    const reviewWrap = document.createElement("label");
    reviewWrap.className = "checkrow editorField";
    const reviewToggle = document.createElement("input");
    reviewToggle.type = "checkbox";
    reviewToggle.checked = !!q.needsReview;
    reviewToggle.addEventListener("change", () => {
      q.needsReview = reviewToggle.checked;
      state.dirty = true;
    });
    const reviewLabel = document.createElement("span");
    reviewLabel.textContent = "Wartungsbedürftig";
    reviewWrap.appendChild(reviewToggle);
    reviewWrap.appendChild(reviewLabel);
    card.appendChild(reviewWrap);

    const addField = (label, value, onChange, type = "text") => {
      const wrap = document.createElement("label");
      wrap.className = "editorField";
      const ttl = document.createElement("div");
      ttl.className = "small";
      ttl.textContent = label;

      const inp = document.createElement(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") inp.type = "text";
      inp.value = value || "";
      inp.addEventListener("input", () => {
        onChange(inp.value, inp);
        state.dirty = true;
      });

      wrap.appendChild(ttl);
      wrap.appendChild(inp);
      card.appendChild(wrap);
      return { wrap, input: inp };
    };

    const addSectionTitle = (title) => {
      const sectionTitle = document.createElement("div");
      sectionTitle.className = "editorSectionTitle";
      sectionTitle.textContent = title;
      card.appendChild(sectionTitle);
    };

    addSectionTitle("Metadaten");
    addField("Klausur", q.examName, (v) => q.examName = v);

    const superTopicField = addField("Überthema", q.superTopic, (v) => {
      q.superTopic = v;
      q.topic = [q.superTopic, q.subTopic].filter(Boolean).join(" > ");
      updateTopicHints(q, superTopicInput, subTopicInput);
    }, "text");
    const superTopicInput = superTopicField.input;

    const subTopicField = addField("Unterthema", q.subTopic, (v) => {
      q.subTopic = v;
      q.topic = [q.superTopic, q.subTopic].filter(Boolean).join(" > ");
    }, "text");
    const subTopicInput = subTopicField.input;

    bindTopicAutocomplete(q, superTopicInput, superTopicField.wrap, subTopicInput, subTopicField.wrap);

    const topicConfInfo = document.createElement("div");
    topicConfInfo.className = "small editorField";
    topicConfInfo.innerHTML = `<strong>Topic-Conf:</strong> ${topicConf} <strong>(${q.topicSource || "n/a"})</strong>`;
    card.appendChild(topicConfInfo);

    const topicReason = document.createElement("div");
    topicReason.className = "small editorField";
    topicReason.innerHTML = `<strong>AI-Begründung Topic:</strong> ${q.topicReason || "—"}`;
    card.appendChild(topicReason);

    addSectionTitle("Frageninhalt");
    addField("Frage", q.text, (v) => q.text = v, "textarea");
    addField("Erklärung", q.explanation, (v) => q.explanation = v, "textarea");

    addSectionTitle("Antwortmöglichkeiten");
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

    const answerConfInfo = document.createElement("div");
    answerConfInfo.className = "small editorField";
    answerConfInfo.innerHTML = `<strong>Antwort-Conf:</strong> ${answerConf} <strong>(${q.answerSource || "n/a"})</strong>`;
    card.appendChild(answerConfInfo);

    const answerReason = document.createElement("div");
    answerReason.className = "small editorField";
    answerReason.innerHTML = `<strong>AI-Begründung Antwort:</strong> ${q.answerReason || "—"}`;
    card.appendChild(answerReason);

    card.appendChild(addAnswerBtn);
    card.appendChild(createImageEditor(q));

    if ((q.imageFiles || []).length) {
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
