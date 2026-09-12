(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterFixesV5";
  const LEGACY_KEYS = ["panoptoCourseFilterFixesV4", "panoptoCourseFilterFixesV3", "panoptoCourseFilterFixesV2", "panoptoCourseFilterFixesV1"];
  const state = { mode: "ignore", ignored: [] };
  let filterTimer = null;
  let observer = null;
  let ticking = false;
  let quickOpen = false;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  function parseCourseCodes(text) {
    const out = [];
    COURSE_RE.lastIndex = 0;
    let m;
    while ((m = COURSE_RE.exec(normalize(text)))) {
      out.push(`${m[1].toUpperCase()}-${m[2]}${m[3] ? `-${m[3].toUpperCase()}` : ""}`);
    }
    return [...new Set(out)];
  }

  function baseCourse(code) {
    return String(code || "").split("-").slice(0, 2).join("-").toUpperCase();
  }

  function parseSemester(text) {
    const m = SEMESTER_RE.exec(normalize(text));
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : null;
  }

  function getRowEntry(row) {
    const label = row.querySelector(".pcf-course");
    if (!label) return null;
    const code = parseCourseCodes(label.innerText || label.textContent)[0];
    if (!code) return null;
    const group = row.closest(".pcf-semester-courses");
    const header = group ? group.previousElementSibling : null;
    const semester = parseSemester(header && (header.innerText || header.textContent));
    if (!semester) return null;
    return { key: `${semester}|${baseCourse(code)}`, course: baseCourse(code), semester };
  }

  function isViewerPage() {
    return /\/pages\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname) || /\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname);
  }

  function outsidePanel(el) {
    return Boolean(el && el.closest && !el.closest("#pcf-panel"));
  }

  function isTooLarge(el) {
    const r = el.getBoundingClientRect();
    return r.width > Math.max(1100, window.innerWidth * .9) || r.height > Math.max(850, window.innerHeight * .9);
  }

  function findRecordingCards() {
    if (isViewerPage()) return [];
    const cards = new Set();

    document.querySelectorAll("a[href]").forEach(link => {
      if (!outsidePanel(link)) return;
      const href = link.getAttribute("href") || "";
      const hrefLooksLikeRecording = /viewer|session|recording/i.test(href);

      let current = link;
      for (let depth = 0; depth < 12 && current && current !== document.body; depth++, current = current.parentElement) {
        if (!outsidePanel(current)) break;
        const text = normalize(current.innerText || current.textContent);
        const codes = parseCourseCodes(text);
        const r = current.getBoundingClientRect();
        const links = current.querySelectorAll("a[href]").length;
        const media = current.querySelector("video, audio, iframe");
        const className = String(current.className || "").toLowerCase();
        const classLooksLikeCard = /card|session|recording|result|tile|item/.test(className);

        const suitable = !media && !isTooLarge(current) && r.width > 150 && r.height > 70 && r.height < 750 && text.length >= 12 && text.length < 1400 && links <= 5 && codes.length > 0;
        if (suitable && (hrefLooksLikeRecording || classLooksLikeCard || depth >= 1)) {
          cards.add(current);
          break;
        }
      }
    });

    return [...cards];
  }

  function ignoredKeyMatches(key, cardText) {
    const [semester, ignoredCourse] = String(key).split("|");
    if (!semester || !ignoredCourse) return false;
    const courses = parseCourseCodes(cardText).map(baseCourse);
    if (!courses.includes(baseCourse(ignoredCourse))) return false;
    const cardSemester = parseSemester(cardText);
    return !cardSemester || cardSemester === semester;
  }

  function cardIsIgnored(card) {
    const text = normalize(card.innerText || card.textContent);
    return state.ignored.some(key => ignoredKeyMatches(key, text));
  }

  function clearIgnoredCards() {
    document.querySelectorAll(".pcf-fix-ignored").forEach(card => {
      card.classList.remove("pcf-fix-ignored");
      ["display", "visibility", "opacity", "pointer-events"].forEach(p => card.style.removeProperty(p));
    });
  }

  function applyIgnoreFilter() {
    if (isViewerPage() || state.mode !== "ignore" || state.ignored.length === 0) {
      clearIgnoredCards();
      return;
    }

    findRecordingCards().forEach(card => {
      if (cardIsIgnored(card)) {
        card.classList.add("pcf-fix-ignored");
        card.style.setProperty("display", "none", "important");
        card.style.setProperty("visibility", "hidden", "important");
        card.style.setProperty("opacity", "0", "important");
        card.style.setProperty("pointer-events", "none", "important");
      } else if (card.classList.contains("pcf-fix-ignored")) {
        card.classList.remove("pcf-fix-ignored");
        ["display", "visibility", "opacity", "pointer-events"].forEach(p => card.style.removeProperty(p));
      }
    });
  }

  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyIgnoreFilter, 100);
  }

  async function loadState() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS]);
      const saved = result[STORAGE_KEY] || result.panoptoCourseFilterFixesV4 || result.panoptoCourseFilterFixesV3 || result.panoptoCourseFilterFixesV2 || result.panoptoCourseFilterFixesV1 || {};
      state.mode = saved.mode === "selected" ? "selected" : "ignore";
      state.ignored = Array.isArray(saved.ignored) ? [...new Set(saved.ignored.map(String))] : [];
      state.ignored = state.ignored.map(key => {
        const i = key.indexOf("|");
        return i < 0 ? key : `${key.slice(0, i)}|${baseCourse(key.slice(i + 1))}`;
      });
    } catch (e) {
      console.warn("Panopto Course Filter: ignore settings could not be loaded.", e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: { mode: state.mode, ignored: [...new Set(state.ignored)] } });
    } catch (e) {
      console.warn("Panopto Course Filter: ignore settings could not be saved.", e);
    }
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Restore this course" : "Ignore this course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
  }

  async function toggleIgnored(button) {
    const key = button && button.dataset.courseKey;
    if (!key) return;
    const i = state.ignored.indexOf(key);
    if (i >= 0) state.ignored.splice(i, 1);
    else state.ignored.push(key);
    state.mode = "ignore";
    updateModeUI();
    await saveState();
    scheduleFilter();
  }

  function addIgnoreButtons() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;
    panel.querySelectorAll(".pcf-course-row").forEach(row => {
      const entry = getRowEntry(row);
      if (!entry) return;
      let button = row.querySelector(".pcf-ignore-fix");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "pcf-ignore-fix";
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          void toggleIgnored(button);
        }, true);
        const rename = row.querySelector(".pcf-rename");
        if (rename) row.insertBefore(button, rename);
        else row.appendChild(button);
      }
      button.dataset.courseKey = entry.key;
      updateIgnoreButton(button);
    });
  }

  function moveAllQuickControls(panel, controls) {
    const ids = ["pcf-search", "pcf-global-buttons", "pcf-semester-actions", "pcf-current-box", "pcf-buttons", "pcf-toggle", "pcf-video-actions"];
    ids.forEach(id => {
      const el = panel.querySelector(`#${id}`);
      if (el && el !== controls && !controls.contains(el)) controls.appendChild(el);
    });
  }

  function setupQuickControls() {
    const panel = document.querySelector("#pcf-panel");
    const list = panel && panel.querySelector("#pcf-course-list");
    if (!panel || !list) return;

    let controls = panel.querySelector("#pcf-quick-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.id = "pcf-quick-controls";
      panel.insertBefore(controls, list);
    }

    moveAllQuickControls(panel, controls);

    let toggle = panel.querySelector("#pcf-quick-controls-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = "pcf-quick-controls-toggle";
      toggle.innerHTML = "<span>☰</span><strong>Quick controls</strong><small>Search, selection, semesters & filtering</small><b>⌄</b>";
      toggle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        quickOpen = !quickOpen;
        panel.classList.toggle("pcf-quick-controls-open", quickOpen);
        panel.classList.toggle("pcf-quick-controls-collapsed", !quickOpen);
        toggle.setAttribute("aria-expanded", String(quickOpen));
        toggle.querySelector("b").textContent = quickOpen ? "⌃" : "⌄";
      });
      panel.insertBefore(toggle, controls);
    }

    panel.classList.toggle("pcf-quick-controls-open", quickOpen);
    panel.classList.toggle("pcf-quick-controls-collapsed", !quickOpen);
    toggle.setAttribute("aria-expanded", String(quickOpen));
    toggle.querySelector("b").textContent = quickOpen ? "⌃" : "⌄";
  }

  function updateModeUI() {
    document.querySelectorAll(".pcf-ignore-fix").forEach(updateIgnoreButton);
    document.querySelectorAll("#pcf-fixes-toolbar button[data-fix-mode]").forEach(button => {
      const active = button.dataset.fixMode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function createSettings() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;
    const header = panel.querySelector(".pcf-header");
    if (header && !header.querySelector("#pcf-settings-button")) {
      const gear = document.createElement("button");
      gear.type = "button";
      gear.id = "pcf-settings-button";
      gear.textContent = "⚙";
      gear.title = "Extension settings";
      gear.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); document.querySelector("#pcf-settings-modal")?.classList.add("pcf-settings-open"); });
      const close = header.querySelector("#pcf-close");
      if (close) header.insertBefore(gear, close); else header.appendChild(gear);
    }

    if (document.querySelector("#pcf-settings-modal")) return;
    const modal = document.createElement("div");
    modal.id = "pcf-settings-modal";
    modal.innerHTML = `<div class="pcf-settings-backdrop"></div><section class="pcf-settings-window"><div class="pcf-settings-header"><div><strong>Panopto Course Filter</strong><span>Settings & advanced controls</span></div><button type="button" class="pcf-settings-close">×</button></div><div class="pcf-settings-body"></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector(".pcf-settings-backdrop").addEventListener("click", () => modal.classList.remove("pcf-settings-open"));
    modal.querySelector(".pcf-settings-close").addEventListener("click", () => modal.classList.remove("pcf-settings-open"));

    const body = modal.querySelector(".pcf-settings-body");
    const section = document.createElement("section");
    section.className = "pcf-settings-section";
    section.innerHTML = `<h3>Filtering mode</h3><div id="pcf-fixes-toolbar"><div class="pcf-fixes-modes"><button type="button" data-fix-mode="ignore"><span>🚫</span><span><strong>Hide ignored</strong><small>Show everything except courses you block.</small></span></button><button type="button" data-fix-mode="selected"><span>✓</span><span><strong>Show selected</strong><small>Use the course checkboxes as the filter.</small></span></button></div></div>`;
    body.appendChild(section);

    section.addEventListener("click", async event => {
      const button = event.target.closest("button[data-fix-mode]");
      if (!button) return;
      event.preventDefault();
      state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";
      await saveState();
      updateModeUI();
      scheduleFilter();
    });
  }

  function tick() {
    if (ticking) return;
    ticking = true;
    try {
      createSettings();
      setupQuickControls();
      addIgnoreButtons();
      updateModeUI();
      scheduleFilter();
    } finally {
      ticking = false;
    }
  }

  async function init() {
    await loadState();
    tick();
    observer = new MutationObserver(() => {
      clearTimeout(window.__pcfFixTick);
      window.__pcfFixTick = setTimeout(tick, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("load", tick, { once: true });
    window.addEventListener("scroll", scheduleFilter, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else void init();
})();
