(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV7";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  let scanTimer = null;
  let isScanning = false;
  let loadingMore = false;

  /*
   * =========================================================
   * COURSE PARSING
   * =========================================================
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

      const at = termOrder[a.term] || 0;
      const bt = termOrder[b.term] || 0;

      if (at !== bt) {
        return bt - at;
      }

      return a.course.localeCompare(b.course);
    });
  }

  /*
   * =========================================================
   * STORAGE
   * =========================================================
   */

  async function loadState() {
    const result =
      await chrome.storage.local.get(STORAGE_KEY);

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
        currentClasses: state.currentClasses,
        enabled: state.enabled,
        collapsedSemesters:
          state.collapsedSemesters
      }
    });
  }

  /*
   * =========================================================
   * COURSE DISCOVERY
   * =========================================================
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
    } else {
      const merged = new Map();

      state.entries.forEach(entry => {
        if (entry && entry.key) {
          merged.set(
            entry.key,
            entry
          );
        }
      });

      found.forEach((entry, key) => {
        merged.set(key, entry);
      });

      state.entries =
        sortEntries(
          [...merged.values()]
        );
    }

    const knownKeys =
      new Set(
        state.entries.map(
          entry => entry.key
        )
      );

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
   * =========================================================
   * RECORDING CARD DETECTION
   * =========================================================
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
              parent.querySelectorAll(
                "a[href]"
              );

            if (links.length <= 4) {
              cards.add(parent);
              break;
            }
          }

          parent =
            parent.parentElement;
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
      state.selected.includes(
        entry.key
      )
    );
  }

  /*
   * =========================================================
   * FILTERING
   * =========================================================
   *
   * We NEVER hide cards while Panopto is trying to lazy-load.
   *
   * When a selection changes:
   *
   *   1. Show all cards.
   *   2. Let Panopto load more.
   *   3. Discover new cards/classes.
   *   4. Apply the filter.
   *
   * This prevents the white-space problem while preserving
   * Panopto's lazy-loading behavior.
   */

  function showAllRecordingCards() {
    findRecordingCards().forEach(card => {
      card.classList.remove(
        "pcf-filtered-out"
      );
    });
  }

  function applyFinalFilter() {
    const cards =
      findRecordingCards();

    let visibleCount = 0;

    cards.forEach(card => {
      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        visibleCount++;
        return;
      }

      const matches =
        cardMatchesSelection(card);

      if (matches) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        visibleCount++;
      } else {
        card.classList.add(
          "pcf-filtered-out"
        );
      }
    });

    updatePanel(visibleCount);
  }

  /*
   * =========================================================
   * LAZY LOADING
   * =========================================================
   */

  function getScrollableContainers() {
    const containers = new Set();

    const cards =
      findRecordingCards();

    cards
      .slice(0, 20)
      .forEach(card => {
        let element =
          card.parentElement;

        while (
          element &&
          element !== document.body &&
          element !== document.documentElement
        ) {
          const style =
            window.getComputedStyle(
              element
            );

          const scrollable =
            /(auto|scroll)/i.test(
              style.overflowY
            ) &&
            element.scrollHeight >
              element.clientHeight + 20;

          if (scrollable) {
            containers.add(element);
          }

          element =
            element.parentElement;
        }
      });

    return [...containers];
  }

  function triggerPanoptoScroll() {
    const containers =
      getScrollableContainers();

    /*
     * Internal scroll containers.
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
     * Window/document scrolling.
     */
    try {
      const height =
        Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );

      window.scrollTo({
        top: height,
        behavior: "instant"
      });

      window.dispatchEvent(
        new Event("scroll")
      );
    } catch (_) {}
  }

  function waitForRecordingChange(
    previousCount,
    timeout = 1500
  ) {
    return new Promise(resolve => {
      const started =
        Date.now();

      const check = () => {
        const currentCount =
          findRecordingCards().length;

        if (
          currentCount >
          previousCount
        ) {
          resolve(true);
          return;
        }

        if (
          Date.now() - started >=
          timeout
        ) {
          resolve(false);
          return;
        }

        setTimeout(
          check,
          100
        );
      };

      check();
    });
  }

  async function loadMorePanoptoRecordings() {
    if (loadingMore) {
      return;
    }

    loadingMore = true;

    try {
      /*
       * VERY IMPORTANT:
       *
       * Panopto gets its full normal layout back before
       * we attempt to load anything.
       */
      showAllRecordingCards();

      await new Promise(resolve =>
        requestAnimationFrame(resolve)
      );

      let previousCount =
        findRecordingCards().length;

      /*
       * Several passes allow Panopto to load multiple
       * batches instead of only one.
       */
      for (
        let pass = 0;
        pass < 8;
        pass++
      ) {
        triggerPanoptoScroll();

        await waitForRecordingChange(
          previousCount,
          1400
        );

        const currentCount =
          findRecordingCards().length;

        if (
          currentCount >
          previousCount
        ) {
          previousCount =
            currentCount;

          /*
           * Newly added recordings can contain new
           * course labels, so discover again.
           */
          discoverEntries({
            save: true
          });

          continue;
        }

        /*
         * Give Panopto one additional opportunity.
         */
        triggerPanoptoScroll();

        await new Promise(resolve =>
          setTimeout(resolve, 500)
        );

        const retryCount =
          findRecordingCards().length;

        if (
          retryCount >
          currentCount
        ) {
          previousCount =
            retryCount;

          discoverEntries({
            save: true
          });

          continue;
        }

        /*
         * No new recordings after two attempts.
         * Stop.
         */
        break;
      }

      /*
       * Final course scan.
       */
      discoverEntries({
        save: true
      });

    } finally {
      loadingMore = false;
    }
  }

  async function refreshRecordingsAndFilter() {
    /*
     * If filtering is disabled or nothing is selected,
     * immediately restore all cards.
     */
    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      showAllRecordingCards();

      /*
       * Still give Panopto a chance to load more.
       */
      await loadMorePanoptoRecordings();

      applyFinalFilter();
      return;
    }

    /*
     * Restore all cards before loading.
     */
    showAllRecordingCards();

    /*
     * Load more before applying the new filter.
     */
    await loadMorePanoptoRecordings();

    /*
     * Now filter the complete set.
     */
    applyFinalFilter();
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

    document.body.appendChild(
      panel
    );

    /*
     * CLOSE
     */

    document.getElementById(
      "pcf-close"
    ).onclick =
      () => {
        panel.classList.add(
          "pcf-hidden"
        );
      };

    /*
     * ENABLE/DISABLE FILTER
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

        if (!state.enabled) {
          showAllRecordingCards();
          await loadMorePanoptoRecordings();
          applyFinalFilter();
        } else {
          await refreshRecordingsAndFilter();
        }
      };

    /*
     * SEARCH
     */

    document.getElementById(
      "pcf-search"
    ).oninput =
      () => {
        updatePanel();
      };

    /*
     * NONE
     */

    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        /*
         * This restores ALL videos and allows Panopto
         * to continue loading.
         */
        await refreshRecordingsAndFilter();
      };

    /*
     * CURRENT SEMESTER
     */

    document.getElementById(
      "pcf-current-semester"
    ).onclick =
      async () => {
        const current =
          getCurrentTerm();

        state.selected =
          state.entries
            .filter(entry =>
              entry.term ===
                current.term &&
              Number(entry.year) ===
                current.year
            )
            .map(entry =>
              entry.key
            );

        await saveState();

        await refreshRecordingsAndFilter();
      };

    /*
     * USE SAVED CURRENT CLASSES
     */

    document.getElementById(
      "pcf-use-current"
    ).onclick =
      async () => {
        state.selected =
          [...state.currentClasses];

        await saveState();

        await refreshRecordingsAndFilter();
      };

    /*
     * SAVE CURRENT CLASSES
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
     * CLEAR CURRENT CLASSES
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
     * SCAN
     */

    document.getElementById(
      "pcf-refresh"
    ).onclick =
      async () => {
        const button =
          document.getElementById(
            "pcf-refresh"
          );

        button.disabled = true;
        button.textContent =
          "↻ Scanning...";

        try {
          await loadMorePanoptoRecordings();

          if (
            state.enabled &&
            state.selected.length > 0
          ) {
            applyFinalFilter();
          } else {
            showAllRecordingCards();
            updatePanel(
              findRecordingCards().length
            );
          }
        } finally {
          button.disabled = false;
          button.textContent =
            "↻ Scan";
        }
      };

    /*
     * FORGET & REDISCOVER
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
          /*
           * Completely erase remembered classes.
           */
          state.entries = [];
          state.selected = [];
          state.currentClasses = [];
          state.collapsedSemesters = {};

          await saveState();

          /*
           * Show everything before rediscovery.
           */
          showAllRecordingCards();

          /*
           * Rediscover from the currently loaded page.
           */
          discoverEntries({
            replace: true
          });

          await saveState();

          /*
           * Then allow Panopto to load more.
           */
          await loadMorePanoptoRecordings();

          updatePanel();

          if (
            state.enabled &&
            state.selected.length > 0
          ) {
            applyFinalFilter();
          }
        } finally {
          button.disabled = false;
          button.textContent =
            "↻ Forget & Rediscover";
        }
      };
  }

  /*
   * =========================================================
   * PANEL UPDATE
   * =========================================================
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
        searchInput
          ? searchInput.value
          : ""
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
          groups.set(
            group,
            []
          );
        }

        groups
          .get(group)
          .push(entry);
      });

    groups.forEach(
      (entries, semester) => {
        const semesterHeader =
          document.createElement(
            "div"
          );

        semesterHeader.className =
          "pcf-semester-header";

        const collapsed =
          !!state
            .collapsedSemesters[
              semester
            ];

        const arrow =
          collapsed
            ? "▶"
            : "▼";

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
          document.createElement(
            "div"
          );

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
          .onclick =
          async () => {
            state.collapsedSemesters[
              semester
            ] =
              !state
                .collapsedSemesters[
                semester
              ];

            await saveState();

            updatePanel(
              matchingCount
            );
          };

        /*
         * Select all in semester
         */

        semesterHeader
          .querySelector(
            ".pcf-semester-all"
          )
          .onclick =
          async () => {
            const keys =
              entries.map(
                entry =>
                  entry.key
              );

            const allSelected =
              keys.every(key =>
                state.selected.includes(
                  key
                )
              );

            if (allSelected) {
              state.selected =
                state.selected.filter(
                  key =>
                    !keys.includes(
                      key
                    )
                );
            } else {
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
            }

            await saveState();

            await refreshRecordingsAndFilter();
          };

        /*
         * Individual courses
         */

        entries.forEach(entry => {
          const label =
            document.createElement(
              "label"
            );

          label.className =
            "pcf-course";

          const checkbox =
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
          }

          checkbox.onchange =
            async () => {
              if (
                checkbox.checked
              ) {
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
                      key !==
                      entry.key
                  );
              }

              await saveState();

              /*
               * IMPORTANT:
               *
               * Restore the complete list, load more
               * recordings, then apply the new selection.
               */
              await refreshRecordingsAndFilter();
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
              document.createElement(
                "span"
              );

            star.className =
              "pcf-star";

            star.textContent =
              " ★";

            star.title =
              "Saved as a current class";

            label.appendChild(
              star
            );
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

    if (
      matchingCount === null
    ) {
      const cards =
        findRecordingCards();

      matchingCount =
        (
          !state.enabled ||
          state.selected.length === 0
        )
          ? cards.length
          : cards.filter(
              card =>
                cardMatchesSelection(
                  card
                )
            ).length;
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
        <strong>
          ${selectedCount}
        </strong>
        selected ·
        <strong>
          ${matchingCount}
        </strong>
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
        document
          .getElementById(
            "pcf-panel"
          )
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
   * =========================================================
   * MUTATION SCANNING
   * =========================================================
   *
   * We discover newly-added courses but DO NOT immediately
   * hide newly-added recording cards.
   *
   * This is critical for Panopto's lazy loader.
   */

  function rescan() {
    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(
        async () => {
          if (isScanning) {
            return;
          }

          isScanning = true;

          try {
            discoverEntries({
              save: true
            });

            updatePanel();
          } finally {
            isScanning = false;
          }
        },
        400
      );
  }

  /*
   * =========================================================
   * INITIALIZATION
   * =========================================================
   */

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    /*
     * Merge current discoveries with remembered discoveries.
     */
    discoverEntries({
      save: true
    });

    /*
     * Initially show everything.
     *
     * We do NOT immediately filter because Panopto may
     * still be building its recording list.
     */
    showAllRecordingCards();

    /*
     * Allow Panopto to finish its initial lazy loading.
     */
    setTimeout(
      async () => {
        await loadMorePanoptoRecordings();

        if (
          state.enabled &&
          state.selected.length > 0
        ) {
          applyFinalFilter();
        } else {
          showAllRecordingCards();
          updatePanel(
            findRecordingCards().length
          );
        }
      },
      800
    );

    /*
     * Watch Panopto dynamically adding recordings.
     */
    const observer =
      new MutationObserver(
        () => {
          rescan();
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    /*
     * User scrolling.
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
