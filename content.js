(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV9";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {},
    loadingMatches: false,
    scanQueued: false,
    lastUrl: location.href
  };


  // =========================================================
  // COURSE PARSING
  // Auburn uses Fall / Spring / Summer only.
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

  function sleep(ms) {
    return new Promise(resolve =>
      setTimeout(resolve, ms)
    );
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  function semesterKey(entry) {
    return `${entry.term} ${entry.year}`;
  }


  // =========================================================
  // PARSE COURSES
  // =========================================================

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
  // SORT
  // =========================================================

  function sortEntries(entries) {
    const termOrder = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return [...entries].sort(
      (a, b) => {
        const ay = Number(a.year);
        const by = Number(b.year);

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
  // COURSE DISCOVERY
  //
  // Normal scans MERGE with the database.
  //
  // Clear All uses a special fresh scan that starts empty.
  // =========================================================

  async function discoverEntries(
    options = {}
  ) {
    const {
      replace = false
    } = options;


    const found = new Map();


    /*
     * Look at normal text-bearing elements.
     */
    document
      .querySelectorAll(
        "a, span, p, div, li, td, [role='treeitem'], [class*='card'], [class*='Card']"
      )
      .forEach(element => {
        const text =
          normalize(
            element.innerText ||
            element.textContent
          );


        if (
          text.length < 8 ||
          text.length > 700
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


    /*
     * Also inspect the whole body text once. This catches
     * course names that are rendered in unusual components.
     */
    parseEntries(
      normalize(
        document.body?.innerText || ""
      )
    ).forEach(entry => {
      found.set(
        entry.key,
        entry
      );
    });


    const previous =
      replace
        ? new Map()
        : new Map(
            state.entries.map(
              entry => [
                entry.key,
                entry
              ]
            )
          );


    found.forEach(
      (entry, key) => {
        previous.set(
          key,
          entry
        );
      }
    );


    state.entries =
      sortEntries(
        [...previous.values()]
      );


    await saveState();


    return found.size;
  }


  // =========================================================
  // CLEAR ALL DISCOVERED COURSES
  // =========================================================

  async function clearAllCourses() {
    /*
     * Completely wipe the course database.
     */
    state.entries = [];

    /*
     * Also wipe selected classes and Current Classes,
     * exactly as requested.
     */
    state.selected = [];

    state.currentClasses = [];

    state.collapsedSemesters = {};


    await saveState();


    /*
     * Make absolutely sure nothing remains hidden from
     * the old filter.
     */
    restoreAllCards();


    /*
     * Now perform a genuinely fresh discovery.
     */
    await discoverEntries({
      replace: true
    });


    updatePanel();


    applyFilter();


    showStatus(
      `Course list cleared and rebuilt. ${state.entries.length} courses discovered.`
    );
  }


  // =========================================================
  // RECORDING CARD DISCOVERY
  // =========================================================

  function findRecordingCards() {
    const cards = new Set();


    /*
     * Panopto recording links generally lead to a viewer/session.
     */
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


        let parent = link;


        for (
          let i = 0;
          i < 10 && parent;
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
            rect.height > 80 &&
            rect.height < 1000 &&
            text.length >= 15 &&
            text.length < 2000
          ) {
            const links =
              parent.querySelectorAll(
                "a[href]"
              );


            if (
              links.length <= 6
            ) {
              cards.add(parent);
              break;
            }
          }


          parent =
            parent.parentElement;
        }
      });


    /*
     * Fallback for cards that use buttons or data attributes
     * rather than a normal viewer link.
     */
    document
      .querySelectorAll(
        "[data-testid*='session'], [data-testid*='Session'], [class*='session-card'], [class*='SessionCard']"
      )
      .forEach(card => {
        const rect =
          card.getBoundingClientRect();


        if (
          rect.width > 150 &&
          rect.height > 80
        ) {
          cards.add(card);
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
  // RESTORE ALL CARDS
  //
  // This is deliberately called before every "show all"
  // operation so stale display:none values cannot leave the
  // page blank.
  // =========================================================

  function restoreAllCards() {
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

        card.removeAttribute(
          "hidden"
        );

        card.classList.remove(
          "pcf-filter-hidden"
        );
      });
  }


  // =========================================================
  // FILTER
  // =========================================================

  function applyFilter() {
    /*
     * ALWAYS clear stale filtering first.
     */
    restoreAllCards();


    /*
     * Nothing selected means SHOW EVERYTHING.
     */
    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      updatePanel(
        findRecordingCards().length
      );

      return;
    }


    if (
      state.loadingMatches
    ) {
      return;
    }


    const cards =
      findRecordingCards();


    let visibleCount = 0;


    cards.forEach(card => {
      if (
        cardMatchesSelection(card)
      ) {
        card.style.display = "";
        visibleCount++;
      } else {
        card.classList.add(
          "pcf-filter-hidden"
        );

        card.style.display =
          "none";
      }
    });


    updatePanel(
      visibleCount
    );
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
     * Migrate previous versions.
     */
    if (
      !result[STORAGE_KEY]
    ) {
      const v8 =
        await chrome.storage.local.get(
          "panoptoCourseFilterV8"
        );


      if (
        v8.panoptoCourseFilterV8
      ) {
        result = {
          [STORAGE_KEY]:
            v8.panoptoCourseFilterV8
        };
      }
    }


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
     * Remove any Winter courses inherited from an older
     * version.
     */
    state.entries =
      state.entries.filter(
        entry =>
          entry.term === "Fall" ||
          entry.term === "Spring" ||
          entry.term === "Summer"
      );


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
  // FIND SCROLLABLE CONTAINERS
  //
  // This is the major change for Shared with Me.
  //
  // Panopto may put the recording list inside a scrolling
  // container instead of the browser window.
  // =========================================================

  function getScrollableContainers() {
    const containers = [];


    const elements =
      document.querySelectorAll(
        "body, main, section, div, ul, ol"
      );


    elements.forEach(element => {
      if (
        !element ||
        element === document.documentElement
      ) {
        return;
      }


      const style =
        getComputedStyle(
          element
        );


      const scrollableY =
        (
          style.overflowY === "auto" ||
          style.overflowY === "scroll" ||
          style.overflowY === "overlay"
        ) &&
        element.scrollHeight >
          element.clientHeight + 100;


      const scrollableX =
        (
          style.overflowX === "auto" ||
          style.overflowX === "scroll" ||
          style.overflowX === "overlay"
        ) &&
        element.scrollWidth >
          element.clientWidth + 100;


      if (
        scrollableY ||
        scrollableX
      ) {
        containers.push(
          element
        );
      }
    });


    /*
     * Sort the likely useful containers first:
     * larger visible containers before tiny nested ones.
     */
    containers.sort(
      (a, b) => {
        const aArea =
          a.clientWidth *
          a.clientHeight;

        const bArea =
          b.clientWidth *
          b.clientHeight;

        return bArea - aArea;
      }
    );


    return containers;
  }


  function scrollAllContainersToBottom() {
    /*
     * Browser window.
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


    /*
     * Every likely internal Panopto scrolling container.
     */
    getScrollableContainers()
      .forEach(container => {
        try {
          container.scrollTop =
            container.scrollHeight;

          container.scrollLeft =
            container.scrollWidth;
        } catch (_) {}
      });
  }


  function scrollAllContainersToTop() {
    window.scrollTo({
      top: 0,
      behavior: "instant"
    });


    getScrollableContainers()
      .forEach(container => {
        try {
          container.scrollTop = 0;
          container.scrollLeft = 0;
        } catch (_) {}
      });
  }


  // =========================================================
  // LOADING
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
      /*
       * No courses selected means there is nothing to
       * "match". Just show everything.
       */
      restoreAllCards();

      applyFilter();

      showStatus(
        "No courses selected — showing all recordings."
      );

      return;
    }


    state.loadingMatches =
      true;


    updateLoadingUI();


    /*
     * Important:
     * remove our filter before asking Panopto to load more.
     */
    restoreAllCards();


    const originalWindowScroll =
      window.scrollY;


    let previousCount =
      findRecordingCards().length;


    let unchangedRounds = 0;


    const MAX_ROUNDS = 80;


    try {
      /*
       * Start at the top so the internal list is in a
       * predictable state.
       */
      scrollAllContainersToTop();

      await sleep(500);


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
         * Make sure our filter never interferes with
         * Panopto's lazy loading.
         */
        restoreAllCards();


        /*
         * Scroll EVERY candidate container.
         */
        scrollAllContainersToBottom();


        /*
         * Multiple delays are intentional. Panopto may:
         *
         * 1. notice the scroll,
         * 2. request data,
         * 3. render new cards,
         * 4. resize the container.
         */
        await sleep(500);
        await sleep(1000);


        const currentCount =
          findRecordingCards().length;


        updateLoadingUI(
          round + 1,
          currentCount
        );


        if (
          currentCount >
          previousCount
        ) {
          previousCount =
            currentCount;

          unchangedRounds =
            0;

          /*
           * New recordings appeared.
           */
          await sleep(700);

          continue;
        }


        unchangedRounds++;


        /*
         * Hit the bottom again after a pause. This catches
         * lists that update their height asynchronously.
         */
        await sleep(700);


        if (
          unchangedRounds >= 7
        ) {
          break;
        }
      }


    } finally {
      state.loadingMatches =
        false;


      /*
       * Discover any new course labels that appeared.
       */
      await discoverEntries();


      /*
       * Apply the selected course filter ONLY after loading
       * is completely finished.
       */
      applyFilter();


      /*
       * Restore approximately the user's original position.
       */
      window.scrollTo({
        top:
          originalWindowScroll,
        behavior:
          "instant"
      });


      updateLoadingUI();


      showStatus(
        `Finished loading. ${countMatchingCards()} matching recordings found.`
      );
    }
  }


  function stopLoadingMatches() {
    state.loadingMatches =
      false;


    restoreAllCards();


    discoverEntries()
      .then(() => {
        applyFilter();
        updateLoadingUI();
      });


    showStatus(
      "Loading stopped."
    );
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
  // LOADING BUTTON UI
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

        <button
          id="pcf-clear-discovered"
          class="pcf-danger-button"
        >
          🗑 Clear All Courses
        </button>
      </div>
    `;


    document.body.appendChild(
      panel
    );


    // -------------------------------------------------------
    // Close
    // -------------------------------------------------------

    document.getElementById(
      "pcf-close"
    ).onclick =
      () => {
        panel.classList.add(
          "pcf-hidden"
        );
      };


    // -------------------------------------------------------
    // Enabled
    // -------------------------------------------------------

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


        /*
         * If disabling the filter, explicitly restore every
         * recording before updating.
         */
        if (
          !state.enabled
        ) {
          restoreAllCards();
        }


        applyFilter();
      };


    // -------------------------------------------------------
    // Search
    // -------------------------------------------------------

    document.getElementById(
      "pcf-search"
    ).oninput =
      () => {
        updatePanel();
      };


    // -------------------------------------------------------
    // None
    // -------------------------------------------------------

    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];


        await saveState();


        /*
         * Explicitly restore the cards FIRST.
         */
        restoreAllCards();


        applyFilter();


        showStatus(
          "No courses selected — showing all recordings."
        );
      };


    // -------------------------------------------------------
    // Current Semester
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Use Current
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Save Current
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Clear Saved Current
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Load
    // -------------------------------------------------------

    document.getElementById(
      "pcf-load-matching"
    ).onclick =
      loadMatchingRecordings;


    // -------------------------------------------------------
    // Scan
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // CLEAR ALL COURSES
    // -------------------------------------------------------

    document.getElementById(
      "pcf-clear-discovered"
    ).onclick =
      async () => {
        const confirmed =
          confirm(
            "Clear ALL discovered courses and saved Current Classes?\n\nThe extension will immediately scan the current Panopto page and rebuild the list from scratch."
          );


        if (!confirmed) {
          return;
        }


        await clearAllCourses();
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


        if (
          collapsed
        ) {
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


            /*
             * If the resulting selection is empty, restore
             * everything before filtering.
             */
            if (
              state.selected.length === 0
            ) {
              restoreAllCards();
            }


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


                /*
                 * Empty selection ALWAYS means show all.
                 */
                if (
                  state.selected.length === 0
                ) {
                  restoreAllCards();
                }


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


    const countElement =
      document.getElementById(
        "pcf-count"
      );


    const selectedCount =
      state.selected.length;


    const currentCount =
      state.currentClasses.length;


    countElement.innerHTML = `
      <div>
        <strong>${selectedCount}</strong>
        selected ·
        <strong>${matchingCount}</strong>
        recordings
      </div>

      <div class="pcf-database-count">
        ${state.entries.length}
        discovered courses
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
        const panel =
          document.getElementById(
            "pcf-panel"
          );


        panel.classList.remove(
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
      state.loadingMatches ||
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
           * Do not clear the course database when changing
           * Panopto tabs.
           */
          scheduleRescan(700);


          /*
           * Shared with Me can render asynchronously.
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
     * Initial course discovery.
     */
    await discoverEntries();


    /*
     * Start with a clean visual state.
     */
    restoreAllCards();


    applyFilter();


    /*
     * Watch Panopto's SPA-rendered content.
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
     * Scrolling can expose more course/recording information.
     */
    window.addEventListener(
      "scroll",
      rescan,
      {
        passive: true
      }
    );


    /*
     * Watch internal scrolling containers too.
     */
    setInterval(
      () => {
        getScrollableContainers()
          .forEach(container => {
            if (
              !container.dataset
                .pcfScrollWatching
            ) {
              container.dataset
                .pcfScrollWatching =
                "1";


              container.addEventListener(
                "scroll",
                rescan,
                {
                  passive: true
                }
              );
            }
          });
      },
      1500
    );


    watchForPageChanges();


    /*
     * Delayed initial scans.
     */
    setTimeout(
      () =>
        scheduleRescan(0),
      1000
    );


    setTimeout(
      () =>
        scheduleRescan(0),
      2500
    );


    setTimeout(
      () =>
        scheduleRescan(0),
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
