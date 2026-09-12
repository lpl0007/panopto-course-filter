(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const FIXES_KEY = "panoptoCourseFilterFixesV3";
  const state = { mode: "ignore", ignored: [] };

  let filterTimer = null;
  let observer = null;
  let panelEventsInstalled = false;
  let applying = false;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/i;
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  function parseCourseCode(text) {
    const match = COURSE_RE.exec(normalize(text));
    return match
      ? `${match[1].toUpperCase()}-${match[2]}${match[3] ? `-${match[3].toUpperCase()}` : ""}`
      : null;
  }

  function parseSemester(text) {
    const match = SEMESTER_RE.exec(normalize(text));
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : null;
  }

  function getRowEntry(row) {
    const label = row.querySelector(".pcf-course");
    if (!label) return null;

    const course = parseCourseCode(label.innerText || label.textContent || "");
    if (!course) return null;

    const group = row.closest(".pcf-semester-courses");
    const header = group ? group.previousElementSibling : null;
    const semester = parseSemester(header && (header.innerText || header.textContent));
    if (!semester) return null;

    return { key: `${semester}|${course}`, course, semester };
  }

  function isViewerPage() {
    return /\/pages\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname) || /\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname);
  }

  function isPanelElement(element) {
    return Boolean(element && element.closest && element.closest("#pcf-panel"));
  }

  function findRecordingCards() {
    if (isViewerPage()) return [];

    const cards = new Set();

    document.querySelectorAll("a[href]").forEach(link => {
      if (isPanelElement(link)) return;
      const href = link.getAttribute("href") || "";
      if (!/viewer|session/i.test(href)) return;

      let current = link;
      let best = null;

      for (let i = 0; i < 9 && current && current !== document.body; i++) {
        if (isPanelElement(current)) break;

        const rect = current.getBoundingClientRect();
        const text = normalize(current.innerText || current.textContent);
        const childLinks = current.querySelectorAll("a[href]").length;
        const hasMedia = current.querySelector("video, audio, iframe");
        const tooLarge = rect.width > Math.max(900, window.innerWidth * 0.92) || rect.height > Math.max(850, window.innerHeight * 0.92);

        if (!hasMedia && !tooLarge && rect.width > 180 && rect.height > 80 && rect.height < 900 && text.length >= 12 && text.length < 1800 && childLinks <= 6) {
          if (parseCourseCode(text)) best = current;
        }

        current = current.parentElement;
      }

      if (best) cards.add(best);
    });

    return [...cards];
  }

  function cardMatchesIgnoredCourse(card) {
    const text = normalize(card.innerText || card.textContent);
    const course = parseCourseCode(text);
    if (!course) return false;

    const semester = parseSemester(text);

    return state.ignored.some(key => {
      const separator = key.indexOf("|");
      if (separator < 0) return false;
      const ignoredSemester = key.slice(0, separator);
      const ignoredCourse = key.slice(separator + 1);
      if (ignoredCourse !== course) return false;
      return !semester || ignoredSemester === semester;
    });
  }

  function clearFilterClasses() {
    document.querySelectorAll(".pcf-fix-filtered-out").forEach(card => {
      card.classList.remove("pcf-fix-filtered-out");
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

      findRecordingCards().forEach(card => {
        const hide = cardMatchesIgnoredCourse(card);
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
    filterTimer = setTimeout(applyIgnoreFilter, 120);
  }

  async function load() {
    try {
      const result = await chrome.storage.local.get([FIXES_KEY, "panoptoCourseFilterFixesV2", "panoptoCourseFilterFixesV1"]);
      const saved = result[FIXES_KEY] || result.panoptoCourseFilterFixesV2 || result.panoptoCourseFilterFixesV1 || {};
      state.mode = saved.mode === "selected" ? "selected" : "ignore";
      state.ignored = Array.isArray(saved.ignored) ? [...new Set(saved.ignored)] : [];
    } catch (error) {
      console.warn("Panopto Course Filter: could not load ignore settings.", error);
    }
  }

  async function save() {
    try {
      await chrome.storage.local.set({ [FIXES_KEY]: { mode: state.mode, ignored: state.ignored } });
    } catch (error) {
      console.warn("Panopto Course Filter: could not save ignore settings.", error);
    }
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Restore this course" : "Ignore this course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
    button.classList.toggle("is-disabled", false);
  }

  async function toggleIgnored(key) {
    if (!key) return;

    if (state.mode !== "ignore") {
      state.mode = "ignore";
    }

    const index = state.ignored.indexOf(key);
    if (index >= 0) state.ignored.splice(index, 1);
    else state.ignored.push(key);

    await save();
    updateModeUI();
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
        button.dataset.courseKey = entry.key;
        button.textContent = "🚫";
        button.title = "Ignore this course";
        button.setAttribute("aria-label", "Ignore this course");
        const rename = row.querySelector(".pcf-rename");
        if (rename) row.insertBefore(button, rename);
        else row.appendChild(button);
      }

      button.dataset.courseKey = entry.key;
      updateIgnoreButton(button);
    });
  }

  function createModeToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = "pcf-fixes-toolbar";
    toolbar.innerHTML = `<div class="pcf-fixes-heading"><div class="pcf-fixes-title">Filtering mode</div><div class="pcf-fixes-help">Choose how recordings are filtered.</div></div><div class="pcf-fixes-modes"><button type="button" data-fix-mode="ignore"><span class="pcf-mode-icon">🚫</span><span><strong>Hide ignored</strong><small>Show everything except courses you block</small></span></button><button type="button" data-fix-mode="selected"><span class="pcf-mode-icon">✓</span><span><strong>Show selected</strong><small>Only show courses you check</small></span></button></div><div class="pcf-fixes-tip">Hide ignored is the default. 🚫 beside a course hides or restores it.</div>`;

    toolbar.addEventListener("click", async event => {
      const button = event.target.closest("button[data-fix-mode]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";
      await save();
      updateModeUI();
      scheduleFilter();
    });

    return toolbar;
  }

  function updateModeUI() {
    const toolbar = document.querySelector("#pcf-fixes-toolbar");
    if (toolbar) {
      toolbar.querySelectorAll("button[data-fix-mode]").forEach(button => {
        const active = button.dataset.fixMode === state.mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    document.querySelectorAll(".pcf-ignore-fix").forEach(updateIgnoreButton);
    document.querySelectorAll("#pcf-panel .pcf-course-row input[type='checkbox']").forEach(checkbox => {
      checkbox.disabled = false;
      checkbox.title = state.mode === "ignore" ? "Selection is inactive in Hide ignored mode" : "Select this course";
      checkbox.style.opacity = state.mode === "ignore" ? "0.45" : "1";
      checkbox.style.pointerEvents = state.mode === "ignore" ? "none" : "auto";
    });
  }

  function setupQuickControls() {
    const panel = document.querySelector("#pcf-panel");
    const list = panel && panel.querySelector("#pcf-course-list");
    if (!panel || !list || panel.querySelector("#pcf-quick-controls")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "pcf-quick-controls-toggle";
    toggle.innerHTML = "<span>☰</span><strong>Quick controls</strong><small>Search, selection, semesters & filtering</small><b>⌄</b>";
    toggle.setAttribute("aria-expanded", "false");

    const controls = document.createElement("div");
    controls.id = "pcf-quick-controls";
    controls.className = "pcf-quick-controls";

    [
      "pcf-search",
      "pcf-fixes-toolbar",
      "pcf-global-buttons",
      "pcf-semester-actions",
      "pcf-current-box",
      "pcf-buttons",
      "pcf-toggle",
      "pcf-video-actions"
    ].forEach(id => {
      const element = document.getElementById(id);
      if (element && element !== controls && !controls.contains(element)) controls.appendChild(element);
    });

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const open = panel.classList.toggle("pcf-quick-controls-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.querySelector("b").textContent = open ? "⌃" : "⌄";
    });

    panel.insertBefore(toggle, list);
    panel.insertBefore(controls, list);
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

    const header = panel.querySelector(".pcf-header");
    if (header && !document.querySelector("#pcf-settings-button")) {
      const close = header.querySelector("#pcf-close");
      const gear = document.createElement("button");
      gear.type = "button";
      gear.id = "pcf-settings-button";
      gear.textContent = "⚙";
      gear.title = "Extension settings";
      gear.setAttribute("aria-label", "Extension settings");
      gear.setAttribute("aria-expanded", "false");
      if (close) header.insertBefore(gear, close); else header.appendChild(gear);
      gear.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openSettings(true);
      });
    }

    if (document.querySelector("#pcf-settings-modal")) return;

    const modal = document.createElement("div");
    modal.id = "pcf-settings-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `<div class="pcf-settings-backdrop" data-settings-close></div><section class="pcf-settings-window" role="dialog" aria-modal="true" aria-label="Panopto Course Filter settings"><div class="pcf-settings-header"><div><strong>Panopto Course Filter</strong><span>Settings & advanced controls</span></div><button type="button" class="pcf-settings-close" data-settings-close aria-label="Close settings">×</button></div><div class="pcf-settings-body" id="pcf-settings-body"></div></section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-settings-close]").forEach(el => el.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openSettings(false);
    }));

    const body = modal.querySelector("#pcf-settings-body");
    const section = document.createElement("section");
    section.className = "pcf-settings-section";
    const heading = document.createElement("h3");
    heading.textContent = "Filtering mode";
    section.append(heading, createModeToolbar());
    body.appendChild(section);

    const note = document.createElement("div");
    note.className = "pcf-settings-note";
    note.innerHTML = "<strong>Quick controls:</strong> Use the collapsible section on the main panel whenever you need search, selection, semester organization, or filtering.";
    body.appendChild(note);
  }

  function installPanelEvents() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel || panelEventsInstalled) return;
    panelEventsInstalled = true;

    panel.addEventListener("click", event => {
      const button = event.target.closest(".pcf-ignore-fix");
      if (!button || !panel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      void toggleIgnored(button.dataset.courseKey);
    }, true);
  }

  function tick() {
    ensureSettingsMenu();
    setupQuickControls();
    installPanelEvents();
    addIgnoreButtons();
    updateModeUI();
    scheduleFilter();
  }

  function start() {
    load().then(tick);

    const bootTimer = setInterval(() => {
      if (document.querySelector("#pcf-panel")) {
        tick();
        clearInterval(bootTimer);
      }
    }, 250);

    observer = new MutationObserver(() => {
      clearTimeout(filterTimer);
      setTimeout(tick, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  start();
})();