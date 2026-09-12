(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const FIXES_KEY = "panoptoCourseFilterFixesV2";
  const OLD_FIXES_KEY = "panoptoCourseFilterFixesV1";
  const state = { mode: "ignore", ignored: [] };
  let filterTimer = null;
  let uiTimer = null;
  let observer = null;
  let applying = false;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const FORWARD_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const REVERSE_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\)/gi;
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/i;

  function parseEntries(text) {
    const results = [];
    text = normalize(text);
    let match;
    FORWARD_RE.lastIndex = 0;
    while ((match = FORWARD_RE.exec(text))) {
      const term = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      const course = `${match[3].toUpperCase()}-${match[4]}${match[5] ? `-${match[5].toUpperCase()}` : ""}`;
      results.push({ key: `${term} ${match[2]}|${course}`, term, year: match[2], course });
    }
    REVERSE_RE.lastIndex = 0;
    while ((match = REVERSE_RE.exec(text))) {
      const term = match[4][0].toUpperCase() + match[4].slice(1).toLowerCase();
      const course = `${match[1].toUpperCase()}-${match[2]}${match[3] ? `-${match[3].toUpperCase()}` : ""}`;
      results.push({ key: `${term} ${match[5]}|${course}`, term, year: match[5], course });
    }
    return results;
  }

  function parseCourseCode(text) {
    const match = COURSE_RE.exec(normalize(text));
    return match ? `${match[1].toUpperCase()}-${match[2]}${match[3] ? `-${match[3].toUpperCase()}` : ""}` : null;
  }

  function getRowEntry(row) {
    const label = row.querySelector(".pcf-course");
    if (!label) return null;
    const course = parseCourseCode(label.innerText || label.textContent || "");
    if (!course) return null;
    const group = row.closest(".pcf-semester-courses");
    const header = group ? group.previousElementSibling : null;
    const semesterMatch = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i.exec(normalize(header && (header.innerText || header.textContent)));
    if (!semesterMatch) return null;
    const term = semesterMatch[1][0].toUpperCase() + semesterMatch[1].slice(1).toLowerCase();
    const year = semesterMatch[2];
    return { key: `${term} ${year}|${course}`, term, year, course };
  }

  function isViewerPage() {
    return /\/pages\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname) || /\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname);
  }

  function isPanelElement(element) {
    return Boolean(element && element.closest && element.closest("#pcf-panel"));
  }

  function getRecordingCards() {
    if (isViewerPage()) return [];
    const cards = new Set();
    document.querySelectorAll("a[href]").forEach(link => {
      if (isPanelElement(link)) return;
      const href = link.getAttribute("href") || "";
      if (!/viewer|session/i.test(href)) return;
      let parent = link;
      for (let i = 0; i < 7 && parent; i++) {
        if (isPanelElement(parent)) break;
        if (parent.matches && parent.matches("body, main, [role='main']")) break;
        const rect = parent.getBoundingClientRect();
        const text = normalize(parent.innerText || parent.textContent);
        const childLinks = parent.querySelectorAll("a[href]").length;
        const tooLarge = rect.width > Math.max(900, window.innerWidth * .9) || rect.height > Math.max(850, window.innerHeight * .9);
        const looksLikePlayer = Boolean(parent.querySelector("video, audio, iframe, .video-js, [class*='player' i]"));
        if (!tooLarge && !looksLikePlayer && rect.width > 150 && rect.height > 100 && rect.height < 900 && text.length >= 15 && text.length < 1600 && childLinks <= 5 && parseEntries(text).length) {
          cards.add(parent);
          break;
        }
        parent = parent.parentElement;
      }
    });
    return [...cards];
  }

  function cardShouldHide(card) {
    if (!state.ignored.length) return false;
    return parseEntries(normalize(card.innerText || card.textContent)).some(entry => state.ignored.includes(entry.key));
  }

  function clearFilterClasses() {
    document.querySelectorAll(".pcf-fix-filtered-out, .pcf-filtered-out").forEach(card => {
      card.classList.remove("pcf-fix-filtered-out", "pcf-filtered-out");
      ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
    });
  }

  function applyIgnoreFilter() {
    if (applying) return;
    applying = true;
    try {
      if (isViewerPage() || state.mode !== "ignore") {
        clearFilterClasses();
        return;
      }
      getRecordingCards().forEach(card => {
        const hide = cardShouldHide(card);
        const hidden = card.classList.contains("pcf-fix-filtered-out");
        if (hide && !hidden) {
          card.classList.add("pcf-fix-filtered-out");
          card.style.display = "none";
          card.style.visibility = "hidden";
          card.style.opacity = "0";
          card.style.pointerEvents = "none";
        } else if (!hide && hidden) {
          card.classList.remove("pcf-fix-filtered-out");
          ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
        }
      });
    } finally {
      applying = false;
    }
  }

  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyIgnoreFilter, 150);
  }

  async function load() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, FIXES_KEY, OLD_FIXES_KEY]);
      const oldState = result[STORAGE_KEY] || {};
      const saved = result[FIXES_KEY] || {};
      const oldSaved = result[OLD_FIXES_KEY] || {};
      state.mode = saved.mode === "selected" ? "selected" : "ignore";
      state.ignored = Array.isArray(saved.ignored) ? saved.ignored : (Array.isArray(oldSaved.ignored) ? oldSaved.ignored : []);
      if (state.mode === "ignore" && Array.isArray(oldState.selected) && oldState.selected.length) {
        await chrome.storage.local.set({ [STORAGE_KEY]: { ...oldState, selected: [] } });
      }
    } catch (error) {
      console.warn("Panopto Course Filter: fixes could not load state.", error);
    }
  }

  async function save() {
    try {
      await chrome.storage.local.set({ [FIXES_KEY]: { mode: state.mode, ignored: state.ignored } });
    } catch (error) {
      console.warn("Panopto Course Filter: fixes could not save state.", error);
    }
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Restore this course" : "Ignore this course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
    button.classList.toggle("is-disabled", state.mode === "selected");
  }

  async function toggleIgnored(key) {
    if (!key || state.mode !== "ignore") return;
    const index = state.ignored.indexOf(key);
    if (index >= 0) state.ignored.splice(index, 1);
    else state.ignored.push(key);
    await save();
    document.querySelectorAll(".pcf-ignore-fix").forEach(button => {
      if (button.dataset.courseKey === key) updateIgnoreButton(button);
    });
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
          event.stopPropagation();
          void toggleIgnored(button.dataset.courseKey);
        });
        const rename = row.querySelector(".pcf-rename");
        if (rename) row.insertBefore(button, rename); else row.appendChild(button);
      }
      button.dataset.courseKey = entry.key;
      updateIgnoreButton(button);
    });
  }

  function createModeToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = "pcf-fixes-toolbar";
    toolbar.innerHTML = `<div class="pcf-fixes-heading"><div class="pcf-fixes-title">Filtering mode</div><div class="pcf-fixes-help">Choose how recordings are filtered.</div></div><div class="pcf-fixes-modes"><button type="button" data-fix-mode="ignore"><span class="pcf-mode-icon">🚫</span><span><strong>Hide ignored</strong><small>Show everything except courses you block</small></span></button><button type="button" data-fix-mode="selected"><span class="pcf-mode-icon">✓</span><span><strong>Show selected</strong><small>Only show courses you check</small></span></button></div><div class="pcf-fixes-tip">Hide ignored is the default. Use 🚫 beside a course to hide or restore it.</div>`;
    toolbar.addEventListener("click", async event => {
      const button = event.target.closest("button[data-fix-mode]");
      if (!button) return;
      event.preventDefault();
      state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";
      if (state.mode === "ignore") {
        try {
          const result = await chrome.storage.local.get(STORAGE_KEY);
          const oldState = result[STORAGE_KEY] || {};
          await chrome.storage.local.set({ [STORAGE_KEY]: { ...oldState, selected: [] } });
        } catch {}
      }
      await save();
      updateModeUI();
      scheduleFilter();
    });
    return toolbar;
  }

  function updateModeUI() {
    const toolbar = document.querySelector("#pcf-fixes-toolbar");
    if (toolbar) toolbar.querySelectorAll("button[data-fix-mode]").forEach(button => {
      const active = button.dataset.fixMode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".pcf-ignore-fix").forEach(updateIgnoreButton);
    document.querySelectorAll("#pcf-panel .pcf-course-row input[type='checkbox']").forEach(checkbox => {
      checkbox.disabled = state.mode === "ignore";
      checkbox.title = state.mode === "ignore" ? "Switch to Show selected mode to select courses" : "Select this course";
    });
  }

  function setupQuickControls() {
    const panel = document.querySelector("#pcf-panel");
    const list = panel && panel.querySelector("#pcf-course-list");
    if (!panel || !list || panel.querySelector("#pcf-quick-controls-toggle")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "pcf-quick-controls-toggle";
    toggle.innerHTML = "<span>☰</span><strong>Quick controls</strong><small>Search, selection, semesters & filtering</small><b>⌄</b>";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("pcf-quick-controls-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.querySelector("b").textContent = open ? "⌃" : "⌄";
    });
    panel.insertBefore(toggle, list);
    panel.classList.add("pcf-quick-controls-collapsed");
  }

  function openSettings(open = true) {
    const modal = document.querySelector("#pcf-settings-modal");
    if (!modal) return;
    modal.classList.toggle("pcf-settings-open", open);
    modal.setAttribute("aria-hidden", String(!open));
    const gear = document.querySelector("#pcf-settings-button");
    if (gear) gear.setAttribute("aria-expanded", String(open));
  }

  function ensureSettingsMenu() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;
    if (!document.querySelector("#pcf-settings-button")) {
      const header = panel.querySelector(".pcf-header");
      if (header) {
        const close = header.querySelector("#pcf-close");
        const gear = document.createElement("button");
        gear.type = "button";
        gear.id = "pcf-settings-button";
        gear.textContent = "⚙";
        gear.title = "Extension settings";
        gear.setAttribute("aria-label", "Extension settings");
        gear.setAttribute("aria-expanded", "false");
        if (close) header.insertBefore(gear, close); else header.appendChild(gear);
        gear.addEventListener("click", () => openSettings(true));
      }
    }
    if (document.querySelector("#pcf-settings-modal")) return;
    const modal = document.createElement("div");
    modal.id = "pcf-settings-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `<div class="pcf-settings-backdrop" data-settings-close></div><section class="pcf-settings-window" role="dialog" aria-modal="true" aria-label="Panopto Course Filter settings"><div class="pcf-settings-header"><div><strong>Panopto Course Filter</strong><span>Settings & advanced controls</span></div><button type="button" class="pcf-settings-close" data-settings-close aria-label="Close settings">×</button></div><div class="pcf-settings-body" id="pcf-settings-body"></div></section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-settings-close]").forEach(el => el.addEventListener("click", () => openSettings(false)));
    const body = modal.querySelector("#pcf-settings-body");
    const section = document.createElement("section");
    section.className = "pcf-settings-section";
    const heading = document.createElement("h3");
    heading.textContent = "Filtering mode";
    section.append(heading, createModeToolbar());
    body.appendChild(section);
    const note = document.createElement("div");
    note.className = "pcf-settings-note";
    note.innerHTML = "<strong>Quick controls:</strong> The main panel can stay focused on your class list. Open Quick controls only when you need search, selection, semester organization, or filtering.";
    body.appendChild(note);
  }

  function tick() {
    ensureSettingsMenu();
    setupQuickControls();
    addIgnoreButtons();
    updateModeUI();
    scheduleFilter();
  }

  function start() {
    load().then(() => {
      tick();
      observer = new MutationObserver(mutations => {
        if (applying) return;
        if (mutations.some(m => m.type === "childList")) {
          clearTimeout(uiTimer);
          uiTimer = setTimeout(tick, 50);
        }
      });
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
