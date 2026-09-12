(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterFixesV7";
  const LEGACY_KEYS = [
    "panoptoCourseFilterFixesV6",
    "panoptoCourseFilterFixesV5",
    "panoptoCourseFilterFixesV4",
    "panoptoCourseFilterFixesV3",
    "panoptoCourseFilterFixesV2",
    "panoptoCourseFilterFixesV1"
  ];
  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";

  const state = { mode: "ignore", ignored: [] };
  let filterTimer = null;
  let uiTimer = null;
  let quickOpen = false;
  let observer = null;
  let busy = false;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  function parseCourseCodes(text) {
    COURSE_RE.lastIndex = 0;
    const result = [];
    let match;
    while ((match = COURSE_RE.exec(normalize(text)))) {
      result.push(`${match[1].toUpperCase()}-${match[2]}${match[3] ? `-${match[3].toUpperCase()}` : ""}`);
    }
    return [...new Set(result)];
  }

  function baseCourse(code) {
    return String(code || "").split("-").slice(0, 2).join("-").toUpperCase();
  }

  function parseSemester(text) {
    const match = SEMESTER_RE.exec(normalize(text));
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : null;
  }

  function rowEntry(row) {
    const label = row.querySelector(".pcf-course");
    const code = label && parseCourseCodes(label.innerText || label.textContent)[0];
    if (!code) return null;

    const group = row.closest(".pcf-semester-courses");
    const header = group && group.previousElementSibling;
    const semester = parseSemester(header && (header.innerText || header.textContent));
    if (!semester) return null;

    return {
      key: `${semester}|${baseCourse(code)}`,
      course: baseCourse(code),
      semester
    };
  }

  function viewerPage() {
    return /\/pages\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname) || /\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname);
  }

  function recordingCards() {
    if (viewerPage()) return [];

    const cards = new Set();
    document.querySelectorAll("a[href]").forEach(link => {
      if (link.closest("#pcf-panel")) return;

      const href = link.getAttribute("href") || "";
      if (!/viewer|session|recording/i.test(href)) return;

      let current = link;
      for (let depth = 0; depth < 12 && current && current !== document.body; depth++, current = current.parentElement) {
        if (current.closest("#pcf-panel")) break;

        const rect = current.getBoundingClientRect();
        const text = normalize(current.innerText || current.textContent);
        const links = current.querySelectorAll("a[href]").length;
        const media = current.querySelector("video, audio, iframe");
        const className = String(current.className || "").toLowerCase();
        const looksLikeCard = /card|session|recording|result|tile|item/.test(className);
        const tooLarge = rect.width > Math.max(1100, innerWidth * .9) || rect.height > Math.max(850, innerHeight * .9);

        if (!media && !tooLarge && rect.width > 150 && rect.height > 70 && rect.height < 750 && text.length >= 12 && text.length < 1400 && links <= 5 && parseCourseCodes(text).length) {
          if (looksLikeCard || depth >= 1) {
            cards.add(current);
            break;
          }
        }
      }
    });

    return [...cards];
  }

  function cardIgnored(card) {
    const text = normalize(card.innerText || card.textContent);
    const courses = parseCourseCodes(text).map(baseCourse);
    const semester = parseSemester(text);

    return state.ignored.some(key => {
      const separator = key.indexOf("|");
      if (separator < 0) return false;
      const ignoredSemester = key.slice(0, separator);
      const ignoredCourse = baseCourse(key.slice(separator + 1));
      return courses.includes(ignoredCourse) && (!semester || semester === ignoredSemester);
    });
  }

  function clearIgnoredCards() {
    document.querySelectorAll(".pcf-fix-ignored").forEach(card => {
      card.classList.remove("pcf-fix-ignored");
      ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
    });
  }

  function applyIgnoreFilter() {
    document.body.classList.toggle("pcf-ignore-mode", state.mode === "ignore");

    if (viewerPage() || state.mode !== "ignore") {
      clearIgnoredCards();
      return;
    }

    recordingCards().forEach(card => {
      if (cardIgnored(card)) {
        card.classList.add("pcf-fix-ignored");
        card.style.setProperty("display", "none", "important");
        card.style.setProperty("visibility", "hidden", "important");
        card.style.setProperty("opacity", "0", "important");
        card.style.setProperty("pointer-events", "none", "important");
      } else if (card.classList.contains("pcf-fix-ignored")) {
        card.classList.remove("pcf-fix-ignored");
        ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
      }
    });
  }

  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyIgnoreFilter, 80);
  }

  function dedupeMainState(saved) {
    const entries = Array.isArray(saved.entries) ? saved.entries : [];
    const uniqueEntries = new Map();

    entries.forEach(entry => {
      if (!entry || !entry.key) return;
      const separator = String(entry.key).indexOf("|");
      if (separator < 0) return;

      const semester = String(entry.key).slice(0, separator);
      const course = baseCourse(String(entry.key).slice(separator + 1));
      const key = `${semester}|${course}`;

      uniqueEntries.set(key, {
        key,
        term: entry.term,
        year: entry.year,
        course
      });
    });

    const normalizeKeys = values => [...new Set((Array.isArray(values) ? values : []).map(String).map(key => {
      const separator = key.indexOf("|");
      if (separator < 0) return key;
      return `${key.slice(0, separator)}|${baseCourse(key.slice(separator + 1))}`;
    }))];

    const customNames = {};
    if (saved.customNames && typeof saved.customNames === "object") {
      Object.entries(saved.customNames).forEach(([key, value]) => {
        const separator = key.indexOf("|");
        const normalizedKey = separator < 0 ? key : `${key.slice(0, separator)}|${baseCourse(key.slice(separator + 1))}`;
        if (!(normalizedKey in customNames)) customNames[normalizedKey] = value;
      });
    }

    return {
      ...saved,
      entries: [...uniqueEntries.values()],
      selected: normalizeKeys(saved.selected).filter(key => uniqueEntries.has(key)),
      currentClasses: normalizeKeys(saved.currentClasses).filter(key => uniqueEntries.has(key)),
      customNames
    };
  }

  async function cleanMainStorage() {
    try {
      const result = await chrome.storage.local.get(MAIN_STORAGE_KEY);
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;

      const cleaned = dedupeMainState(saved);
      const changed = JSON.stringify(saved) !== JSON.stringify(cleaned);
      if (changed) await chrome.storage.local.set({ [MAIN_STORAGE_KEY]: cleaned });
    } catch (error) {
      console.warn("Panopto Course Filter: could not clean course state.", error);
    }
  }

  function dedupeRenderedRows() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;

    panel.querySelectorAll(".pcf-semester-courses").forEach(group => {
      const seen = new Set();
      group.querySelectorAll(":scope > .pcf-course-row").forEach(row => {
        const entry = rowEntry(row);
        if (!entry) return;
        if (seen.has(entry.key)) row.remove();
        else seen.add(entry.key);
      });
    });
  }

  async function loadState() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS]);
      const saved = result[STORAGE_KEY] || result.panoptoCourseFilterFixesV6 || result.panoptoCourseFilterFixesV5 || result.panoptoCourseFilterFixesV4 || result.panoptoCourseFilterFixesV3 || result.panoptoCourseFilterFixesV2 || result.panoptoCourseFilterFixesV1 || {};
      state.mode = saved.mode === "selected" ? "selected" : "ignore";
      state.ignored = Array.isArray(saved.ignored) ? [...new Set(saved.ignored.map(String))] : [];
      state.ignored = state.ignored.map(key => {
        const separator = key.indexOf("|");
        return separator < 0 ? key : `${key.slice(0, separator)}|${baseCourse(key.slice(separator + 1))}`;
      });
    } catch (error) {
      console.warn("Panopto Course Filter: could not load fixes state.", error);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          mode: state.mode,
          ignored: [...new Set(state.ignored)]
        }
      });
    } catch (error) {
      console.warn("Panopto Course Filter: could not save fixes state.", error);
    }
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Restore this course" : "Ignore this course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
  }

  function addIgnoreButtons() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;

    panel.querySelectorAll(".pcf-course-row").forEach(row => {
      const entry = rowEntry(row);
      if (!entry) return;

      let button = row.querySelector(".pcf-ignore-fix");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "pcf-ignore-fix";
        button.dataset.courseKey = entry.key;
        row.appendChild(button);
      }

      button.dataset.courseKey = entry.key;
      updateIgnoreButton(button);
    });
  }

  async function toggleIgnored(button) {
    const key = button && button.dataset.courseKey;
    if (!key) return;

    const index = state.ignored.indexOf(key);
    if (index >= 0) state.ignored.splice(index, 1);
    else state.ignored.push(key);

    state.mode = "ignore";
    updateModeUI();
    updateIgnoreButton(button);
    await saveState();
    scheduleFilter();
  }

  function setupIgnoreEvents() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel || panel.dataset.ignoreEventsReady === "true") return;
    panel.dataset.ignoreEventsReady = "true";

    panel.addEventListener("click", event => {
      const button = event.target.closest(".pcf-ignore-fix");
      if (!button || !panel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      void toggleIgnored(button);
    }, true);
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

    const selectors = [
      "#pcf-search",
      ".pcf-global-buttons",
      ".pcf-semester-actions",
      ".pcf-current-box",
      ".pcf-buttons",
      ".pcf-toggle",
      ".pcf-video-actions"
    ];

    selectors.forEach(selector => {
      panel.querySelectorAll(selector).forEach(element => {
        if (element !== controls && !controls.contains(element)) controls.appendChild(element);
      });
    });

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
        updateQuickUI(panel, toggle);
      });
      panel.insertBefore(toggle, controls);
    }

    updateQuickUI(panel, toggle);
  }

  function updateQuickUI(panel, toggle) {
    panel.classList.toggle("pcf-quick-controls-open", quickOpen);
    panel.classList.toggle("pcf-quick-controls-collapsed", !quickOpen);
    toggle.setAttribute("aria-expanded", String(quickOpen));
    const arrow = toggle.querySelector("b");
    if (arrow) arrow.textContent = quickOpen ? "⌃" : "⌄";
  }

  function updateModeUI() {
    document.body.classList.toggle("pcf-ignore-mode", state.mode === "ignore");
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
      gear.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector("#pcf-settings-modal")?.classList.add("pcf-settings-open");
      });
      const close = header.querySelector("#pcf-close");
      if (close) header.insertBefore(gear, close);
      else header.appendChild(gear);
    }

    if (document.querySelector("#pcf-settings-modal")) return;

    const modal = document.createElement("div");
    modal.id = "pcf-settings-modal";
    modal.innerHTML = `
      <div class="pcf-settings-backdrop"></div>
      <section class="pcf-settings-window">
        <div class="pcf-settings-header">
          <div><strong>Panopto Course Filter</strong><span>Settings & advanced controls</span></div>
          <button type="button" class="pcf-settings-close">×</button>
        </div>
        <div class="pcf-settings-body">
          <section class="pcf-settings-section">
            <h3>Filtering mode</h3>
            <div id="pcf-fixes-toolbar">
              <div class="pcf-fixes-modes">
                <button type="button" data-fix-mode="ignore"><span>🚫</span><span><strong>Hide ignored</strong><small>Show everything except courses you block.</small></span></button>
                <button type="button" data-fix-mode="selected"><span>✓</span><span><strong>Show selected</strong><small>Use the course checkboxes as the filter.</small></span></button>
              </div>
            </div>
          </section>
        </div>
      </section>`;

    document.body.appendChild(modal);
    modal.querySelector(".pcf-settings-backdrop").addEventListener("click", () => modal.classList.remove("pcf-settings-open"));
    modal.querySelector(".pcf-settings-close").addEventListener("click", () => modal.classList.remove("pcf-settings-open"));

    modal.addEventListener("click", async event => {
      const button = event.target.closest("button[data-fix-mode]");
      if (!button) return;
      event.preventDefault();
      state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";
      updateModeUI();
      await saveState();
      scheduleFilter();
    });
  }

  function tick() {
    if (busy) return;
    busy = true;
    try {
      createSettings();
      setupQuickControls();
      setupIgnoreEvents();
      addIgnoreButtons();
      dedupeRenderedRows();
      updateModeUI();
      scheduleFilter();
    } finally {
      busy = false;
    }
  }

  async function init() {
    await cleanMainStorage();
    await loadState();
    tick();

    observer = new MutationObserver(mutations => {
      let panoptoChanged = false;

      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;

        const target = mutation.target;
        if (target && target.closest && target.closest("#pcf-panel")) continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.id === "pcf-panel" || (node.closest && node.closest("#pcf-panel"))) continue;
          panoptoChanged = true;
          break;
        }

        if (panoptoChanged) break;
      }

      if (panoptoChanged) {
        clearTimeout(uiTimer);
        uiTimer = setTimeout(tick, 100);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else void init();
})();
