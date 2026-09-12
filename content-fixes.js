(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const FIXES_KEY = "panoptoCourseFilterFixesV2";
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
    if (!match) return null;
    return `${match[1].toUpperCase()}-${match[2]}${match[3] ? `-${match[3].toUpperCase()}` : ""}`;
  }

  function getRowEntry(row) {
    const label = row.querySelector(".pcf-course");
    if (!label) return null;
    const full = parseEntries(label.innerText || label.textContent)[0];
    if (full) return full;
    const course = parseCourseCode(label.innerText || label.textContent);
    if (!course) return null;
    const group = row.closest(".pcf-semester-courses");
    const header = group && group.previousElementSibling;
    const semesterMatch = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i.exec(normalize(header && header.innerText));
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
        if (!tooLarge && !looksLikePlayer && rect.width > 150 && rect.height > 100 && rect.height < 900 && text.length >= 15 && text.length < 1600 && childLinks <= 5) {
          if (parseEntries(text).length) { cards.add(parent); break; }
        }
        parent = parent.parentElement;
      }
    });
    return [...cards];
  }

  function cardEntries(card) { return parseEntries(normalize(card.innerText || card.textContent)); }
  function cardShouldHide(card) { return state.ignored.length > 0 && cardEntries(card).some(entry => state.ignored.includes(entry.key)); }

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
      if (isViewerPage() || state.mode !== "ignore") { clearFilterClasses(); return; }
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
    } finally { applying = false; }
  }

  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyIgnoreFilter, 250);
  }

  async function load() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, FIXES_KEY]);
      const oldState = result[STORAGE_KEY] || {};
      const saved = result[FIXES_KEY] || {};
      state.mode = saved.mode === "selected" ? "selected" : "ignore";
      state.ignored = Array.isArray(saved.ignored) ? saved.ignored : [];
      if (state.mode === "ignore" && Array.isArray(oldState.selected) && oldState.selected.length) {
        await chrome.storage.local.set({ [STORAGE_KEY]: { ...oldState, selected: [] } });
      }
    } catch (error) { console.warn("Panopto Course Filter: fixes could not load state.", error); }
  }

  async function save() {
    try { await chrome.storage.local.set({ [FIXES_KEY]: { mode: state.mode, ignored: state.ignored } }); }
    catch (error) { console.warn("Panopto Course Filter: fixes could not save state.", error); }
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Restore this course" : "Ignore this course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
    button.classList.toggle("is-disabled", state.mode === "selected");
  }

  function addIgnoreButtons() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;
    panel.querySelectorAll(".pcf-course-row").forEach(row => {
      let button = row.querySelector(".pcf-ignore-fix");
      const entry = getRowEntry(row);
      if (!entry) return;
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "pcf-ignore-fix";
        button.addEventListener("click", async event => {
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
          const key = button.dataset.courseKey;
          const index = state.ignored.indexOf(key);
          if (index >= 0) state.ignored.splice(index, 1); else state.ignored.push(key);
          await save(); updateIgnoreButton(button); scheduleFilter();
        });
        const rename = row.querySelector(".pcf-rename");
        if (rename) row.insertBefore(button, rename); else row.appendChild(button);
      }
      button.dataset.courseKey = entry.key;
      updateIgnoreButton(button);
    });
  }

  function updateModeUI() {
    const toolbar = document.querySelector("#pcf-fixes-toolbar");
    if (!toolbar) return;
    toolbar.querySelectorAll("button[data-fix-mode]").forEach(button => {
      const active = button.dataset.fixMode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".pcf-ignore-fix").forEach(updateIgnoreButton);
  }

  function ensureFilteringToolbar() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel || panel.querySelector("#pcf-fixes-toolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.id = "pcf-fixes-toolbar";
    toolbar.innerHTML = `
      <div class="pcf-fixes-heading"><div><div class="pcf-fixes-title">Filtering mode</div><div class="pcf-fixes-help">Choose how recordings are filtered.</div></div></div>
      <div class="pcf-fixes-modes">
        <button type="button" data-fix-mode="ignore"><span class="pcf-mode-icon">🚫</span><span><strong>Hide ignored</strong><small>Show everything except courses you block</small></span></button>
        <button type="button" data-fix-mode="selected"><span class="pcf-mode-icon">✓</span><span><strong>Show selected</strong><small>Only show courses you check</small></span></button>
      </div>
      <div class="pcf-fixes-tip">In Hide ignored mode, use the 🚫 button beside a course to hide or restore it.</div>`;
    const search = panel.querySelector("#pcf-search");
    panel.insertBefore(toolbar, search || panel.firstChild);
    toolbar.addEventListener("click", async event => {
      const button = event.target.closest("button[data-fix-mode]");
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";
      if (state.mode === "ignore") {
        try {
          const result = await chrome.storage.local.get(STORAGE_KEY);
          const oldState = result[STORAGE_KEY] || {};
          await chrome.storage.local.set({ [STORAGE_KEY]: { ...oldState, selected: [] } });
        } catch {}
      }
      await save(); updateModeUI(); scheduleFilter();
    });
  }

  function openSettings(open = true) {
    const modal = document.querySelector("#pcf-settings-modal");
    if (!modal) return;
    modal.classList.toggle("pcf-settings-open", open);
    modal.setAttribute("aria-hidden", String(!open));
    const gear = document.querySelector("#pcf-settings-button");
    if (gear) gear.setAttribute("aria-expanded", String(open));
  }

  function wrapSection(title, node) {
    const section = document.createElement("section");
    section.className = "pcf-settings-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.append(heading, node);
    return section;
  }

  function ensureSettingsMenu() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel || document.querySelector("#pcf-settings-modal")) return;

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

    const modal = document.createElement("div");
    modal.id = "pcf-settings-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="pcf-settings-backdrop" data-settings-close></div>
      <section class="pcf-settings-window" role="dialog" aria-modal="true" aria-label="Panopto Course Filter settings">
        <div class="pcf-settings-header"><div><strong>Panopto Course Filter</strong><span>Settings & controls</span></div><button type="button" class="pcf-settings-close" data-settings-close aria-label="Close settings">×</button></div>
        <div class="pcf-settings-body" id="pcf-settings-body"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-settings-close]").forEach(el => el.addEventListener("click", () => openSettings(false)));

    const body = modal.querySelector("#pcf-settings-body");
    const toolbar = panel.querySelector("#pcf-fixes-toolbar");
    const search = panel.querySelector("#pcf-search");
    if (toolbar) body.appendChild(toolbar);
    if (search) body.appendChild(wrapSection("Search courses", search));
    const global = panel.querySelector(".pcf-global-buttons"); if (global) body.appendChild(wrapSection("Selection", global));
    const semesters = panel.querySelector(".pcf-semester-actions"); if (semesters) body.appendChild(wrapSection("Semester organization", semesters));
    const current = panel.querySelector(".pcf-current-box"); if (current) body.appendChild(wrapSection("Current classes", current));
    const currentSemester = panel.querySelector(".pcf-buttons"); if (currentSemester) body.appendChild(wrapSection("Quick selection", currentSemester));
    const toggles = [...panel.querySelectorAll(".pcf-toggle")];
    if (toggles[0]) body.appendChild(wrapSection("Filtering", toggles[0]));
    if (toggles[1]) body.appendChild(wrapSection("Semester visibility", toggles[1]));
    const actions = panel.querySelector(".pcf-video-actions"); if (actions) body.appendChild(wrapSection("Maintenance", actions));
  }

  function start() {
    load().then(() => {
      const tick = () => {
        ensureFilteringToolbar();
        ensureSettingsMenu();
        addIgnoreButtons();
        updateModeUI();
        scheduleFilter();
      };
      tick();
      observer = new MutationObserver(mutations => {
        if (applying) return;
        if (mutations.some(m => m.type === "childList")) {
          clearTimeout(uiTimer);
          uiTimer = setTimeout(tick, 250);
        }
      });
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      setInterval(() => { addIgnoreButtons(); updateModeUI(); }, 1200);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
