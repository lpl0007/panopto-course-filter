(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV5";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  /*
   * ---------------------------------------------------------
   * COURSE / SEMESTER PARSING
   * ---------------------------------------------------------
   *
   * Recognizes:
   *
   * Fall 2026-COMP-6710-D01
   * Spring 2026-COMP-4300-001
   * Summer 2026-BUAL-2650-002
   *
   * and:
   *
   * COMP-4300-001 (Spring 2026)
   * BUAL-2650-002 (SUMMER 2026)
   */

  const FORWARD_RE =
    /\b(Fall|Spring|Summer|Winter)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

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

      const subject =
        match[3].toUpperCase();

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
      const subject =
        match[1].toUpperCase();

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
   * COURSE DISCOVERY
   * ---------------------------------------------------------
   */

  function discoverEntries() {
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

        /*
         * Don't inspect huge containers.
         * They can contain many unrelated public courses.
         */
        if (
          text.length < 8 ||
          text.length > 350
        ) {
          return;
        }

        const entries =
          parseEntries(text);

        entries.forEach(entry => {
          found.set(
            entry.key,
            entry
          );
        });
      });

    state.entries = [...found.values()]
      .sort((a, b) => {
        const ay = Number(a.year);
        const by = Number(b.year);

        if (ay !== by) {
          return by - ay;
        }

        const termOrder = {
          Fall: 4,
          Summer: 3,
          Spring: 2,
          Winter: 1
        };

        if (
          termOrder[a.term] !==
          termOrder[b.term]
        ) {
          return (
            termOrder[b.term] -
            termOrder[a.term]
          );
        }

        return a.course.localeCompare(
          b.course
        );
      });
  }

  /*
   * ---------------------------------------------------------
   * RECORDING CARD DETECTION
   * ---------------------------------------------------------
   *
   * This is intentionally based on the version that was
   * already working for you.
   */

  function findRecordingCards() {
    const cards = new Set();

    document
      .querySelectorAll("a[href]")
      .forEach(link => {
        const href =
          link.getAttribute("href") ||
          "";

        if (
          !/viewer|session/i.test(
            href
          )
        ) {
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
    if (
      state.selected.length === 0
    ) {
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
   * ---------------------------------------------------------
   * FILTERING
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   *
   * We intentionally do NOT use display:none.
   *
   * Panopto lazy-loads recordings as the page is scrolled.
   * Removing recordings from the layout can prevent Panopto
   * from loading the next batch.
   */

  function applyFilter() {
    const cards =
      findRecordingCards();

    let visibleCount = 0;

    cards.forEach(card => {
      /*
       * Clear previous filtering.
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
        /*
         * Keep card in layout for Panopto's lazy loader.
         */
        card.style.visibility =
          "hidden";

        card.style.opacity =
          "0";

        card.style.pointerEvents =
          "none";
      }
    });

    updatePanel(visibleCount);
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

    if (
      result[STORAGE_KEY]
    ) {
      Object.assign(
        state,
        result[STORAGE_KEY]
      );
    }

    /*
     * Clean saved selections that no longer exist.
     */
    state.currentClasses =
      Array.isArray(
        state.currentClasses
      )
        ? state.currentClasses
        : [];

    state.selected =
      Array.isArray(
        state.selected
      )
        ? state.selected
        : [];

    state.collapsedSemesters =
      state.collapsedSemesters || {};
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

    const month =
      now.getMonth() + 1;

    const year =
      now.getFullYear();

    /*
     * Jan-May  = Spring
     * Jun-Jul  = Summer
     * Aug-Dec  = Fall
     */

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

    document.getElementById(
      "pcf-enabled"
    ).checked =
      state.enabled;

    document.getElementById(
      "pcf-enabled"
    ).onchange =
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

        applyFilter();
      };

    /*
     * CURRENT SEMESTER
     *
     * Select every course in the current semester.
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

        applyFilter();
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

        applyFilter();
      };

    /*
     * SAVE SELECTED AS CURRENT
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
     * CLEAR SAVED CURRENT CLASSES
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
      () => {
        discoverEntries();

        applyFilter();
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

    const search =
      normalize(
        document.getElementById(
          "pcf-search"
        ).value
      ).toUpperCase();

    list.innerHTML = "";

    /*
     * Group entries by semester.
     */

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

    /*
     * Render each semester.
     */

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
         * Select all courses in semester
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

            applyFilter();
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

          /*
           * Mark saved current classes.
           */

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

              applyFilter();
            };

          label.append(
            checkbox,
            document.createTextNode(
              entry.course
            )
          );

          /*
           * Small star for saved current classes.
           */

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

    /*
     * Bottom statistics.
     */

    if (
      matchingCount === null
    ) {
      matchingCount =
        countMatchingCards();
    }

    const selectedCount =
      state.selected.length;

    const currentCount =
      state.currentClasses.length;

    const countElement =
      document.getElementById(
        "pcf-count"
      );

    countElement.innerHTML =
      `
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
   * ---------------------------------------------------------
   * CONTINUOUS SCANNING
   * ---------------------------------------------------------
   *
   * Panopto loads recordings dynamically as you scroll.
   */

  let scanTimer;

  function rescan() {
    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(() => {
        discoverEntries();

        applyFilter();
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

    discoverEntries();

    applyFilter();

    /*
     * Watch for Panopto dynamically adding recordings.
     */

    const observer =
      new MutationObserver(
        rescan
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

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
