(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const FIXES_KEY = "panoptoCourseFilterFixesV1";

  const state = {
    mode: "ignore",
    ignored: []
  };

  let filterTimer = null;
  let uiTimer = null;
  let observer = null;
  let applying = false;
  let intervalId = null;

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  const FORWARD_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const REVERSE_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi;

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

  function isViewerPage() {
    return /\/pages\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname) ||
      /\/viewer(?:\.aspx)?(?:\/|$)/i.test(location.pathname);
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
        const tooLarge = rect.width > Math.max(900, window.innerWidth * 0.9) ||
          rect.height > Math.max(850, window.innerHeight * 0.9);
        const looksLikePlayer = Boolean(parent.querySelector("video, audio, iframe, .video-js, [class*='player' i]"));

        if (!tooLarge && !looksLikePlayer && rect.width > 150 && rect.height > 100 &&
            rect.height < 900 && text.length >= 15 && text.length < 1600 && childLinks <= 5) {
          const entries = parseEntries(text);
          if (entries.length) {
            cards.add(parent);
            break;
          }
        }
        parent = parent.parentElement;
      }
    });

    return [...cards];
  }

  function cardEntries(card) {
    return parseEntries(normalize(card.innerText || card.textContent));
  }

  function cardShouldHide(card) {
    return state.ignored.length > 0 &&
      cardEntries(card).some(entry => state.ignored.includes(entry.key));
  }

  function clearFilterClasses() {
    document.querySelectorAll(".pcf-fix-filtered-out").forEach(card => {
      card.classList.remove("pcf-fix-filtered-out");
      card.style.removeProperty("display");
      card.style.removeProperty("visibility");
      card.style.removeProperty("opacity");
      card.style.removeProperty("pointer-events");
    });

    document.querySelectorAll(".pcf-filtered-out").forEach(card => {
      card.classList.remove("pcf-filtered-out");
      card.style.removeProperty("display");
      card.style.removeProperty("visibility");
      card.style.removeProperty("opacity");
      card.style.removeProperty("pointer-events");
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
        const shouldHide = cardShouldHide(card);
        const isHidden = card.classList.contains("pcf-fix-filtered-out");

        if (shouldHide && !isHidden) {
          card.classList.add("pcf-fix-filtered-out");
          card.style.display = "none";
          card.style.visibility = "hidden";
          card.style.opacity = "0";
          card.style.pointerEvents = "none";
        } else if (!shouldHide && isHidden) {
          card.classList.remove("pcf-fix-filtered-out");
          card.style.removeProperty("display");
          card.style.removeProperty("visibility");
          card.style.removeProperty("opacity");
          card.style.removeProperty("pointer-events");
        }
      });
    } finally {
      applying = false;
    }
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
        await chrome.storage.local.set({
          [STORAGE_KEY]: { ...oldState, selected: [] }
        });
      }
    } catch (error) {
      console.warn("Panopto Course Filter: fixes could not load state.", error);
    }
  }

  async function save() {
    try {
      await chrome.storage.local.set({
        [FIXES_KEY]: { mode: state.mode, ignored: state.ignored }
      });
    } catch (error) {
      console.warn("Panopto Course Filter: fixes could not save state.", error);
    }
  }

  function addControlsToCourseRows() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;

    let toolbar = panel.querySelector("#pcf-fixes-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "pcf-fixes-toolbar";
      toolbar.innerHTML = `
        <div class="pcf-fixes-heading">
          <div class="pcf-fixes-title">Filtering mode</div>
          <div class="pcf-fixes-help">Choose how recordings are filtered.</div>
        </div>
        <div class="pcf-fixes-modes">
          <button type="button" data-fix-mode="ignore">
            <span class="pcf-mode-icon">🚫</span>
            <span><strong>Hide ignored</strong><small>Show everything except courses you block</small></span>
          </button>
          <button type="button" data-fix-mode="selected">
            <span class="pcf-mode-icon">✓</span>
            <span><strong>Show selected</strong><small>Only show courses you check</small></span>
          </button>
        </div>
        <div class="pcf-fixes-tip">In Hide ignored mode, use the 🚫 button beside a course to hide or restore it.</div>
      `;

      const search = panel.querySelector("#pcf-search");
      panel.insertBefore(toolbar, search || panel.firstChild);

      toolbar.addEventListener("click", async event => {
        const button = event.target.closest("button[data-fix-mode]");
        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        state.mode = button.dataset.fixMode === "selected" ? "selected" : "ignore";

        if (state.mode === "ignore") {
          try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            const oldState = result[STORAGE_KEY] || {};
            await chrome.storage.local.set({
              [STORAGE_KEY]: { ...oldState, selected: [] }
            });
          } catch {}
        }

        await save();
        scheduleFilter();
        updateModeUI();
      });
    }

    updateModeUI();

    panel.querySelectorAll(".pcf-course-row").forEach(row => {
      const existing = row.querySelector(".pcf-ignore-fix");
      if (existing) {
        updateIgnoreButton(existing);
        return;
      }

      const label = row.querySelector(".pcf-course");
      if (!label) return;

      const text = normalize(label.innerText || label.textContent);
      const entry = parseEntries(text)[0];
      if (!entry) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "pcf-ignore-fix";
      button.dataset.courseKey = entry.key;
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const index = state.ignored.indexOf(entry.key);
        if (index >= 0) {
          state.ignored.splice(index, 1);
        } else {
          state.ignored.push(entry.key);
        }

        await save();
        updateIgnoreButton(button);
        scheduleFilter();
      });

      row.appendChild(button);
      updateIgnoreButton(button);
    });
  }

  function updateIgnoreButton(button) {
    const ignored = state.ignored.includes(button.dataset.courseKey);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? "Unignore course" : "Ignore course";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
    button.classList.toggle("is-disabled", state.mode === "selected");
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

  function start() {
    load().then(() => {
      addControlsToCourseRows();
      scheduleFilter();

      observer = new MutationObserver(mutations => {
        if (applying) return;

        let relevant = false;
        for (const mutation of mutations) {
          if (mutation.type !== "childList") continue;
          relevant = true;
          break;
        }

        if (!relevant) return;

        clearTimeout(uiTimer);
        uiTimer = setTimeout(() => {
          addControlsToCourseRows();
          scheduleFilter();
        }, 350);
      });

      observer.observe(document.body, { childList: true, subtree: true });

      intervalId = setInterval(() => {
        addControlsToCourseRows();
        if (state.mode === "ignore") scheduleFilter();
      }, 1500);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
