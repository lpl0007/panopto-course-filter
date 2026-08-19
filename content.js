(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV13";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {},
    onlySelectedSemesters: false
  };

  let scanTimer = null;
  let panelUpdateTimer = null;
  let destroyed = false;
  let observer = null;
  let reloadingVideos = false;

  /*
   * =========================================================
   * COURSE PARSING
   * =========================================================
   *
   * Supported:
   *
   * Fall 2026-COMP-6710-D01
   * Spring 2026-COMP-4300-001
   * Summer 2026-BUAL-2650-002
   *
   * And:
   *
   * COMP-4300-001 (Spring 2026)
   *
   * Winter is intentionally NOT supported.
   * =========================================================
   */

  const FORWARD_RE =
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi;

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

      const section =
        match[5]
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

      const section =
        match[3]
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
            state.onlySelectedSemesters
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
        "a, span, p, [role='treeitem'], [class*='card'], [class*='Card']"
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
          text.length < 8 ||
          text.length > 350
        ) {
          return;
        }

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

  function findRecordingCards() {
    const cards = new Set();

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

        let parent = link;

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

          const rect =
            parent.getBoundingClientRect();

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

          parent =
            parent.parentElement;
        }
      });

    return [...cards];
  }

  function getCardEntries(card) {
    return parseEntries(
      normalize(
        card.innerText ||
        card.textContent
      )
    );
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
        /*
         * Keep the recording in the layout.
         * Never use display:none.
         */
        card.classList.add(
          "pcf-filtered-out"
        );

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
  }

  /*
   * =========================================================
   * PANEL UPDATE DEBOUNCING
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
        "saved current classes, and saved preferences."
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

    try {
      if (
        contextValid()
      ) {
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

    /*
     * Rediscover what is currently present on the page.
     */
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
      </div>

      <label class="pcf-toggle">
        <input
          id="pcf-enabled"
          type="checkbox"
        >
        Filter recordings
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

        <button id="pcf-reset">
          Reset Everything
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
          event.target.checked;

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
      () => {
        updatePanel();
      };

    /*
     * GLOBAL SELECT ALL
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

              return entryLabel(entry)
                .toUpperCase()
                .includes(search);
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

        await saveState();

        applyFilter();
      };

    /*
     * GLOBAL CLEAR ALL
     */

    document.getElementById(
      "pcf-clear-all"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        showAllCards();

        updatePanel(
          findRecordingCards().length
        );
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
     * USE CURRENT
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

          await saveState();

          discoverEntries({
            replace: true
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
     * RESET EVERYTHING
     */

    document.getElementById(
      "pcf-reset"
    ).onclick =
      () => {
        void resetEverything();
      };

    /*
     * SCAN
     */

    document.getElementById(
      "pcf-refresh"
    ).onclick =
      () => {
        discoverEntries();

        void saveState();

        applyFilter();
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
    if (destroyed) {
      return;
    }

    const panel =
      document.getElementById(
        "pcf-panel"
      );

    const list =
      document.getElementById(
        "pcf-course-list"
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

    /*
     * Group everything by semester first.
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

    /*
     * Render semesters.
     */

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

        /*
         * Hide semesters without selected classes if the
         * option is enabled.
         */
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

        const collapsed =
          !!state
            .collapsedSemesters[
              semester
            ];

        header.innerHTML = `
          <button class="pcf-semester-toggle">
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
         * COLLAPSE
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

            await saveState();

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
              );

            if (allSelected) {
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

            await saveState();

            applyFilter();
          };

        /*
         * COURSES
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
               * Do NOT rebuild the panel here.
               * This keeps checkbox interaction stable.
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

          courses.appendChild(
            label
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

    const countElement =
      document.getElementById(
        "pcf-count"
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
            entry.course
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

        /*
         * Discover newly visible classes.
         */
        discoverEntries();

        void saveState();

        /*
         * Apply the existing selection to newly loaded
         * recordings.
         */
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
     * Watch Panopto, but NEVER let mutations inside our
     * panel trigger a panel rebuild.
     */
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

    /*
     * Initial discovery.
     */
    discoverEntries();

    await saveState();

    /*
     * Initial filter.
     */
    applyFilter();

    /*
     * Scrolling can cause Panopto to add recordings.
     */
    window.addEventListener(
      "scroll",
      () => {
        handleDynamicContent();
      },
      {
        passive: true
      }
    );

    /*
     * Give Panopto time to populate the page.
     */
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

    /*
     * Full page load.
     */
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
})();
