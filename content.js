(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV6";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {},
    loadingMatches: false
  };

  const FORWARD_RE =
    /\b(Fall|Spring|Summer|Winter)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer|Winter)\s+(\d{4})\s*\)/gi;

  /*
   * ---------------------------------------------------------
   * BASIC HELPERS
   * ---------------------------------------------------------
   */

  function normalize(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  function semesterKey(entry) {
    return `${entry.term} ${entry.year}`;
  }

  /*
   * ---------------------------------------------------------
   * COURSE PARSING
   * ---------------------------------------------------------
   */

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
   * RECORDING CARDS
   * ---------------------------------------------------------
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
   * FILTER
   * ---------------------------------------------------------
   */

  function applyFilter() {
    const cards =
      findRecordingCards();

    let visibleCount = 0;

    cards.forEach(card => {
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
         * DO NOT use display:none.
         *
         * Panopto needs these elements in the layout
         * for its lazy loader.
         */
        card.style.visibility =
          "hidden";

        card.style.opacity =
          "0";

        card.style.pointerEvents =
          "none";
      }
    });

    updatePanel(
      visibleCount
    );
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

    state.loadingMatches =
      false;
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
   * MATCHING RECORDING COUNT
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
   * AUTOMATIC LAZY LOADING
   * ---------------------------------------------------------
   *
   * Panopto normally loads more recordings when the user
   * approaches the bottom of the recording list.
   *
   * This function repeatedly moves the viewport near the
   * bottom, waits for Panopto to load more content, and
   * checks whether the number of recording cards increased.
   *
   * It stops when:
   *
   *   - no new recordings appear for several attempts
   *   - the safety limit is reached
   *   - the user cancels the operation
   *
   * We never request Panopto's API directly here.
   */

  async function loadMatchingRecordings() {
    if (state.loadingMatches) {
      return;
    }

    if (
      state.selected.length === 0
    ) {
      showStatus(
        "Select at least one course first."
      );

      return;
    }

    state.loadingMatches = true;

    updateLoadingUI();

    const originalScroll =
      window.scrollY;

    let previousCount =
      findRecordingCards().length;

    let unchangedRounds = 0;

    /*
     * Safety limit.
     *
     * This prevents an unusual Panopto page from causing
     * an endless loading loop.
     */
    const MAX_ROUNDS = 60;

    /*
     * Wait helper.
     */
    const wait = ms =>
      new Promise(resolve =>
        setTimeout(
          resolve,
          ms
        )
      );

    try {
      for (
        let round = 0;
        round < MAX_ROUNDS;
        round++
      ) {
        if (
          !state.loadingMatches
        ) {
          break;
        }

        /*
         * Re-scan before moving.
         */
        discoverEntries();
        applyFilter();

        const cardsBefore =
          findRecordingCards();

        previousCount =
          cardsBefore.length;

        /*
         * Find the lowest visible element.
         */
        const cards =
          findRecordingCards();

        if (cards.length > 0) {
          const lastCard =
            cards[cards.length - 1];

          /*
           * Put the last currently loaded recording
           * close to the viewport.
           */
          lastCard.scrollIntoView({
            behavior: "instant",
            block: "end"
          });
        } else {
          /*
           * Fallback if cards temporarily disappear.
           */
          window.scrollTo({
            top:
              document.documentElement
                .scrollHeight,
            behavior: "instant"
          });
        }

        /*
         * Give Panopto time to react to the scroll.
         */
        await wait(500);

        /*
         * Wait for dynamically added recordings.
         */
        await wait(700);

        /*
         * Check whether Panopto added anything.
         */
        discoverEntries();

        const cardsAfter =
          findRecordingCards();

        const newCount =
          cardsAfter.length;

        /*
         * Apply filtering immediately to newly loaded
         * recordings.
         */
        applyFilter();

        /*
         * Update progress.
         */
        updateLoadingUI(
          round + 1,
          newCount
        );

        if (
          newCount > previousCount
        ) {
          /*
           * Success — Panopto loaded another batch.
           */
          unchangedRounds = 0;
        } else {
          unchangedRounds++;

          /*
           * One unchanged round isn't enough to declare
           * we're finished. Panopto may simply be slow.
           */
          if (
            unchangedRounds >= 4
          ) {
            /*
             * Try one final bottom-of-page scroll.
             */
            window.scrollTo({
              top:
                document.documentElement
                  .scrollHeight,
              behavior: "instant"
            });

            await wait(1200);

            const finalCount =
              findRecordingCards().length;

            if (
              finalCount <= newCount
            ) {
              break;
            }

            unchangedRounds = 0;
          }
        }
      }
    } finally {
      state.loadingMatches =
        false;

      /*
       * Reapply the filter one final time.
       */
      discoverEntries();

      applyFilter();

      /*
       * Return the user approximately to where they were.
       */
      window.scrollTo({
        top: originalScroll,
        behavior: "instant"
      });

      updateLoadingUI();

      showStatus(
        "Finished loading available recordings."
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * CANCEL AUTOMATIC LOADING
   * ---------------------------------------------------------
   */

  function stopLoadingMatches() {
    state.loadingMatches = false;

    updateLoadingUI();

    showStatus(
      "Loading stopped."
    );
  }

  /*
   * ---------------------------------------------------------
   * STATUS MESSAGE
   * ---------------------------------------------------------
   */

  let statusTimer;

  function showStatus(message) {
    const status =
      document.getElementById(
        "pcf-status"
      );

    if (!status) {
      return;
    }

    status.textContent =
      message;

    status.classList.add(
      "pcf-status-visible"
    );

    clearTimeout(
      statusTimer
    );

    statusTimer =
      setTimeout(() => {
        status.classList.remove(
          "pcf-status-visible"
        );
      }, 4000);
  }

  /*
   * ---------------------------------------------------------
   * LOADING BUTTON UI
   * ---------------------------------------------------------
   */

  function updateLoadingUI(
    round = 0,
    count = null
  ) {
    const button =
      document.getElementById(
        "pcf-load-matching"
      );

    if (!button) {
      return;
    }

    if (
      state.loadingMatches
    ) {
      button.textContent =
        count !== null
          ? `⏳ Loading… ${count} recordings`
          : `⏳ Loading recordings…`;

      button.classList.add(
        "pcf-loading"
      );

      button.disabled = false;

      /*
       * Clicking while loading cancels it.
       */
      button.onclick =
        stopLoadingMatches;
    } else {
      button.textContent =
        "🔎 Load Matching Recordings";

      button.classList.remove(
        "pcf-loading"
      );

      button.disabled = false;

      button.onclick =
        loadMatchingRecordings;
    }
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

      <button
        id="pcf-load-matching"
        class="pcf-load-button"
      >
        🔎 Load Matching Recordings
      </button>

      <div
        id="pcf-status"
        class="pcf-status"
      ></div>

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
     * FILTER TOGGLE
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
     * USE SAVED CURRENT
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

        showStatus(
          `Saved ${state.currentClasses.length} current classes.`
        );
      };

    /*
     * CLEAR CURRENT
     */

    document.getElementById(
      "pcf-clear-current"
    ).onclick =
      async () => {
        state.currentClasses = [];

        await saveState();

        updatePanel();

        showStatus(
          "Saved current classes cleared."
        );
      };

    /*
     * LOAD MATCHING RECORDINGS
     */

    document.getElementById(
      "pcf-load-matching"
    ).onclick =
      loadMatchingRecordings;

    /*
     * SCAN
     */

    document.getElementById(
      "pcf-refresh"
    ).onclick =
      () => {
        discoverEntries();

        applyFilter();

        showStatus(
          "Scan complete."
        );
      };

    updateLoadingUI();
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
         * Collapse semester
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
         * Select/deselect entire semester
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
     * Statistics
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

    updateLoadingUI();
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
   * MUTATION / SCROLL SCANNING
   * ---------------------------------------------------------
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
     * Watch Panopto for dynamically added recordings.
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

    /*
     * Normal scrolling still works.
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
