(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV8";

  const state = {
    // Persistent database of courses we've discovered.
    entries: [],

    // Courses currently selected in the filter.
    selected: [],

    // Courses saved as "Current Classes".
    currentClasses: [],

    enabled: true,

    collapsedSemesters: {},

    // True while we are intentionally forcing Panopto
    // to load more recordings.
    loadingMatches: false,

    // Prevents our observer from repeatedly doing expensive
    // work while Panopto is changing the page.
    scanQueued: false,

    // Used to notice SPA navigation.
    lastUrl: location.href
  };


  // =========================================================
  // COURSE REGEX
  //
  // Auburn uses ONLY:
  //   Fall
  //   Spring
  //   Summer
  //
  // Winter is intentionally NOT included.
  // =========================================================

  const FORWARD_RE =
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;


  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi;


  // =========================================================
  // HELPERS
  // =========================================================

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


  function sleep(ms) {
    return new Promise(resolve =>
      setTimeout(resolve, ms)
    );
  }


  // =========================================================
  // COURSE PARSING
  // =========================================================

  function parseEntries(text) {
    const results = [];

    text = normalize(text);

    let match;


    // -------------------------------------------------------
    // Fall 2025 - COMP - 5710
    // -------------------------------------------------------

    FORWARD_RE.lastIndex = 0;

    while ((match = FORWARD_RE.exec(text))) {
      const term =
        match[1].charAt(0).toUpperCase() +
        match[1].slice(1).toLowerCase();

      const year =
        match[2];

      const subject =
        match[3].toUpperCase();

      const number =
        match[4];

      const section =
        match[5]
          ? match[5].toUpperCase()
          : "";


      const course =
        `${subject}-${number}${
          section
            ? "-" + section
            : ""
        }`;


      results.push({
        key: `${term} ${year}|${course}`,
        term,
        year,
        course
      });
    }


    // -------------------------------------------------------
    // COMP - 5710 (Fall 2025)
    // -------------------------------------------------------

    REVERSE_RE.lastIndex = 0;

    while ((match = REVERSE_RE.exec(text))) {
      const subject =
        match[1].toUpperCase();

      const number =
        match[2];

      const section =
        match[3]
          ? match[3].toUpperCase()
          : "";


      const term =
        match[4].charAt(0).toUpperCase() +
        match[4].slice(1).toLowerCase();

      const year =
        match[5];


      const course =
        `${subject}-${number}${
          section
            ? "-" + section
            : ""
        }`;


      results.push({
        key: `${term} ${year}|${course}`,
        term,
        year,
        course
      });
    }


    return results;
  }


  // =========================================================
  // SORTING
  // =========================================================

  function sortEntries(entries) {
    const termOrder = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };


    return [...entries].sort(
      (a, b) => {
        const ay =
          Number(a.year);

        const by =
          Number(b.year);


        if (ay !== by) {
          return by - ay;
        }


        const at =
          termOrder[a.term] || 0;

        const bt =
          termOrder[b.term] || 0;


        if (at !== bt) {
          return bt - at;
        }


        return a.course.localeCompare(
          b.course
        );
      }
    );
  }


  // =========================================================
  // DISCOVER COURSES
  //
  // IMPORTANT:
  //
  // This MERGES courses into the persistent database.
  // It never removes courses merely because the current
  // Panopto tab doesn't happen to show them.
  // =========================================================

  async function discoverEntries() {
    const found =
      new Map();


    document
      .querySelectorAll(
        "a, span, p, [role='treeitem'], [class*='card'], [class*='Card']"
      )
      .forEach(element => {
        const text =
          normalize(
            element.innerText ||
            element.textContent
          );


        if (
          text.length < 8 ||
          text.length > 500
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


    if (
      found.size === 0
    ) {
      return 0;
    }


    const merged =
      new Map();


    state.entries.forEach(
      entry => {
        merged.set(
          entry.key,
          entry
        );
      }
    );


    found.forEach(
      (entry, key) => {
        merged.set(
          key,
          entry
        );
      }
    );


    const oldKeys =
      new Set(
        state.entries.map(
          entry => entry.key
        )
      );


    state.entries =
      sortEntries(
        [...merged.values()]
      );


    const added =
      state.entries.some(
        entry =>
          !oldKeys.has(
            entry.key
          )
      );


    if (added) {
      await saveState();
    }


    return found.size;
  }


  // =========================================================
  // RECORDING CARDS
  // =========================================================

  function findRecordingCards() {
    const cards =
      new Set();


    document
      .querySelectorAll(
        "a[href]"
      )
      .forEach(link => {
        const href =
          link.getAttribute(
            "href"
          ) || "";


        if (
          !/viewer|session/i.test(
            href
          )
        ) {
          return;
        }


        let parent =
          link;


        for (
          let i = 0;
          i < 8 && parent;
          i++
        ) {
          const text =
            normalize(
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


            if (
              links.length <= 4
            ) {
              cards.add(
                parent
              );

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


    return getCardEntries(
      card
    ).some(entry =>
      state.selected.includes(
        entry.key
      )
    );
  }


  // =========================================================
  // FILTER
  // =========================================================

  function applyFilter() {
    if (
      state.loadingMatches
    ) {
      return;
    }


    const cards =
      findRecordingCards();


    let visibleCount = 0;


    cards.forEach(card => {
      // Always reset previous filtering.
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


      if (
        cardMatchesSelection(
          card
        )
      ) {
        // Keep matching card.
        card.style.display = "";
        visibleCount++;
      } else {
        // Remove it completely from layout.
        card.style.display = "none";
      }
    });


    updatePanel(
      visibleCount
    );
  }


  // =========================================================
  // SHOW EVERYTHING
  // =========================================================

  function temporarilyShowEverything() {
    findRecordingCards()
      .forEach(card => {
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


  // =========================================================
  // STORAGE
  // =========================================================

  async function loadState() {
    let result =
      await chrome.storage.local.get(
        STORAGE_KEY
      );


    /*
     * Migrate from the previous versions.
     */
    if (
      !result[STORAGE_KEY]
    ) {
      const v7 =
        await chrome.storage.local.get(
          "panoptoCourseFilterV7"
        );


      if (
        v7.panoptoCourseFilterV7
      ) {
        result = {
          [STORAGE_KEY]:
            v7.panoptoCourseFilterV7
        };
      }
    }


    if (
      !result[STORAGE_KEY]
    ) {
      const v6 =
        await chrome.storage.local.get(
          "panoptoCourseFilterV6"
        );


      if (
        v6.panoptoCourseFilterV6
      ) {
        result = {
          [STORAGE_KEY]:
            v6.panoptoCourseFilterV6
        };
      }
    }


    if (
      result[STORAGE_KEY]
    ) {
      Object.assign(
        state,
        result[STORAGE_KEY]
      );
    }


    state.entries =
      Array.isArray(
        state.entries
      )
        ? state.entries
        : [];


    state.selected =
      Array.isArray(
        state.selected
      )
        ? state.selected
        : [];


    state.currentClasses =
      Array.isArray(
        state.currentClasses
      )
        ? state.currentClasses
        : [];


    state.collapsedSemesters =
      state.collapsedSemesters ||
      {};


    /*
     * Remove any accidental Winter entries from previous
     * versions.
     */
    state.entries =
      state.entries.filter(
        entry =>
          entry.term === "Fall" ||
          entry.term === "Spring" ||
          entry.term === "Summer"
      );


    /*
     * Remove selected/current references to Winter entries.
     */
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


    state.loadingMatches =
      false;
  }


  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        entries:
          state.entries,

        selected:
          state.selected,

        currentClasses:
          state.currentClasses,

        enabled:
          state.enabled,

        collapsedSemesters:
          state.collapsedSemesters
      }
    });
  }


  // =========================================================
  // CURRENT SEMESTER
  // =========================================================

  function getCurrentTerm() {
    const now =
      new Date();

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


  // =========================================================
  // COUNT
  // =========================================================

  function countMatchingCards() {
    const cards =
      findRecordingCards();


    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      return cards.length;
    }


    return cards.filter(
      card =>
        cardMatchesSelection(
          card
        )
    ).length;
  }


  // =========================================================
  // LOAD MATCHING RECORDINGS
  //
  // This deliberately works on the CURRENT Panopto tab.
  //
  // It does not assume that a saved course means recordings
  // are already loaded.
  // =========================================================

  async function loadMatchingRecordings() {
    if (
      state.loadingMatches
    ) {
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


    state.loadingMatches =
      true;


    updateLoadingUI();


    /*
     * Panopto needs the cards visible while it lazy-loads.
     */
    temporarilyShowEverything();


    const originalScroll =
      window.scrollY;


    const MAX_ROUNDS =
      100;


    let previousCount =
      findRecordingCards()
        .length;


    let unchangedRounds =
      0;


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
         * Make sure our filter is not hiding cards that
         * Panopto needs to see.
         */
        temporarilyShowEverything();


        /*
         * Scroll to the bottom of the CURRENT page.
         *
         * This works for Home and Shared with Me because we
         * are not navigating away from the current Panopto
         * view.
         */
        window.scrollTo({
          top:
            Math.max(
              document.documentElement
                .scrollHeight,
              document.body
                .scrollHeight
            ),

          behavior:
            "instant"
        });


        await sleep(500);


        /*
         * Give Panopto time to fetch and render recordings.
         */
        await sleep(1200);


        const newCount =
          findRecordingCards()
            .length;


        updateLoadingUI(
          round + 1,
          newCount
        );


        if (
          newCount >
          previousCount
        ) {
          previousCount =
            newCount;

          unchangedRounds =
            0;

          /*
           * New cards appeared. Give them a moment to
           * settle before another scroll.
           */
          await sleep(500);

          continue;
        }


        unchangedRounds++;


        /*
         * Panopto sometimes needs a few bottom hits before
         * deciding there is nothing else to load.
         */
        if (
          unchangedRounds >= 6
        ) {
          break;
        }


        await sleep(700);
      }


    } finally {
      state.loadingMatches =
        false;


      /*
       * Discover any course information that became visible
       * during loading, but MERGE it into the database.
       */
      await discoverEntries();


      /*
       * Now filter the recordings actually loaded in THIS tab.
       */
      applyFilter();


      window.scrollTo({
        top:
          originalScroll,

        behavior:
          "instant"
      });


      updateLoadingUI();


      showStatus(
        `Finished loading. ${countMatchingCards()} matching recordings found on this page.`
      );
    }
  }


  function stopLoadingMatches() {
    state.loadingMatches =
      false;


    discoverEntries();

    applyFilter();

    updateLoadingUI();


    showStatus(
      "Loading stopped."
    );
  }


  // =========================================================
  // STATUS
  // =========================================================

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
      setTimeout(
        () => {
          status.classList.remove(
            "pcf-status-visible"
          );
        },
        5000
      );
  }


  // =========================================================
  // LOADING UI
  // =========================================================

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
          : "⏳ Loading recordings…";


      button.classList.add(
        "pcf-loading"
      );


      button.disabled =
        false;


      button.onclick =
        stopLoadingMatches;


      return;
    }


    button.textContent =
      "🔎 Load Matching Recordings";


    button.classList.remove(
      "pcf-loading"
    );


    button.disabled =
      false;


    button.onclick =
      loadMatchingRecordings;
  }


  // =========================================================
  // PANEL
  // =========================================================

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


    document.getElementById(
      "pcf-close"
    ).onclick =
      () => {
        panel.classList.add(
          "pcf-hidden"
        );
      };


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


    document.getElementById(
      "pcf-search"
    ).oninput =
      () => {
        updatePanel();
      };


    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        applyFilter();
      };


    document.getElementById(
      "pcf-current-semester"
    ).onclick =
      async () => {
        const current =
          getCurrentTerm();


        state.selected =
          state.entries
            .filter(
              entry =>
                entry.term ===
                  current.term &&
                Number(
                  entry.year
                ) ===
                  current.year
            )
            .map(
              entry =>
                entry.key
            );


        await saveState();

        applyFilter();
      };


    document.getElementById(
      "pcf-use-current"
    ).onclick =
      async () => {
        state.selected =
          [
            ...state.currentClasses
          ];

        await saveState();

        applyFilter();
      };


    document.getElementById(
      "pcf-save-current"
    ).onclick =
      async () => {
        state.currentClasses =
          [
            ...state.selected
          ];

        await saveState();

        updatePanel();


        showStatus(
          `Saved ${state.currentClasses.length} current classes.`
        );
      };


    document.getElementById(
      "pcf-clear-current"
    ).onclick =
      async () => {
        state.currentClasses =
          [];

        await saveState();

        updatePanel();


        showStatus(
          "Saved current classes cleared."
        );
      };


    document.getElementById(
      "pcf-load-matching"
    ).onclick =
      loadMatchingRecordings;


    document.getElementById(
      "pcf-refresh"
    ).onclick =
      async () => {
        await discoverEntries();

        applyFilter();


        showStatus(
          `Scan complete. ${state.entries.length} courses in database.`
        );
      };


    updateLoadingUI();
  }


  // =========================================================
  // UPDATE PANEL
  // =========================================================

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
          label.includes(
            search
          )
        );
      })
      .forEach(entry => {
        const group =
          semesterKey(entry);


        if (
          !groups.has(group)
        ) {
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


        semesterHeader.innerHTML = `
          <button class="pcf-semester-toggle">
            ${collapsed ? "▶" : "▼"}
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


        semesterHeader
          .querySelector(
            ".pcf-semester-toggle"
          )
          .onclick =
          async () => {
            state
              .collapsedSemesters[
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
              keys.every(
                key =>
                  state.selected.includes(
                    key
                  )
              );


            if (
              allSelected
            ) {
              state.selected =
                state.selected.filter(
                  key =>
                    !keys.includes(
                      key
                    )
                );

            } else {
              keys.forEach(
                key => {
                  if (
                    !state.selected.includes(
                      key
                    )
                  ) {
                    state.selected.push(
                      key
                    );
                  }
                }
              );
            }


            await saveState();

            applyFilter();
          };


        entries.forEach(
          entry => {
            const label =
              document.createElement(
                "label"
              );


            label.className =
              "pcf-course";


            if (
              state.currentClasses.includes(
                entry.key
              )
            ) {
              label.classList.add(
                "pcf-current-class"
              );
            }


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
          }
        );


        list.appendChild(
          semesterCourses
        );
      }
    );


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
        <strong>${selectedCount}</strong>
        selected ·
        <strong>${matchingCount}</strong>
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


  // =========================================================
  // LAUNCHER
  // =========================================================

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


  // =========================================================
  // SMART RESCAN
  // =========================================================

  function scheduleRescan(
    delay = 300
  ) {
    if (
      state.loadingMatches
    ) {
      return;
    }


    if (
      state.scanQueued
    ) {
      return;
    }


    state.scanQueued =
      true;


    setTimeout(
      async () => {
        state.scanQueued =
          false;


        await discoverEntries();


        applyFilter();
      },
      delay
    );
  }


  function rescan() {
    if (
      state.loadingMatches
    ) {
      return;
    }


    scheduleRescan(300);
  }


  // =========================================================
  // WATCH SPA NAVIGATION
  // =========================================================

  function watchForPageChanges() {
    setInterval(
      () => {
        if (
          location.href !==
          state.lastUrl
        ) {
          state.lastUrl =
            location.href;


          /*
           * Give Panopto time to replace the page content.
           */
          scheduleRescan(
            700
          );


          /*
           * Shared With Me can populate asynchronously,
           * so perform several additional discovery passes.
           */
          setTimeout(
            () =>
              scheduleRescan(0),
            1500
          );


          setTimeout(
            () =>
              scheduleRescan(0),
            3000
          );


          setTimeout(
            () =>
              scheduleRescan(0),
            5000
          );
        }
      },
      500
    );
  }


  // =========================================================
  // INITIALIZATION
  // =========================================================

  async function init() {
    await loadState();


    createPanel();

    createLauncher();


    /*
     * Discover whatever courses are visible immediately.
     * These get MERGED with the existing database.
     */
    await discoverEntries();


    applyFilter();


    /*
     * Watch Panopto's dynamically rendered content.
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
     * Scrolling can expose additional course/recording data.
     */
    window.addEventListener(
      "scroll",
      rescan,
      {
        passive: true
      }
    );


    /*
     * Watch Home / Shared With Me / other SPA navigation.
     */
    watchForPageChanges();


    /*
     * Initial delayed scans.
     */
    setTimeout(
      () => scheduleRescan(0),
      1000
    );


    setTimeout(
      () => scheduleRescan(0),
      2500
    );


    setTimeout(
      () => scheduleRescan(0),
      5000
    );
  }


  // =========================================================
  // START
  // =========================================================

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init();
  }

})();
