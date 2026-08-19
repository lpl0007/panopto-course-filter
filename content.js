(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV6";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  let scanTimer = null;
  let filterTimer = null;
  let loaderTimer = null;
  let isScanning = false;

  /*
   * ---------------------------------------------------------
   * COURSE / SEMESTER PARSING
   * ---------------------------------------------------------
   */

  const FORWARD_RE =
    /\b(Fall|Spring|Summer|Winter)\s+(\d{4})\s*[-–—]?\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer|Winter)\s+(\d{4})\s*\)/gi;

  function normalize(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseEntries(text) {
    const results = [];

    text = normalize(text);

    let match;

    FORWARD_RE.lastIndex = 0;

    while ((match = FORWARD_RE.exec(text))) {
      const term =
        match[1].charAt(0).toUpperCase() +
        match[1].slice(1).toLowerCase();

      const year = match[2];
      const subject = match[3].toUpperCase();
      const number = match[4];

      const section = match[5]
        ? match[5].toUpperCase()
        : "";

      const course =
        `${subject}-${number}${section ? "-" + section : ""}`;

      results.push({
        key: `${term} ${year}|${course}`,
        term,
        year,
        course
      });
    }

    REVERSE_RE.lastIndex = 0;

    while ((match = REVERSE_RE.exec(text))) {
      const subject = match[1].toUpperCase();
      const number = match[2];

      const section = match[3]
        ? match[3].toUpperCase()
        : "";

      const term =
        match[4].charAt(0).toUpperCase() +
        match[4].slice(1).toLowerCase();

      const year = match[5];

      const course =
        `${subject}-${number}${section ? "-" + section : ""}`;

      results.push({
        key: `${term} ${year}|${course}`,
        term,
        year,
        course
      });
    }

    return results;
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  function semesterKey(entry) {
    return `${entry.term} ${entry.year}`;
  }

  /*
   * ---------------------------------------------------------
   * SORTING / MERGING DISCOVERED COURSES
   * ---------------------------------------------------------
   */

  function sortEntries(entries) {
    const termOrder = {
      Fall: 4,
      Summer: 3,
      Spring: 2,
      Winter: 1
    };

    return entries.sort((a, b) => {
      const ay = Number(a.year);
      const by = Number(b.year);

      if (ay !== by) {
        return by - ay;
      }

      if (termOrder[a.term] !== termOrder[b.term]) {
        return termOrder[b.term] - termOrder[a.term];
      }

      return a.course.localeCompare(b.course);
    });
  }

  function mergeDiscoveredEntries(newEntries) {
    const map = new Map();

    /*
     * Keep everything we remembered from previous visits.
     */
    state.entries.forEach(entry => {
      if (entry && entry.key) {
        map.set(entry.key, entry);
      }
    });

    /*
     * Add anything found on the current page.
     */
    newEntries.forEach(entry => {
      if (entry && entry.key) {
        map.set(entry.key, entry);
      }
    });

    state.entries = sortEntries([...map.values()]);
  }

  /*
   * ---------------------------------------------------------
   * COURSE DISCOVERY
   * ---------------------------------------------------------
   */

  function discoverEntries(options = {}) {
    const {
      replace = false,
      save = false
    } = options;

    const found = new Map();

    document
      .querySelectorAll(
        "a, span, p, [role='treeitem'], [class*='card'], [class*='Card']"
      )
      .forEach(element => {
        const text = normalize(
          element.innerText ||
          element.textContent
        );

        if (
          text.length < 8 ||
          text.length > 350
        ) {
          return;
        }

        parseEntries(text).forEach(entry => {
          found.set(entry.key, entry);
        });
      });

    if (replace) {
      state.entries = sortEntries(
        [...found.values()]
      );
    } else {
      mergeDiscoveredEntries(
        [...found.values()]
      );
    }

    /*
     * Remove selections that are no longer part of
     * the remembered class database.
     */
    const knownKeys =
      new Set(state.entries.map(entry => entry.key));

    state.selected =
      state.selected.filter(key =>
        knownKeys.has(key)
      );

    state.currentClasses =
      state.currentClasses.filter(key =>
        knownKeys.has(key)
      );

    if (save) {
      saveState();
    }

    return found.size;
  }

  /*
   * ---------------------------------------------------------
   * RECORDING CARD DETECTION
   * ---------------------------------------------------------
   */

  function findRecordingCards() {
    const cards = new Set();

    document
      .querySelectorAll("a[href]")
      .forEach(link => {
        const href =
          link.getAttribute("href") || "";

        if (!/viewer|session/i.test(href)) {
          return;
        }

        let parent = link;

        for (
          let i = 0;
          i < 8 && parent;
          i++
        ) {
          const text = normalize(
            parent.innerText ||
            parent.textContent
          );

          const rect =
            parent.getBoundingClientRect();

          if (
            rect.width > 150 &&
            rect.height > 100 &&
            rect.height < 800 &&
            text.length >= 15 &&
            text.length < 1500
          ) {
            const links =
              parent.querySelectorAll("a[href]");

            if (links.length <= 4) {
              cards.add(parent);
              break;
            }
          }

          parent = parent.parentElement;
        }
      });

    return [...cards];
  }

  function getCardEntries(card) {
    const text = normalize(
      card.innerText ||
      card.textContent
    );

    return parseEntries(text);
  }

  function cardMatchesSelection(card) {
    if (state.selected.length === 0) {
      return true;
    }

    const entries =
      getCardEntries(card);

    return entries.some(entry =>
      state.selected.includes(entry.key)
    );
  }

  /*
   * ---------------------------------------------------------
   * FILTERING
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   *
   * The old code used:
   *
   *   visibility: hidden
   *
   * That preserves the card's layout box, which is exactly
   * the large white space seen in the screenshot.
   *
   * We instead use a CSS class with display:none.
   *
   * Panopto is then nudged afterward so its lazy loader can
   * request another batch.
   * ---------------------------------------------------------
   */

  function clearFilterClasses() {
    findRecordingCards().forEach(card => {
      card.classList.remove("pcf-filtered-out");
    });
  }

  function applyFilter(options = {}) {
    const {
      nudgeLoader = true
    } = options;

    const cards =
      findRecordingCards();

    let visibleCount = 0;

    cards.forEach(card => {
      card.classList.remove(
        "pcf-filtered-out"
      );

      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        visibleCount++;
        return;
      }

      const matches =
        cardMatchesSelection(card);

      if (matches) {
        visibleCount++;
      } else {
        card.classList.add(
          "pcf-filtered-out"
        );
      }
    });

    updatePanel(visibleCount);

    if (nudgeLoader) {
      nudgePanoptoLoader();
    }
  }

  /*
   * ---------------------------------------------------------
   * PANOPTO LAZY-LOAD NUDGE
   * ---------------------------------------------------------
   *
   * Panopto can use either the window or an internal
   * scrollable container. We nudge both where appropriate.
   *
   * This does NOT remove or modify Panopto's recordings.
   * It simply causes normal scroll events to occur again.
   * ---------------------------------------------------------
   */

  function getScrollableContainers() {
    const containers = new Set();

    const cards = findRecordingCards();

    cards.slice(0, 10).forEach(card => {
      let element = card.parentElement;

      while (element && element !== document.body) {
        const style =
          window.getComputedStyle(element);

        const canScroll =
          /(auto|scroll)/i.test(
            style.overflowY
          ) &&
          element.scrollHeight >
            element.clientHeight + 20;

        if (canScroll) {
          containers.add(element);
        }

        element = element.parentElement;
      }
    });

    return [...containers];
  }

  function nudgePanoptoLoader() {
    clearTimeout(loaderTimer);

    loaderTimer =
      setTimeout(() => {
        const containers =
          getScrollableContainers();

        /*
         * Nudge internal Panopto scroll containers.
         */
        containers.forEach(container => {
          try {
            container.scrollTop =
              container.scrollHeight;

            container.dispatchEvent(
              new Event("scroll", {
                bubbles: true
              })
            );
          } catch (_) {}
        });

        /*
         * Also nudge the document.
         */
        try {
          const bottom =
            Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            );

          window.scrollTo({
            top: bottom,
            behavior: "instant"
          });

          window.dispatchEvent(
            new Event("scroll")
          );
        } catch (_) {}

        /*
         * Give Panopto a moment to append the next
         * batch, then scan/filter it.
         */
        setTimeout(() => {
          discoverEntries({
            save: true
          });

          applyFilter({
            nudgeLoader: false
          });
        }, 500);

      }, 80);
  }

  /*
   * ---------------------------------------------------------
   * STORAGE
   * ---------------------------------------------------------
   */

  async function loadState() {
    const result =
      await chrome.storage.local.get(
        STORAGE_KEY
      );

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

    state.currentClasses =
      Array.isArray(state.currentClasses)
        ? state.currentClasses
        : [];

    state.selected =
      Array.isArray(state.selected)
        ? state.selected
        : [];

    state.collapsedSemesters =
      state.collapsedSemesters || {};

    state.enabled =
      typeof state.enabled === "boolean"
        ? state.enabled
        : true;
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        entries: state.entries,
        selected: state.selected,
        currentClasses:
          state.currentClasses,
        enabled: state.enabled,
        collapsedSemesters:
          state.collapsedSemesters
      }
    });
  }

  /*
   * ---------------------------------------------------------
   * CURRENT SEMESTER
   * ---------------------------------------------------------
   */

  function getCurrentTerm() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    if (month >= 1 && month <= 5) {
      return {
        term: "Spring",
        year
      };
    }

    if (month >= 6 && month <= 7) {
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
   * ---------------------------------------------------------
   * COUNT MATCHING RECORDINGS
   * ---------------------------------------------------------
   */

  function countMatchingCards() {
    const cards =
      findRecordingCards();

    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      return cards.length;
    }

    return cards.filter(card =>
      cardMatchesSelection(card)
    ).length;
  }

  /*
   * ---------------------------------------------------------
   * PANEL
   * ---------------------------------------------------------
   */

  function createPanel() {
    if (
      document.getElementById("pcf-panel")
    ) {
      return;
    }

    const panel =
      document.createElement("div");

    panel.id = "pcf-panel";

    panel.innerHTML = `
      <div class="pcf-header">
        <strong>🎓 Panopto Courses</strong>
        <button id="pcf-close">×</button>
      </div>

      <div class="pcf-description">
        Select specific semester/course sections.
      </div>

      <input
        id="pcf-search"
        type="search"
        placeholder="Search courses..."
      >

      <div class="pcf-current-box">
        <div class="pcf-current-title">
          ⭐ Current Classes
        </div>

        <div class="pcf-current-buttons">
          <button id="pcf-use-current">
            Use Current
          </button>

          <button id="pcf-save-current">
            Save Selected
          </button>

          <button id="pcf-clear-current">
            Clear Saved
          </button>
        </div>
      </div>

      <div class="pcf-buttons">
        <button id="pcf-current-semester">
          Current Semester
        </button>

        <button id="pcf-none">
          None
        </button>
      </div>

      <label class="pcf-toggle">
        <input
          id="pcf-enabled"
          type="checkbox"
        >
        Filter recordings
      </label>

      <div class="pcf-course-list-actions">
        <button id="pcf-rediscover">
          ↻ Forget & Rediscover
        </button>
      </div>

      <div id="pcf-course-list"></div>

      <div class="pcf-footer">
        <div id="pcf-count"></div>

        <button id="pcf-refresh">
          ↻ Scan
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    /*
     * CLOSE
     */

    document.getElementById(
      "pcf-close"
    ).onclick = () => {
      panel.classList.add(
        "pcf-hidden"
      );
    };

    /*
     * ENABLE / DISABLE FILTER
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
          event.target.checked;

        await saveState();

        applyFilter();
      };

    /*
     * SEARCH
     */

    document.getElementById(
      "pcf-search"
    ).oninput = () => {
      updatePanel();
    };

    /*
     * NONE
     */

    document.getElementById(
      "pcf-none"
    ).onclick = async () => {
      state.selected = [];

      await saveState();

      applyFilter();
    };

    /*
     * CURRENT SEMESTER
     */

    document.getElementById(
      "pcf-current-semester"
    ).onclick = async () => {
      const current =
        getCurrentTerm();

      state.selected =
        state.entries
          .filter(entry =>
            entry.term === current.term &&
            Number(entry.year) === current.year
          )
          .map(entry => entry.key);

      await saveState();

      applyFilter();
    };

    /*
     * USE SAVED CURRENT CLASSES
     */

    document.getElementById(
      "pcf-use-current"
    ).onclick = async () => {
      state.selected =
        [...state.currentClasses];

      await saveState();

      applyFilter();
    };

    /*
     * SAVE SELECTED AS CURRENT
     */

    document.getElementById(
      "pcf-save-current"
    ).onclick = async () => {
      state.currentClasses =
        [...state.selected];

      await saveState();

      updatePanel();
    };

    /*
     * CLEAR SAVED CURRENT CLASSES
     */

    document.getElementById(
      "pcf-clear-current"
    ).onclick = async () => {
      state.currentClasses = [];

      await saveState();

      updatePanel();
    };

    /*
     * NORMAL SCAN
     *
     * MERGES newly discovered classes into the
     * remembered database.
     */

    document.getElementById(
      "pcf-refresh"
    ).onclick = async () => {
      discoverEntries({
        save: true
      });

      applyFilter();

      updatePanel();
    };

    /*
     * FORGET ALL DISCOVERED CLASSES
     * THEN IMMEDIATELY DISCOVER WHAT IS CURRENTLY
     * PRESENT ON THE PAGE.
     */

    document.getElementById(
      "pcf-rediscover"
    ).onclick = async () => {
      const button =
        document.getElementById(
          "pcf-rediscover"
        );

      button.disabled = true;
      button.textContent =
        "↻ Rediscovering...";

      /*
       * Completely wipe remembered courses.
       */
      state.entries = [];
      state.selected = [];
      state.currentClasses = [];
      state.collapsedSemesters = {};

      await saveState();

      /*
       * Rebuild from the currently loaded Panopto DOM.
       */
      discoverEntries({
        replace: true
      });

      await saveState();

      updatePanel();

      button.disabled = false;
      button.textContent =
        "↻ Forget & Rediscover";

      applyFilter();

      /*
       * Continue encouraging Panopto to load more.
       */
      nudgePanoptoLoader();
    };
  }

  /*
   * ---------------------------------------------------------
   * PANEL UPDATE
   * ---------------------------------------------------------
   */

  function updatePanel(
    matchingCount = null
  ) {
    const list =
      document.getElementById(
        "pcf-course-list"
      );

    if (!list) {
      return;
    }

    const searchInput =
      document.getElementById(
        "pcf-search"
      );

    const search =
      normalize(
        searchInput ? searchInput.value : ""
      ).toUpperCase();

    list.innerHTML = "";

    const groups =
      new Map();

    state.entries
      .filter(entry => {
        const label =
          entryLabel(entry)
            .toUpperCase();

        return (
          !search ||
          label.includes(search)
        );
      })
      .forEach(entry => {
        const group =
          semesterKey(entry);

        if (!groups.has(group)) {
          groups.set(group, []);
        }

        groups
          .get(group)
          .push(entry);
      });

    groups.forEach(
      (entries, semester) => {
        const semesterHeader =
          document.createElement("div");

        semesterHeader.className =
          "pcf-semester-header";

        const collapsed =
          !!state.collapsedSemesters[
            semester
          ];

        const arrow =
          collapsed ? "▶" : "▼";

        semesterHeader.innerHTML = `
          <button class="pcf-semester-toggle">
            ${arrow}
          </button>

          <strong>${semester}</strong>

          <button class="pcf-semester-all">
            All
          </button>
        `;

        list.appendChild(
          semesterHeader
        );

        const semesterCourses =
          document.createElement("div");

        semesterCourses.className =
          "pcf-semester-courses";

        if (collapsed) {
          semesterCourses.style.display =
            "none";
        }

        /*
         * Collapse / expand
         */

        semesterHeader
          .querySelector(
            ".pcf-semester-toggle"
          )
          .onclick = async () => {
            state.collapsedSemesters[
              semester
            ] =
              !state.collapsedSemesters[
                semester
              ];

            await saveState();

            updatePanel(
              matchingCount
            );
          };

        /*
         * Select all
         */

        semesterHeader
          .querySelector(
            ".pcf-semester-all"
          )
          .onclick = async () => {
            const keys =
              entries.map(
                entry => entry.key
              );

            const allSelected =
              keys.every(key =>
                state.selected.includes(key)
              );

            if (allSelected) {
              state.selected =
                state.selected.filter(
                  key =>
                    !keys.includes(key)
                );
            } else {
              keys.forEach(key => {
                if (
                  !state.selected.includes(key)
                ) {
                  state.selected.push(key);
                }
              });
            }

            await saveState();

            applyFilter();
          };

        /*
         * Individual courses
         */

        entries.forEach(entry => {
          const label =
            document.createElement("label");

          label.className =
            "pcf-course";

          const checkbox =
            document.createElement("input");

          checkbox.type = "checkbox";

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
          }

          checkbox.onchange =
            async () => {
              if (checkbox.checked) {
                if (
                  !state.selected.includes(
                    entry.key
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
                      key !== entry.key
                  );
              }

              await saveState();

              /*
               * Apply immediately.
               */
              applyFilter();
            };

          label.append(
            checkbox,
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
              document.createElement("span");

            star.className =
              "pcf-star";

            star.textContent = " ★";

            star.title =
              "Saved as a current class";

            label.appendChild(star);
          }

          semesterCourses.appendChild(
            label
          );
        });

        list.appendChild(
          semesterCourses
        );
      }
    );

    if (matchingCount === null) {
      matchingCount =
        countMatchingCards();
    }

    const selectedCount =
      state.selected.length;

    const currentCount =
      state.currentClasses.length;

    const discoveredCount =
      state.entries.length;

    const countElement =
      document.getElementById(
        "pcf-count"
      );

    countElement.innerHTML = `
      <div>
        <strong>${selectedCount}</strong>
        selected ·
        <strong>${matchingCount}</strong>
        recordings
      </div>

      <div class="pcf-discovered-count">
        ${discoveredCount} discovered
      </div>

      ${
        currentCount > 0
          ? `
            <div class="pcf-saved-count">
              ⭐ ${currentCount}
              saved current
            </div>
          `
          : ""
      }
    `;
  }

  /*
   * ---------------------------------------------------------
   * LAUNCHER
   * ---------------------------------------------------------
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
      document.createElement("button");

    button.id = "pcf-launcher";

    button.textContent =
      "🎓 Courses";

    button.onclick = () => {
      document
        .getElementById("pcf-panel")
        .classList.remove(
          "pcf-hidden"
        );

      updatePanel();
    };

    document.body.appendChild(
      button
    );
  }

  /*
   * ---------------------------------------------------------
   * CONTINUOUS SCANNING
   * ---------------------------------------------------------
   */

  function rescan() {
    clearTimeout(scanTimer);

    scanTimer =
      setTimeout(async () => {
        if (isScanning) {
          return;
        }

        isScanning = true;

        try {
          const before =
            state.entries.length;

          discoverEntries({
            save: true
          });

          const changed =
            before !== state.entries.length;

          applyFilter({
            nudgeLoader: false
          });

          if (changed) {
            updatePanel();
          }
        } finally {
          isScanning = false;
        }
      }, 300);
  }

  /*
   * ---------------------------------------------------------
   * INITIALIZATION
   * ---------------------------------------------------------
   */

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    /*
     * IMPORTANT:
     *
     * Do NOT replace saved entries with the current page.
     * Merge the current page into the remembered database.
     */
    discoverEntries({
      save: true
    });

    applyFilter({
      nudgeLoader: false
    });

    /*
     * Watch Panopto's dynamically inserted recordings.
     */
    const observer =
      new MutationObserver(() => {
        rescan();
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    /*
     * Normal page scrolling.
     */
    window.addEventListener(
      "scroll",
      () => {
        rescan();
      },
      {
        passive: true
      }
    );
  }

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init();
  }
})();
