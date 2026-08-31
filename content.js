(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    collapsedSemesters: {},
    enabled: true,
    collapsedSemesters: {},
    onlySelectedSemesters: false,
    customNames: {}
  };

  let scanTimer = null;
  let panelUpdateTimer = null;
  let destroyed = false;
  let observer = null;
  let reloadingVideos = false;

  /*
   * =========================================================
   * LOAD MORE
   * =========================================================
   */

  let loadingMore = false;
  let loadMoreAttempts = 0;

  const MAX_LOAD_MORE_ATTEMPTS = 8;

  /*
   * =========================================================
   * COURSE PARSING
   * =========================================================
   */

  const FORWARD_RE =
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi;

  async function safeStorageGet(key) {
    if (!extensionAlive()) {
      return null;
    }

    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      if (
        String(error?.message || error)
          .toLowerCase()
          .includes("context invalidated")
      ) {
        return null;
      }

      console.warn(
        "Panopto Course Filter: storage read failed",
        error
      );

      return null;
    }
  }

  async function safeStorageSet(data) {
    if (!extensionAlive()) {
      return false;
    }

    try {
      await chrome.storage.local.set(data);
      return true;
    } catch (error) {
      if (
        String(error?.message || error)
          .toLowerCase()
          .includes("context invalidated")
      ) {
        return false;
      }

      console.warn(
        "Panopto Course Filter: storage write failed",
        error
      );

      return false;
    }
  }

  // ============================================================
  // COURSE PARSING
  // Auburn: Fall / Spring / Summer only.
  // ============================================================

  const COURSE_PATTERNS = [
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi,

    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*[-–—]\s*(Fall|Spring|Summer)\s+(\d{4})\b/gi,

    /\b([A-Z]{2,8})\s+(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi
  ];

      const section =
        match[5]
          ? match[5].toUpperCase()
          : "";

  function parseCourses(text) {
    text = normalize(text);

    if (!text) {
      return [];
    }

    const found = new Map();

    for (const pattern of COURSE_PATTERNS) {
      pattern.lastIndex = 0;

      let m;

      while ((m = pattern.exec(text))) {
        let term;
        let year;
        let subject;
        let number;
        let section;

        if (/Fall|Spring|Summer/i.test(m[1])) {
          term =
            m[1][0].toUpperCase() +
            m[1].slice(1).toLowerCase();

          year = m[2];
          subject = m[3].toUpperCase();
          number = m[4];
          section = m[5] || "";
        } else {
          subject = m[1].toUpperCase();
          number = m[2];
          section = m[3] || "";

          term =
            m[4][0].toUpperCase() +
            m[4].slice(1).toLowerCase();

          year = m[5];
        }

        const course =
          `${subject}-${number}${section ? "-" + section.toUpperCase() : ""}`;

        const entry = {
          key: `${term} ${year}|${course}`,
          term,
          year,
          course
        };

        found.set(entry.key, entry);
      }
    }

      const section =
        match[3]
          ? match[3].toUpperCase()
          : "";

  function sortEntries(entries) {
    const order = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return [...entries].sort((a, b) => {
      const yearDiff =
        Number(b.year) - Number(a.year);

      if (yearDiff) {
        return yearDiff;
      }

      const termDiff =
        (order[b.term] || 0) -
        (order[a.term] || 0);

      if (termDiff) {
        return termDiff;
      }

      return a.course.localeCompare(b.course);
    });
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  // ============================================================
  // STORAGE
  // ============================================================

  async function loadState() {
    const result =
      await safeStorageGet(STORAGE_KEY);

    if (result?.[STORAGE_KEY]) {
      Object.assign(
        state,
        result[STORAGE_KEY]
      );
    }

    state.entries =
      Array.isArray(state.entries)
        ? state.entries
        : [];

    state.selected =
      Array.isArray(state.selected)
        ? state.selected
        : [];

    state.currentClasses =
      Array.isArray(state.currentClasses)
        ? state.currentClasses
        : [];

    state.collapsedSemesters =
      state.collapsedSemesters || {};

    state.entries =
      state.entries.filter(entry =>
        ["Fall", "Spring", "Summer"]
          .includes(entry.term)
      );
  }

  async function saveState() {
    return safeStorageSet({
      [STORAGE_KEY]: {
        entries: state.entries,
        selected: state.selected,
        currentClasses: state.currentClasses,
        collapsedSemesters:
          state.collapsedSemesters,
        enabled: state.enabled
      }
    });
  }

  function getDisplayName(entry) {
    return (
      state.customNames[entry.key] ||
      entry.course
    );
  }

  function sortEntries(entries) {
    const termOrder = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return entries.sort((a, b) => {
      const yearDifference =
        Number(b.year) - Number(a.year);

      if (yearDifference !== 0) {
        return yearDifference;
      }

      const termDifference =
        (termOrder[b.term] || 0) -
        (termOrder[a.term] || 0);

      if (termDifference !== 0) {
        return termDifference;
      }

      return a.course.localeCompare(
        b.course
      );
    });
  }

  /*
   * =========================================================
   * STORAGE
   * =========================================================
   */

  function contextValid() {
    try {
      return Boolean(
        chrome &&
        chrome.runtime &&
        chrome.runtime.id
      );
    } catch {
      return false;
    }
  }

  async function loadState() {
    try {
      if (!contextValid()) {
        destroyed = true;
        return;
      }

      const result =
        await chrome.storage.local.get(
          STORAGE_KEY
        );

      if (!contextValid()) {
        destroyed = true;
        return;
      }

      if (result[STORAGE_KEY]) {
        Object.assign(
          state,
          result[STORAGE_KEY]
        );
      }

      state.entries =
        Array.isArray(state.entries)
          ? state.entries
          : [];

      state.selected =
        Array.isArray(state.selected)
          ? state.selected
          : [];

      state.currentClasses =
        Array.isArray(state.currentClasses)
          ? state.currentClasses
          : [];

      state.collapsedSemesters =
        state.collapsedSemesters || {};

      state.customNames =
        state.customNames || {};

      state.enabled =
        typeof state.enabled === "boolean"
          ? state.enabled
          : true;

      state.onlySelectedSemesters =
        typeof state.onlySelectedSemesters === "boolean"
          ? state.onlySelectedSemesters
          : false;

    } catch (error) {
      if (
        String(error).includes(
          "Extension context invalidated"
        )
      ) {
        destroyed = true;
        return;
      }

      console.error(
        "Panopto Course Filter: loadState failed.",
        error
      );
    }
  }

  async function saveState() {
    try {
      if (
        destroyed ||
        !contextValid()
      ) {
        return;
      }

      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          entries: state.entries,
          selected: state.selected,
          currentClasses:
            state.currentClasses,
          enabled: state.enabled,
          collapsedSemesters:
            state.collapsedSemesters,
          onlySelectedSemesters:
            state.onlySelectedSemesters,
          customNames:
            state.customNames
        }
      });

    } catch (error) {
      if (
        String(error).includes(
          "Extension context invalidated"
        )
      ) {
        destroyed = true;
        return;
      }

      console.error(
        "Panopto Course Filter: saveState failed.",
        error
      );
    }
  }

  /*
   * =========================================================
   * COURSE DISCOVERY
   * =========================================================
   */

  function discoverEntries({
    replace = false
  } = {}) {
    const found = new Map();

    document
      .querySelectorAll(
        "a,span,p,div,li,td,button"
      )
      .forEach(element => {
        if (
          element.closest &&
          element.closest("#pcf-panel")
        ) {
          return;
        }

        const text = normalize(
          element.innerText ||
          element.textContent
        );

        if (
          text.length > 5 &&
          text.length < 2500
        ) {
          parseCourses(text)
            .forEach(entry => {
              discovered.set(
                entry.key,
                entry
              );
            });
        }
      });

        parseEntries(text)
          .forEach(entry => {
            found.set(
              entry.key,
              entry
            );
          });
      });

    if (replace) {
      state.entries =
        sortEntries(
          [...found.values()]
        );

      return;
    }

    const merged = new Map();

    state.entries.forEach(entry => {
      if (
        entry &&
        entry.key
      ) {
        merged.set(
          entry.key,
          entry
        );
      }
    });

    found.forEach(
      (entry, key) => {
        merged.set(
          key,
          entry
        );
      }
    );

    state.entries =
      sortEntries(
        [...merged.values()]
      );
  }

  /*
   * =========================================================
   * RECORDING CARD DETECTION
   * =========================================================
   */

  async function clearAllCourses() {
    state.entries = [];
    state.selected = [];
    state.currentClasses = [];
    state.collapsedSemesters = {};

    document
      .querySelectorAll("a[href]")
      .forEach(link => {
        if (
          link.closest &&
          link.closest("#pcf-panel")
        ) {
          return;
        }

        const href =
          link.getAttribute("href") || "";

        if (
          !/viewer|session/i.test(href)
        ) {
          return;
        }

    restoreAll();

        for (
          let i = 0;
          i < 10 && parent;
          i++
        ) {
          if (
            parent.id === "pcf-panel" ||
            (
              parent.closest &&
              parent.closest("#pcf-panel")
            )
          ) {
            break;
          }

          const text = normalize(
            parent.innerText ||
            parent.textContent
          );

    updatePanel();

          if (
            rect.width > 150 &&
            rect.height > 100 &&
            rect.height < 900 &&
            text.length >= 15 &&
            text.length < 2000
          ) {
            const links =
              parent.querySelectorAll(
                "a[href]"
              );

            if (
              links.length <= 5
            ) {
              cards.add(parent);
              break;
            }
          }

  function getViewerLinks() {
    return [
      ...document.querySelectorAll(
        'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
      )
    ];
  }

  function getViewerId(link) {
    try {
      const url =
        new URL(
          link.href,
          location.href
        );

      return (
        url.searchParams.get("id") ||
        link.href
      );
    } catch {
      return link.href;
    }
  }

  function getCardEntries(card) {
    return parseEntries(
      normalize(
        card.innerText ||
        card.textContent
      )
    );
  }

  // ============================================================
  // COURSE CONTEXT
  // ============================================================

  function getRecordingCourses(recording) {
    const found = new Map();

    let current =
      recording.container;

    for (
      let depth = 0;
      depth < 7 && current;
      depth++
    ) {
      const rect =
        current.getBoundingClientRect();

      if (
        rect.width >
          window.innerWidth * 0.95 &&
        rect.height >
          window.innerHeight * 0.8
      ) {
        break;
      }

      const text =
        normalize(
          current.innerText ||
          current.textContent
        );

      if (
        text.length > 0 &&
        text.length < 2500
      ) {
        parseCourses(text)
          .forEach(entry => {
            found.set(
              entry.key,
              entry
            );
          });
      }

      current =
        current.parentElement;
    }

    return [...found.values()];
  }

  // ============================================================
  // RESTORE
  // ============================================================

  function restoreAll() {
    document
      .querySelectorAll(
        ".pcf-recording-hidden"
      )
      .forEach(el => {
        el.classList.remove(
          "pcf-recording-hidden"
        );

        el.style.removeProperty(
          "display"
        );

        el.style.removeProperty(
          "visibility"
        );

        el.removeAttribute(
          "hidden"
        );
      });
  }

  /*
   * =========================================================
   * LOAD MORE VIDEOS
   * =========================================================
   *
   * Panopto can use different button markup depending on
   * which page/component is being displayed.
   *
   * We look for actual buttons/links containing "Load More"
   * and only click visible, enabled controls.
   *
   * This intentionally does NOT click arbitrary "More"
   * buttons because those could open menus or other UI.
   */

  function findLoadMoreButton() {
    const candidates =
      document.querySelectorAll(
        "button, a, [role='button']"
      );

    for (const element of candidates) {
      if (
        element.closest &&
        element.closest("#pcf-panel")
      ) {
        continue;
      }

      const text =
        normalize(
          element.innerText ||
          element.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title")
        ).toLowerCase();

      if (
        !text ||
        !/load\s+more/.test(text)
      ) {
        continue;
      }

      /*
       * Unknown course = leave visible.
       *
       * Never hide the page just because we
       * couldn't associate a recording.
       */
      if (
        element.disabled ||
        element.getAttribute("aria-disabled") === "true"
      ) {
        continue;
      }

      const style =
        window.getComputedStyle(element);

      if (
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        continue;
      }

      const rect =
        element.getBoundingClientRect();

      if (
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      return element;
    }

    return null;
  }

  async function loadMoreVideosIfNeeded(
    visibleMatchingCount = 0
  ) {
    if (
      destroyed ||
      loadingMore ||
      !state.enabled ||
      state.selected.length === 0
    ) {
      return;
    }

    /*
     * If we already have a reasonable number of matching
     * recordings, don't keep loading more.
     */
    if (
      visibleMatchingCount >= 12
    ) {
      loadMoreAttempts = 0;
      return;
    }

    if (
      loadMoreAttempts >=
      MAX_LOAD_MORE_ATTEMPTS
    ) {
      return;
    }

    const button =
      findLoadMoreButton();

    if (!button) {
      return;
    }

    loadingMore = true;
    loadMoreAttempts++;

    const oldCardCount =
      findRecordingCards().length;

    try {
      button.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      await new Promise(resolve =>
        setTimeout(resolve, 200)
      );

      button.click();

      /*
       * Give Panopto time to insert the new cards.
       */
      await new Promise(resolve =>
        setTimeout(resolve, 900)
      );

      discoverEntries();

      const newCardCount =
        findRecordingCards().length;

      /*
       * If nothing was added, stop trying.
       */
      if (
        newCardCount <= oldCardCount
      ) {
        loadMoreAttempts =
          MAX_LOAD_MORE_ATTEMPTS;
      } else {
        /*
         * Apply the filter immediately so newly loaded
         * unmatched recordings disappear from the layout.
         */
        applyFilter();
      }

    } catch (error) {
      console.warn(
        "Panopto Course Filter: could not load more videos.",
        error
      );

    } finally {
      loadingMore = false;
    }
  }

  /*
   * =========================================================
   * FILTERING
   * =========================================================
   */

  function showAllCards() {
    findRecordingCards()
      .forEach(card => {
        card.classList.remove(
          "pcf-filtered-out"
        );

        /*
         * IMPORTANT:
         * display:none removes the card from the layout.
         * This prevents blank spaces where filtered cards
         * used to be.
         */
        card.style.removeProperty(
          "display"
        );

        card.style.removeProperty(
          "visibility"
        );

        card.style.removeProperty(
          "opacity"
        );

        card.style.removeProperty(
          "pointer-events"
        );
      });
  }

  function applyFilter() {
    if (destroyed) {
      return;
    }

    const cards =
      findRecordingCards();

    let matchingCount = 0;

    cards.forEach(card => {
      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        card.style.removeProperty(
          "display"
        );

        card.style.removeProperty(
          "visibility"
        );

        card.style.removeProperty(
          "opacity"
        );

        card.style.removeProperty(
          "pointer-events"
        );

        matchingCount++;

        return;
      }

      if (
        cardMatchesSelection(card)
      ) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        /*
         * Restore the card to its normal layout.
         */
        card.style.removeProperty(
          "display"
        );

        card.style.removeProperty(
          "visibility"
        );

        card.style.removeProperty(
          "opacity"
        );

        card.style.removeProperty(
          "pointer-events"
        );

        matchingCount++;

      } else {
        card.classList.add(
          "pcf-filtered-out"
        );

        /*
         * display:none is the key difference.
         *
         * visibility:hidden leaves an empty hole.
         * display:none lets Panopto's grid/flex layout
         * close the hole and move the remaining videos up.
         */
        card.style.display =
          "none";

        card.style.visibility =
          "hidden";

        card.style.opacity =
          "0";

        card.style.pointerEvents =
          "none";
      }
    });

    schedulePanelUpdate(
      matchingCount
    );

    /*
     * If filtering leaves only a few matching videos,
     * try to load another batch from Panopto.
     */
    void loadMoreVideosIfNeeded(
      matchingCount
    );
  }

  /*
   * =========================================================
   * PANEL UPDATE
   * =========================================================
   */

  function schedulePanelUpdate(
    matchingCount = null
  ) {
    clearTimeout(
      panelUpdateTimer
    );

    panelUpdateTimer =
      setTimeout(() => {
        updatePanel(
          matchingCount
        );
      }, 50);
  }

  /*
   * =========================================================
   * CURRENT SEMESTER
   * =========================================================
   */

  function getCurrentTerm() {
    const now = new Date();

    const month =
      now.getMonth() + 1;

    const year =
      now.getFullYear();

    if (
      month >= 1 &&
      month <= 5
    ) {
      return {
        term: "Spring",
        year
      };
    }

    if (
      month >= 6 &&
      month <= 7
    ) {
      return {
        term: "Summer",
        year
      };
    }

    return {
      term: "Fall",
      year
    };
  }

  /*
   * =========================================================
   * RENAME COURSE
   * =========================================================
   */

  async function renameCourse(entry) {
    const currentName =
      getDisplayName(entry);

    const newName =
      window.prompt(
        `Rename ${entry.course}\n\n` +
        `This only changes the name shown by the extension.`,
        currentName
      );

    if (newName === null) {
      return;
    }

    const cleaned =
      normalize(newName);

    if (!cleaned) {
      delete state.customNames[
        entry.key
      ];
    } else {
      state.customNames[
        entry.key
      ] = cleaned;
    }

    await saveState();

    updatePanel();
  }

  /*
   * =========================================================
   * RESET CUSTOM NAMES
   * =========================================================
   */

  async function resetCustomNames() {
    const names =
      Object.keys(
        state.customNames
      );

    if (
      names.length === 0
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Reset all custom course names?"
      );

    if (!confirmed) {
      return;
    }

    state.customNames = {};

    await saveState();

    updatePanel();
  }

  /*
   * =========================================================
   * EXPAND / COLLAPSE ALL
   * =========================================================
   */

  async function expandAllSemesters() {
    const groups =
      new Set();

    state.entries.forEach(entry => {
      groups.add(
        semesterKey(entry)
      );
    });

    groups.forEach(semester => {
      state.collapsedSemesters[
        semester
      ] = false;
    });

    await saveState();

    updatePanel();
  }

  async function collapseAllSemesters() {
    const groups =
      new Set();

    state.entries.forEach(entry => {
      groups.add(
        semesterKey(entry)
      );
    });

    groups.forEach(semester => {
      state.collapsedSemesters[
        semester
      ] = true;
    });

    await saveState();

    updatePanel();
  }

  /*
   * =========================================================
   * MANUAL VIDEO RELOAD
   * =========================================================
   */

  async function reloadVideos() {
    if (
      destroyed ||
      reloadingVideos
    ) {
      return;
    }

    reloadingVideos = true;

    const button =
      document.getElementById(
        "pcf-reload-videos"
      );

    if (button) {
      button.disabled = true;
      button.textContent =
        "↻ Reloading...";
    }

    await saveState();

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );

    window.location.reload();
  }

  /*
   * =========================================================
   * RESET EVERYTHING
   * =========================================================
   */

  async function resetEverything() {
    const confirmed =
      window.confirm(
        "Reset everything?\n\n" +
        "This will remove discovered classes, selected classes, " +
        "saved current classes, custom names, and saved preferences."
      );

    if (!confirmed) {
      return;
    }

    state.entries = [];
    state.selected = [];
    state.currentClasses = [];
    state.collapsedSemesters = {};
    state.onlySelectedSemesters = false;
    state.enabled = true;
    state.customNames = {};

    loadMoreAttempts = 0;

    try {
      if (contextValid()) {
        await chrome.storage.local.remove(
          STORAGE_KEY
        );
      }
    } catch (error) {
      console.error(
        "Panopto Course Filter: reset failed.",
        error
      );
    }

    discoverEntries({
      replace: true
    });

    await saveState();

    showAllCards();

    const enabled =
      document.getElementById(
        "pcf-enabled"
      );

    if (enabled) {
      enabled.checked = true;
    }

    const semesterToggle =
      document.getElementById(
        "pcf-only-selected-semesters"
      );

    if (semesterToggle) {
      semesterToggle.checked = false;
    }

    updatePanel(
      findRecordingCards().length
    );
  }

  /*
   * =========================================================
   * PANEL
   * =========================================================
   */

  function createPanel() {
    if (
      document.getElementById(
        "pcf-panel"
      )
    ) {
      return;
    }

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      "pcf-panel";

    panel.innerHTML = `
      <div class="pcf-header">
        <strong>🎓 Panopto Courses</strong>
        <button id="pcf-close">×</button>
      </div>

      <div class="pcf-description">
        Select the classes whose recordings you want to see.
      </div>

      <input
        id="pcf-search"
        type="search"
        placeholder="Search courses..."
      >

      <div class="pcf-global-buttons">
        <button id="pcf-select-all">
          Select All
        </button>

        <button id="pcf-clear-all">
          Clear All
        </button>
      </div>

      <div class="pcf-semester-actions">
        <button id="pcf-expand-all">
          ▼ Expand All
        </button>

        <button id="pcf-collapse-all">
          ▶ Collapse All
        </button>
      </div>

      <div class="pcf-current-box">
        <div class="pcf-current-title">
          ⭐ Current Classes
        </div>

        <div>
          <button id="pcf-current">
            Use Current
          </button>

          <button id="pcf-save">
            Save Selected
          </button>

          <button id="pcf-clear-current">
            Clear Saved
          </button>
        </div>
      </div>

      <button
        id="pcf-load"
        class="pcf-load"
      >
        🔎 Load Matching Recordings
      </button>

      <div
        id="pcf-status"
        class="pcf-status"
      ></div>

      <div class="pcf-actions">
        <button id="pcf-term">
          Current Semester
        </button>
      </div>

      <label class="pcf-toggle">
        <input
          id="pcf-enabled"
          type="checkbox"
        >
        Enable Filter
      </label>

      <label class="pcf-toggle">
        <input
          id="pcf-only-selected-semesters"
          type="checkbox"
        >
        Show only semesters with selected classes
      </label>

      <div class="pcf-video-actions">
        <button id="pcf-reload-videos">
          ↻ Reload Videos
        </button>

        <button id="pcf-rediscover">
          ↻ Forget & Rediscover
        </button>

        <button id="pcf-reset-names">
          Reset Course Names
        </button>

        <button id="pcf-reset">
          Reset Everything
        </button>
      </div>

      <div id="pcf-course-list"></div>

      <div class="pcf-footer">
        <div id="pcf-count"></div>

        <button id="pcf-scan">
          ↻ Scan
        </button>

        <button
          id="pcf-clear"
          class="pcf-danger"
        >
          🗑 Clear All Courses
        </button>
      </div>
    `;

    document.body.appendChild(
      panel
    );

    document.getElementById(
      "pcf-close"
    ).onclick =
      () => {
        panel.classList.add(
          "pcf-hidden"
        );
      };

    /*
     * ENABLE
     */

    const enabled =
      document.getElementById(
        "pcf-enabled"
      );

    enabled.checked =
      state.enabled;

    enabled.onchange =
      async event => {
        state.enabled =
          e.target.checked;

        loadMoreAttempts = 0;

        await saveState();

        if (!state.enabled) {
          showAllCards();

          schedulePanelUpdate(
            findRecordingCards().length
          );

          return;
        }

        applyFilter();
      };

    /*
     * ONLY SELECTED SEMESTERS
     */

    const semesterToggle =
      document.getElementById(
        "pcf-only-selected-semesters"
      );

    semesterToggle.checked =
      state.onlySelectedSemesters;

    semesterToggle.onchange =
      async event => {
        state.onlySelectedSemesters =
          event.target.checked;

        await saveState();

        updatePanel();
      };

    /*
     * SEARCH
     */

    document.getElementById(
      "pcf-search"
    ).oninput =
      () =>
        updatePanel();
      };

    /*
     * SELECT ALL
     */

    document.getElementById(
      "pcf-select-all"
    ).onclick =
      async () => {
        const searchElement =
          document.getElementById(
            "pcf-search"
          );

        const search =
          normalize(
            searchElement
              ? searchElement.value
              : ""
          ).toUpperCase();

        const keys =
          state.entries
            .filter(entry => {
              if (!search) {
                return true;
              }

              return (
                entryLabel(entry)
                  .toUpperCase()
                  .includes(search) ||
                getDisplayName(entry)
                  .toUpperCase()
                  .includes(search)
              );
            })
            .map(entry =>
              entry.key
            );

        keys.forEach(key => {
          if (
            !state.selected.includes(
              key
            )
          ) {
            state.selected.push(
              key
            );
          }
        });

        loadMoreAttempts = 0;

        await saveState();

        restoreAll();

        applyFilter();

    /*
     * CLEAR ALL
     */

    document.getElementById(
      "pcf-clear-all"
    ).onclick =
      async () => {
        state.selected = [];

        loadMoreAttempts = 0;

        await saveState();

        showAllCards();

        updatePanel(
          findRecordingCards().length
        );
      };

    /*
     * EXPAND ALL
     */

    document.getElementById(
      "pcf-expand-all"
    ).onclick =
      () => {
        void expandAllSemesters();
      };

    /*
     * COLLAPSE ALL
     */

    document.getElementById(
      "pcf-collapse-all"
    ).onclick =
      () => {
        void collapseAllSemesters();
      };

    /*
     * CURRENT SEMESTER
     */

    document.getElementById(
      "pcf-term"
    ).onclick =
      async () => {
        const current =
          currentTerm();

        state.selected =
          state.entries
            .filter(entry =>
              entry.term ===
                current.term &&
              Number(entry.year) ===
                current.year
            )
            .map(
              entry =>
                entry.key
            );

        loadMoreAttempts = 0;

        await saveState();

        applyFilter();
      };

    /*
     * USE CURRENT
     */

    document.getElementById(
      "pcf-use-current"
    ).onclick =
      async () => {
        state.selected =
          [...state.currentClasses];

        loadMoreAttempts = 0;

        await saveState();

        applyFilter();
      };

    /*
     * SAVE CURRENT
     */

    document.getElementById(
      "pcf-save-current"
    ).onclick =
      async () => {
        state.currentClasses =
          [...state.selected];

        await saveState();

        updatePanel();
      };

    /*
     * CLEAR SAVED
     */

    document.getElementById(
      "pcf-clear-current"
    ).onclick =
      async () => {
        state.currentClasses = [];

        await saveState();

        updatePanel();
      };

    /*
     * RELOAD VIDEOS
     */

    document.getElementById(
      "pcf-reload-videos"
    ).onclick =
      () => {
        void reloadVideos();
      };

    /*
     * FORGET + REDISCOVER
     */

    document.getElementById(
      "pcf-rediscover"
    ).onclick =
      async () => {
        const button =
          document.getElementById(
            "pcf-rediscover"
          );

        button.disabled = true;
        button.textContent =
          "↻ Rediscovering...";

        try {
          state.entries = [];

          loadMoreAttempts = 0;

          await saveState();

          discoverEntries({
            replace: true
          });

          const validKeys =
            new Set(
              state.entries.map(
                entry => entry.key
              )
            );

          state.selected =
            state.selected.filter(
              key =>
                validKeys.has(key)
            );

          state.currentClasses =
            state.currentClasses.filter(
              key =>
                validKeys.has(key)
            );

          Object.keys(
            state.customNames
          ).forEach(key => {
            if (!validKeys.has(key)) {
              delete state.customNames[
                key
              ];
            }
          });

          await saveState();

          updatePanel();

        } finally {
          button.disabled = false;
          button.textContent =
            "↻ Forget & Rediscover";
        }
      };

    /*
     * RESET COURSE NAMES
     */

    document.getElementById(
      "pcf-reset-names"
    ).onclick =
      () => {
        void resetCustomNames();
      };

    /*
     * RESET EVERYTHING
     */

    document.getElementById(
      "pcf-reset"
    ).onclick =
      () => {
        void resetEverything();
      };

        showStatus(
          "Saved current classes cleared."
        );
      };

    document.getElementById(
      "pcf-scan"
    ).onclick =
      async () => {
        await discoverCourses();

        loadMoreAttempts = 0;

        void saveState();

        applyFilter();

        updatePanel();

        showStatus(
          `Scan complete — ${state.entries.length} courses discovered.`
        );
      };

    document.getElementById(
      "pcf-clear"
    ).onclick =
      async () => {
        if (
          !confirm(
            "Clear ALL discovered courses and saved current classes?"
          )
        ) {
          return;
        }

        state.generation++;

        await clearAllCourses();
      };

    updateLoadButton();
  }

  /*
   * =========================================================
   * PANEL UPDATE
   * =========================================================
   */

  function updatePanel(
    matchingCount = null
  ) {
    if (destroyed) {
      return;
    }

    const panel =
      document.getElementById(
        "pcf-panel"
      );

    const list =
      document.getElementById(
        "pcf-list"
      );

    if (
      !panel ||
      !list
    ) {
      return;
    }

    const searchElement =
      document.getElementById(
        "pcf-search"
      );

    const search =
      normalize(
        searchElement
          ? searchElement.value
          : ""
      ).toUpperCase();

    list.innerHTML = "";

    const groups =
      new Map();

    state.entries
      .filter(entry => {
        const original =
          entryLabel(entry)
            .toUpperCase();

        const custom =
          getDisplayName(entry)
            .toUpperCase();

        return (
          !search ||
          original.includes(search) ||
          custom.includes(search)
        );
      })
      .forEach(entry => {
        const semester =
          semesterKey(entry);

        if (
          !groups.has(semester)
        ) {
          groups.set(
            semester,
            []
          );
        }

        groups
          .get(semester)
          .push(entry);
      });

    groups.forEach(
      (entries, semester) => {
        const semesterKeys =
          entries.map(
            entry =>
              entry.key
          );

        const selectedInSemester =
          entries.filter(entry =>
            state.selected.includes(
              entry.key
            )
          ).length;

        if (
          state.onlySelectedSemesters &&
          selectedInSemester === 0
        ) {
          return;
        }

        const header =
          document.createElement(
            "div"
          );

        header.className =
          "pcf-semester-header";

      courses.className =
        "pcf-courses";

      courses.style.display =
        collapsed
          ? "none"
          : "";

      header
        .querySelector(
          ".pcf-collapse"
        )
        .onclick =
        async () => {
          state.collapsedSemesters[
            semester
          ] =
            !state.collapsedSemesters[
              semester
            ];

        header.innerHTML = `
          <button
            class="pcf-semester-toggle"
            title="${collapsed ? "Expand" : "Collapse"} ${semester}"
          >
            ${collapsed ? "▶" : "▼"}
          </button>

          <div class="pcf-semester-name">
            <strong>${semester}</strong>
            <span class="pcf-semester-count">
              ${selectedInSemester}/${entries.length}
            </span>
          </div>

          <button class="pcf-semester-all">
            ${
              selectedInSemester ===
              entries.length
                ? "Clear"
                : "All"
            }
          </button>
        `;

        list.appendChild(
          header
        );

        const courses =
          document.createElement(
            "div"
          );

        courses.className =
          "pcf-semester-courses";

        if (collapsed) {
          courses.style.display =
            "none";
        }

        /*
         * COLLAPSE / EXPAND
         */

        header
          .querySelector(
            ".pcf-semester-toggle"
          )
          .onclick =
          async () => {
            state.collapsedSemesters[
              semester
            ] =
              !state
                .collapsedSemesters[
                semester
              ];

        const checkbox =
          document.createElement(
            "input"
          );

            updatePanel();
          };

        /*
         * SEMESTER ALL/CLEAR
         */

        header
          .querySelector(
            ".pcf-semester-all"
          )
          .onclick =
          async () => {
            const allSelected =
              semesterKeys.length > 0 &&
              semesterKeys.every(key =>
                state.selected.includes(
                  key
                )
              ) {
                state.selected.push(
                  entry.key
                );
              }
            } else {
              state.selected =
                state.selected.filter(
                  key =>
                    !semesterKeys.includes(
                      key
                    )
                );
            } else {
              semesterKeys.forEach(key => {
                if (
                  !state.selected.includes(
                    key
                  )
                ) {
                  state.selected.push(
                    key
                  );
                }
              });
            }

            loadMoreAttempts = 0;

            await saveState();

            if (
              state.selected.length === 0
            ) {
              restoreAll();
            }

            applyFilter();
          };

        /*
         * COURSES
         */

        entries.forEach(entry => {
          const row =
            document.createElement(
              "div"
            );

          row.className =
            "pcf-course-row";

          const label =
            document.createElement(
              "label"
            );

        label.appendChild(
          document.createTextNode(
            entry.course
          )
        );

        if (
          state.currentClasses.includes(
            entry.key
          )
        ) {
          const star =
            document.createElement(
              "input"
            );

          checkbox.type =
            "checkbox";

          checkbox.checked =
            state.selected.includes(
              entry.key
            );

          if (
            state.currentClasses.includes(
              entry.key
            )
          ) {
            label.classList.add(
              "pcf-current-class"
            );

              loadMoreAttempts = 0;

              await saveState();

          star.className =
            "pcf-star";

          const nameContainer =
            document.createElement(
              "span"
            );

          nameContainer.className =
            "pcf-course-name";

          const displayName =
            document.createElement(
              "span"
            );

          displayName.className =
            "pcf-course-display-name";

          displayName.textContent =
            getDisplayName(entry);

          /*
           * Native browser tooltip.
           *
           * This gives the full class name when the visible
           * name is shortened with CSS ellipsis.
           */
          displayName.title =
            getDisplayName(entry);

          nameContainer.appendChild(
            displayName
          );
        }

          /*
           * Show the real course code if renamed.
           */

          if (
            state.customNames[
              entry.key
            ]
          ) {
            const originalName =
              document.createElement(
                "span"
              );

            originalName.className =
              "pcf-course-original-name";

            originalName.textContent =
              entry.course;

            nameContainer.appendChild(
              originalName
            );
          }

          label.append(
            checkbox,
            nameContainer
          );

          if (
            state.currentClasses.includes(
              entry.key
            )
          ) {
            const star =
              document.createElement(
                "span"
              );

    const count =
      document.getElementById(
        "pcf-count"
      );

            star.textContent =
              "★";

    count.innerHTML = `
      <div>
        <strong>${state.selected.length}</strong>
        selected
      </div>

      <div>
        <strong>${recordings.length}</strong>
        recordings on page
      </div>

          /*
           * RENAME BUTTON
           */

          const renameButton =
            document.createElement(
              "button"
            );

          renameButton.className =
            "pcf-rename";

          renameButton.type =
            "button";

          renameButton.textContent =
            "✎";

          renameButton.title =
            "Rename course";

          renameButton.onclick =
            event => {
              event.preventDefault();
              event.stopPropagation();

              void renameCourse(
                entry
              );
            };

          row.append(
            label,
            renameButton
          );

          courses.appendChild(
            row
          );
        });

        list.appendChild(
          courses
        );
      }
    );

    /*
     * RECORDING COUNT
     */

    if (
      matchingCount === null
    ) {
      const cards =
        findRecordingCards();

      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        matchingCount =
          cards.length;
      } else {
        matchingCount =
          cards.filter(card =>
            cardMatchesSelection(card)
          ).length;
      }
    }

    /*
     * STATUS
     */

  function showStatus(text) {
    const el =
      document.getElementById(
        "pcf-status"
      );

    if (!countElement) {
      return;
    }

    let statusText = "";

    if (!state.enabled) {
      statusText =
        "Filtering disabled";
    } else if (
      state.selected.length === 0
    ) {
      statusText =
        "Showing all recordings";
    } else {
      const selectedLabels =
        state.entries
          .filter(entry =>
            state.selected.includes(
              entry.key
            )
          )
          .map(entry =>
            getDisplayName(entry)
          );

      if (
        selectedLabels.length <= 3
      ) {
        statusText =
          `Showing ${selectedLabels.join(", ")}`;
      } else {
        statusText =
          `Showing ${selectedLabels.length} selected classes`;
      }
    }

    countElement.innerHTML = `
      <div class="pcf-status">
        ${statusText}
      </div>

      <div>
        <strong>
          ${state.selected.length}
        </strong>
        selected ·
        <strong>
          ${matchingCount}
        </strong>
        recordings
      </div>

      <div class="pcf-discovered-count">
        ${state.entries.length}
        discovered classes
      </div>

      ${
        state.currentClasses.length > 0
          ? `
            <div class="pcf-saved-count">
              ⭐ ${state.currentClasses.length}
              saved current
            </div>
          `
          : ""
      }
    `;
  }

  /*
   * =========================================================
   * LAUNCHER
   * =========================================================
   */

  function createLauncher() {
    if (
      document.getElementById(
        "pcf-launcher"
      )
    ) {
      return;
    }

    const button =
      document.createElement(
        "button"
      );

    button.id =
      "pcf-launcher";

    button.textContent =
      "🎓 Courses";

    button.onclick =
      () => {
        const panel =
          document.getElementById(
            "pcf-panel"
          );

        if (!panel) {
          return;
        }

        panel.classList.remove(
          "pcf-hidden"
        );

        updatePanel();
      };

    document.body.appendChild(
      button
    );
  }

  /*
   * =========================================================
   * DYNAMIC PANOPTO CONTENT
   * =========================================================
   */

  function handleDynamicContent() {
    if (destroyed) {
      return;
    }

    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(() => {
        if (destroyed) {
          return;
        }

        discoverEntries();

        void saveState();

        applyFilter();

      }, 100);
  }

  /*
   * =========================================================
   * INITIALIZATION
   * =========================================================
   */

  async function init() {
    await loadState();

    if (destroyed) {
      return;
    }

    createPanel();
    createLauncher();

          /*
           * If Chrome has invalidated this content script,
           * stop rather than producing repeated errors.
           */
          if (
            !extensionAlive()
          ) {
            return;
          }

    await saveState();

    applyFilter();

    observer =
      new MutationObserver(
        mutations => {
          if (destroyed) {
            return;
          }

          let panoptoChanged = false;

          for (
            const mutation of mutations
          ) {
            if (
              mutation.type !==
              "childList"
            ) {
              continue;
            }

            const target =
              mutation.target;

            if (
              target &&
              target.closest &&
              target.closest("#pcf-panel")
            ) {
              continue;
            }

            for (
              const node of mutation.addedNodes
            ) {
              if (
                node.nodeType !==
                Node.ELEMENT_NODE
              ) {
                continue;
              }

              if (
                node.id ===
                "pcf-panel" ||
                (
                  node.closest &&
                  node.closest("#pcf-panel")
                )
              ) {
                continue;
              }

              panoptoChanged = true;
              break;
            }

            if (panoptoChanged) {
              break;
            }
          }

          if (panoptoChanged) {
            handleDynamicContent();
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  // ============================================================
  // SPA NAVIGATION
  // ============================================================

  function watchUrl() {
    setInterval(
      () => {
        handleDynamicContent();
      },
      400
    );

    let attempts = 0;

    const timer =
      setInterval(() => {
        if (destroyed) {
          clearInterval(timer);
          return;
        }

        attempts++;

        discoverEntries();

        applyFilter();

        if (attempts >= 30) {
          clearInterval(timer);
        }
      }, 500);

    window.addEventListener(
      "load",
      () => {
        if (destroyed) {
          return;
        }

        setTimeout(() => {
          discoverEntries();

          applyFilter();
        }, 500);
      },
      {
        once: true
      }
    );

    updatePanel();
  }

  /*
   * =========================================================
   * START
   * =========================================================
   */

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init().catch(error => {
      if (
        String(error).includes(
          "Extension context invalidated"
        )
      ) {
        console.warn(
          "Panopto Course Filter: extension context invalidated. Refresh the Panopto page."
        );

        return;
      }

      console.error(
        "Panopto Course Filter failed to initialize.",
        error
      );
    });
  }

  init();

})();
