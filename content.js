(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV11";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  let destroyed = false;
  let scanTimer = null;
  let reloadInProgress = false;
  let observer = null;

  /*
   * =========================================================
   * COURSE PARSING
   * =========================================================
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

  function extensionContextIsValid() {
    try {
      return Boolean(
        chrome &&
        chrome.runtime &&
        chrome.runtime.id
      );
    } catch (error) {
      return false;
    }
  }

  async function loadState() {
    try {
      if (!extensionContextIsValid()) {
        return false;
      }

      const result =
        await chrome.storage.local.get(
          STORAGE_KEY
        );

      if (!extensionContextIsValid()) {
        return false;
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

      return true;

    } catch (error) {
      if (
        String(error).includes(
          "Extension context invalidated"
        )
      ) {
        destroyed = true;

        console.warn(
          "Panopto Course Filter: extension was reloaded. Refresh the Panopto page."
        );

        return false;
      }

      console.error(
        "Panopto Course Filter: loadState failed.",
        error
      );

      return false;
    }
  }

  async function saveState() {
    try {
      if (
        destroyed ||
        !extensionContextIsValid()
      ) {
        return false;
      }

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

      return true;

    } catch (error) {
      if (
        String(error).includes(
          "Extension context invalidated"
        )
      ) {
        destroyed = true;

        console.warn(
          "Panopto Course Filter: extension was reloaded. Refresh the Panopto page."
        );

        return false;
      }

      console.error(
        "Panopto Course Filter: saveState failed.",
        error
      );

      return false;
    }
  }

  /*
   * =========================================================
   * COURSE DISCOVERY
   * =========================================================
   */

  function discoverEntries({
    replace = false,
    save = false
  } = {}) {
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
    } else {
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

    if (save) {
      void saveState();
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
          i < 10 && parent;
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

    return getCardEntries(card)
      .some(entry =>
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

  function clearCardFiltering() {
    findRecordingCards()
      .forEach(card => {
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
      /*
       * No filter means everything stays visible.
       */
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

      /*
       * Selected class -> visible.
       */
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

        return;
      }

      /*
       * Unselected class -> hidden, but NOT display:none.
       *
       * Keeping the card in the layout helps Panopto's
       * lazy-loading mechanism continue working.
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
    });

    updatePanel(
      matchingCount
    );
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
   *
   * A real page reload lets Panopto rebuild its own recording
   * list normally.
   *
   * The selected classes are saved first.
   *
   * On the newly loaded page, init() installs the Mutation-
   * Observer BEFORE Panopto finishes adding all recordings.
   *
   * Every newly-added batch is then filtered.
   * =========================================================
   */

  async function reloadVideos() {
    if (
      reloadInProgress ||
      destroyed
    ) {
      return;
    }

    reloadInProgress = true;

    const button =
      document.getElementById(
        "pcf-reload-videos"
      );

    if (button) {
      button.disabled = true;
      button.textContent =
        "↻ Reloading...";
    }

    try {
      await saveState();

      /*
       * Give Chrome storage time to commit.
       */
      await new Promise(resolve => {
        setTimeout(
          resolve,
          200
        );
      });

      /*
       * Reload the actual Panopto page.
       */
      window.location.reload();

    } catch (error) {
      console.error(
        "Panopto Course Filter: video reload failed.",
        error
      );

      reloadInProgress = false;

      if (button) {
        button.disabled = false;
        button.textContent =
          "↻ Reload Videos";
      }
    }
  }

  /*
   * =========================================================
   * FILTER NEWLY ADDED CARDS
   * =========================================================
   *
   * This is the important part for the reload problem.
   *
   * Panopto frequently adds recordings AFTER our initial
   * page load. MutationObserver catches those additions and
   * immediately calls applyFilter().
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
         * Remember any newly discovered courses.
         */
        discoverEntries({
          save: true
        });

        /*
         * MOST IMPORTANT:
         *
         * Re-run the filter against all recording cards,
         * including cards Panopto just created.
         */
        applyFilter();

      }, 80);
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

      <div class="pcf-video-actions">
        <button id="pcf-reload-videos">
          ↻ Reload Videos
        </button>

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
     * ENABLE/DISABLE
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
          clearCardFiltering();

          updatePanel(
            findRecordingCards().length
          );

          return;
        }

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

        /*
         * Immediately show all loaded recordings.
         */
        clearCardFiltering();

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
      };

    /*
     * CLEAR SAVED CURRENT
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
      async () => {
        await reloadVideos();
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
          /*
           * Forget discovered classes.
           */
          state.entries = [];

          /*
           * Keep selected/current classes.
           *
           * They are not automatically deleted just because
           * the discovery list was wiped.
           */
          await saveState();

          /*
           * Rediscover from the current page.
           */
          discoverEntries({
            replace: true,
            save: true
          });

          updatePanel();

        } finally {
          button.disabled = false;
          button.textContent =
            "↻ Forget & Rediscover";
        }
      };

    /*
     * SCAN
     */

    document.getElementById(
      "pcf-refresh"
    ).onclick =
      () => {
        discoverEntries({
          save: true
        });

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
    const list =
      document.getElementById(
        "pcf-course-list"
      );

    if (!list) {
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

    groups.forEach(
      (entries, semester) => {
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

          <strong>${semester}</strong>

          <button class="pcf-semester-all">
            All
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
         * Collapse
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

            updatePanel(
              matchingCount
            );
          };

        /*
         * Select all
         */

        header
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
              keys.length > 0 &&
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

              /*
               * Apply immediately to all currently loaded
               * recordings.
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
     * Recording count
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
            cardMatchesSelection(
              card
            )
          ).length;
      }
    }

    const countElement =
      document.getElementById(
        "pcf-count"
      );

    if (!countElement) {
      return;
    }

    countElement.innerHTML = `
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
        ${state.entries.length} discovered
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
   * INITIALIZATION
   * =========================================================
   */

  async function init() {
    /*
     * Load saved selections BEFORE creating the observer.
     */
    const loaded =
      await loadState();

    if (
      !loaded &&
      destroyed
    ) {
      return;
    }

    createPanel();
    createLauncher();

    /*
     * IMPORTANT:
     *
     * Start observing BEFORE doing our first scan.
     *
     * Panopto can continue adding recordings for a while
     * after document_idle.
     */
    observer =
      new MutationObserver(
        mutations => {
          let relevant = false;

          for (
            const mutation of mutations
          ) {
            if (
              mutation.type !==
              "childList"
            ) {
              continue;
            }

            if (
              mutation.addedNodes &&
              mutation.addedNodes.length
            ) {
              relevant = true;
              break;
            }
          }

          if (relevant) {
            handleDynamicContent();
          }
        }
      );

    try {
      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
    } catch (error) {
      console.warn(
        "Panopto Course Filter: MutationObserver failed.",
        error
      );
    }

    /*
     * Initial discovery.
     */
    discoverEntries({
      save: true
    });

    /*
     * Initial filter.
     */
    applyFilter();

    /*
     * Keep discovering courses as the user scrolls.
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
     * =======================================================
     * POST-LOAD FILTERING
     *
     * Panopto can populate the recording list well after
     * document_idle.
     *
     * Run repeated filters for the first 15 seconds so that
     * videos arriving after a reload cannot bypass the filter.
     * =======================================================
     */

    let attempts = 0;

    const postLoadTimer =
      setInterval(() => {
        if (
          destroyed
        ) {
          clearInterval(
            postLoadTimer
          );

          return;
        }

        attempts++;

        discoverEntries({
          save: true
        });

        applyFilter();

        if (
          attempts >= 30
        ) {
          clearInterval(
            postLoadTimer
          );
        }
      }, 500);

    /*
     * Also filter when the complete page load event fires.
     */
    window.addEventListener(
      "load",
      () => {
        if (destroyed) {
          return;
        }

        setTimeout(() => {
          discoverEntries({
            save: true
          });

          applyFilter();
        }, 300);
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
          "Panopto Course Filter: extension context was invalidated. Refresh the Panopto page."
        );

        return;
      }

      console.error(
        "Panopto Course Filter initialization failed.",
        error
      );
    });
  }
})();
