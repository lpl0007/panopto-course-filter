(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV9";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  let scanTimer = null;
  let loadingMore = false;
  let destroyed = false;

  /*
   * =========================================================
   * COURSE / SEMESTER PARSING
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

      if (
        !extensionContextIsValid()
      ) {
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
        console.warn(
          "Panopto Course Filter: extension was reloaded. Refresh the Panopto page."
        );

        destroyed = true;
        return false;
      }

      console.error(
        "Panopto Course Filter: could not load state.",
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
        console.warn(
          "Panopto Course Filter: extension was reloaded. Refresh the Panopto page."
        );

        destroyed = true;
        return false;
      }

      console.error(
        "Panopto Course Filter: could not save state.",
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

      found.forEach((entry, key) => {
        merged.set(
          key,
          entry
        );
      });

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
   *
   * We use visibility/opacity instead of display:none.
   *
   * The cards remain in the DOM and retain their layout
   * dimensions so Panopto's lazy-loading system can continue
   * working.
   * =========================================================
   */

  function showEverything() {
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
   * PAGE SIGNATURE
   * =========================================================
   */

  function getPageSignature() {
    const cards =
      findRecordingCards();

    let signature =
      `${cards.length}|`;

    cards.slice(-15)
      .forEach(card => {
        signature +=
          normalize(
            card.innerText ||
            card.textContent
          ).slice(0, 120) +
          "|";
      });

    return signature;
  }

  /*
   * =========================================================
   * SCROLL CONTAINER DETECTION
   * =========================================================
   */

  function getScrollContainers() {
    const result = [];
    const seen = new Set();

    function add(element) {
      if (!element) {
        return;
      }

      if (
        seen.has(element)
      ) {
        return;
      }

      seen.add(element);
      result.push(element);
    }

    /*
     * Look around recording cards first.
     */
    const cards =
      findRecordingCards();

    cards.slice(0, 50)
      .forEach(card => {
        let element =
          card.parentElement;

        while (
          element &&
          element !== document.body &&
          element !== document.documentElement
        ) {
          const style =
            getComputedStyle(element);

          const overflow =
            style.overflowY;

          if (
            (
              overflow === "auto" ||
              overflow === "scroll" ||
              overflow === "overlay"
            ) &&
            element.scrollHeight >
              element.clientHeight + 50
          ) {
            add(element);
          }

          element =
            element.parentElement;
        }
      });

    /*
     * Search for large scrolling containers.
     */
    document
      .querySelectorAll("*")
      .forEach(element => {
        if (
          result.length >= 10
        ) {
          return;
        }

        const style =
          getComputedStyle(element);

        const overflow =
          style.overflowY;

        if (
          overflow !== "auto" &&
          overflow !== "scroll" &&
          overflow !== "overlay"
        ) {
          return;
        }

        if (
          element.scrollHeight >
          element.clientHeight + 300
        ) {
          add(element);
        }
      });

    /*
     * Document scrolling element goes last.
     */
    add(
      document.scrollingElement
    );

    return result;
  }

  /*
   * =========================================================
   * WAIT
   * =========================================================
   */

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function waitForMutation(
    oldSignature,
    timeout = 800
  ) {
    return new Promise(resolve => {
      let finished = false;

      let localObserver = null;

      function finish(changed) {
        if (finished) {
          return;
        }

        finished = true;

        if (localObserver) {
          localObserver.disconnect();
        }

        resolve(changed);
      }

      localObserver =
        new MutationObserver(() => {
          finish(true);
        });

      try {
        localObserver.observe(
          document.body,
          {
            childList: true,
            subtree: true
          }
        );
      } catch (error) {
        finish(false);
        return;
      }

      setTimeout(() => {
        const newSignature =
          getPageSignature();

        finish(
          newSignature !==
          oldSignature
        );
      }, timeout);
    });
  }

  /*
   * =========================================================
   * GRADUAL SCROLLING
   * =========================================================
   *
   * Panopto's lazy loader often needs the loading sentinel
   * to actually pass through a viewport.
   *
   * We therefore scroll in small increments instead of
   * jumping directly to scrollHeight.
   * =========================================================
   */

  async function graduallyScrollContainer(
    container
  ) {
    if (
      destroyed ||
      !container
    ) {
      return;
    }

    const isDocument =
      container ===
      document.scrollingElement;

    const MAX_STEPS = 100;
    const STEP = 500;

    let stableAtBottom = 0;
    let oldSignature =
      getPageSignature();

    for (
      let step = 0;
      step < MAX_STEPS;
      step++
    ) {
      if (
        destroyed
      ) {
        return;
      }

      const viewportHeight =
        isDocument
          ? window.innerHeight
          : container.clientHeight;

      const scrollHeight =
        isDocument
          ? Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            )
          : container.scrollHeight;

      const currentPosition =
        isDocument
          ? window.scrollY
          : container.scrollTop;

      const maximum =
        Math.max(
          0,
          scrollHeight -
            viewportHeight
        );

      const nextPosition =
        Math.min(
          maximum,
          currentPosition + STEP
        );

      if (
        nextPosition <=
        currentPosition + 2
      ) {
        stableAtBottom++;

        /*
         * Give Panopto several chances to append another
         * batch after reaching the current bottom.
         */
        await sleep(450);

        const newHeight =
          isDocument
            ? Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              )
            : container.scrollHeight;

        if (
          newHeight >
          scrollHeight + 20
        ) {
          stableAtBottom = 0;
          oldSignature =
            getPageSignature();
          continue;
        }

        const newSignature =
          getPageSignature();

        if (
          newSignature !==
          oldSignature
        ) {
          stableAtBottom = 0;
          oldSignature =
            newSignature;

          discoverEntries({
            save: true
          });

          continue;
        }

        if (
          stableAtBottom >= 4
        ) {
          break;
        }

        continue;
      }

      stableAtBottom = 0;

      if (isDocument) {
        window.scrollTo({
          top: nextPosition,
          behavior: "auto"
        });

        window.dispatchEvent(
          new Event("scroll")
        );
      } else {
        container.scrollTop =
          nextPosition;

        container.dispatchEvent(
          new Event("scroll", {
            bubbles: true
          })
        );
      }

      /*
       * Allow IntersectionObserver, React and Panopto's
       * scroll handler to run.
       */
      await sleep(200);

      const changed =
        await waitForMutation(
          oldSignature,
          650
        );

      const newSignature =
        getPageSignature();

      if (
        changed ||
        newSignature !==
        oldSignature
      ) {
        oldSignature =
          newSignature;

        discoverEntries({
          save: true
        });
      }
    }
  }

  /*
   * =========================================================
   * LOAD MORE RECORDINGS
   * =========================================================
   */

  async function loadMoreRecordings() {
    if (
      loadingMore ||
      destroyed
    ) {
      return;
    }

    loadingMore = true;

    try {
      /*
       * NEVER leave filtered cards hidden while trying to
       * trigger Panopto's lazy loader.
       */
      showEverything();

      await sleep(100);

      discoverEntries({
        save: true
      });

      let containers =
        getScrollContainers();

      if (
        containers.length === 0
      ) {
        containers = [
          document.scrollingElement
        ];
      }

      /*
       * Largest scroll areas first.
       */
      containers.sort((a, b) => {
        const aHeight =
          a === document.scrollingElement
            ? Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              )
            : a.scrollHeight;

        const bHeight =
          b === document.scrollingElement
            ? Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              )
            : b.scrollHeight;

        return bHeight - aHeight;
      });

      /*
       * Try up to three possible scrolling containers.
       */
      for (
        const container of containers.slice(0, 3)
      ) {
        await graduallyScrollContainer(
          container
        );

        discoverEntries({
          save: true
        });
      }

      /*
       * Give the page a final opportunity to process its
       * loading sentinel.
       */
      await sleep(500);

      discoverEntries({
        save: true
      });

    } catch (error) {
      /*
       * Do not allow a failed lazy-load attempt to destroy
       * the extension.
       */
      console.warn(
        "Panopto Course Filter: lazy loading pass failed.",
        error
      );
    } finally {
      loadingMore = false;
    }
  }

  /*
   * =========================================================
   * SELECTION CHANGE
   * =========================================================
   */

  async function refreshAfterSelectionChange() {
    if (
      destroyed
    ) {
      return;
    }

    /*
     * First restore the complete list.
     */
    showEverything();

    /*
     * Then force Panopto's lazy loader to run.
     */
    await loadMoreRecordings();

    /*
     * Now apply the new selection.
     */
    if (
      state.enabled &&
      state.selected.length > 0
    ) {
      applyFilter();
    } else {
      showEverything();

      updatePanel(
        findRecordingCards().length
      );
    }
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
    ).onclick = () => {
      panel.classList.add(
        "pcf-hidden"
      );
    };

    /*
     * ENABLE/DISABLE
     */

    const enabledCheckbox =
      document.getElementById(
        "pcf-enabled"
      );

    enabledCheckbox.checked =
      state.enabled;

    enabledCheckbox.onchange =
      async event => {
        state.enabled =
          event.target.checked;

        await saveState();

        await refreshAfterSelectionChange();
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
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        await refreshAfterSelectionChange();
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

        await refreshAfterSelectionChange();
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

        await refreshAfterSelectionChange();
      };

    /*
     * SAVE SELECTED
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
          await refreshAfterSelectionChange();
        } finally {
          button.disabled = false;
          button.textContent =
            "↻ Scan";
        }
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
           * Forget discovered courses AND selections.
           */
          state.entries = [];
          state.selected = [];
          state.currentClasses = [];
          state.collapsedSemesters = {};

          await saveState();

          /*
           * Make sure Panopto has its full DOM again.
           */
          showEverything();

          /*
           * Scan current content.
           */
          discoverEntries({
            replace: true,
            save: true
          });

          /*
           * Force additional Panopto content to load.
           */
          await loadMoreRecordings();

          /*
           * Scan everything that appeared.
           */
          discoverEntries({
            save: true
          });

          updatePanel();

          showEverything();
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

        /*
         * Collapse/expand
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
         * Select all semester courses
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

            await refreshAfterSelectionChange();
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
           * Saved current class
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

              /*
               * IMPORTANT:
               *
               * Do NOT merely filter the videos currently
               * present. Restore everything and run the
               * Panopto lazy loader again.
               */
              await refreshAfterSelectionChange();
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

    button.onclick = () => {
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
   * BACKGROUND COURSE DISCOVERY
   * =========================================================
   */

  function scheduleDiscovery() {
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

        discoverEntries({
          save: true
        });

        updatePanel();
      }, 600);
  }

  /*
   * =========================================================
   * INITIALIZATION
   * =========================================================
   */

  async function init() {
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
     * Merge currently visible courses into remembered
     * courses.
     */
    discoverEntries({
      save: true
    });

    /*
     * Start with everything visible.
     *
     * This is important because hiding cards too early can
     * interfere with Panopto's lazy loader.
     */
    showEverything();

    /*
     * Watch for dynamically-created Panopto content.
     */
    const observer =
      new MutationObserver(() => {
        scheduleDiscovery();
      });

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
        "Panopto Course Filter: could not start DOM observer.",
        error
      );
    }

    /*
     * Remember courses as the user naturally scrolls.
     */
    window.addEventListener(
      "scroll",
      () => {
        scheduleDiscovery();
      },
      {
        passive: true
      }
    );

    /*
     * Let Panopto finish its own initialization first.
     */
    setTimeout(
      async () => {
        if (destroyed) {
          return;
        }

        await loadMoreRecordings();

        if (
          destroyed
        ) {
          return;
        }

        if (
          state.enabled &&
          state.selected.length > 0
        ) {
          applyFilter();
        } else {
          showEverything();

          updatePanel(
            findRecordingCards().length
          );
        }
      },
      1500
    );
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
