(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV12";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
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

      return a.course.localeCompare(b.course);
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
          currentClasses: state.currentClasses,
          enabled: state.enabled,
          collapsedSemesters:
            state.collapsedSemesters
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
        /*
         * Never scan our own panel.
         */
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
        /*
         * Never treat extension UI as a recording.
         */
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
         * IMPORTANT:
         *
         * Do not use display:none.
         * The card remains in the layout so Panopto's
         * lazy loader can continue loading recordings.
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
   *
   * This prevents the MutationObserver from rebuilding the
   * panel while a checkbox is being clicked.
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

    /*
     * Save selections before the actual page reload.
     */
    await saveState();

    /*
     * Short delay to ensure storage is committed.
     */
    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );

    /*
     * Reload the actual Panopto page.
     */
    window.location.reload();
  }

  /*
   * =========================================================
   * DYNAMIC PANOPTO CONTENT
   * =========================================================
   *
   * CRITICAL:
   *
   * We do NOT call updatePanel() here.
   *
   * We only reapply the filter.
   *
   * This means Panopto can add recordings without our
   * extension rebuilding the checkbox panel.
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
         * Remember newly discovered classes.
         */
        discoverEntries();

        void saveState();

        /*
         * Filter newly added recordings.
         */
        applyFilter();

      }, 100);
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
         * Immediately reveal all loaded recordings.
         */
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

    /*
     * IMPORTANT:
     *
     * We only rebuild the course list when explicitly
     * requested by the UI.
     *
     * The MutationObserver never directly calls this.
     */

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
         * SELECT ALL
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
                    !keys.includes(key)
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
         * INDIVIDUAL COURSE
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
              /*
               * Update state FIRST.
               */
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

              /*
               * Save selection.
               */
              await saveState();

              /*
               * Filter the videos.
               *
               * DO NOT rebuild the panel here.
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
     * COUNT
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
    await loadState();

    if (destroyed) {
      return;
    }

    createPanel();
    createLauncher();

    /*
     * Install observer BEFORE discovery/filtering.
     *
     * Most importantly, the observer completely ignores
     * anything inside #pcf-panel.
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

            /*
             * Ignore mutations that belong to our panel.
             */
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

              /*
               * Ignore our own UI if it somehow appears
               * in an added subtree.
               */
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
     * Initial course discovery.
     */
    discoverEntries();

    await saveState();

    /*
     * Initial video filtering.
     */
    applyFilter();

    /*
     * Scroll handling.
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
     * Panopto may add videos for several seconds after the
     * page is loaded.
     * =======================================================
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

        /*
         * 30 × 500ms = 15 seconds.
         */
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
