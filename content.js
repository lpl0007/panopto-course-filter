(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV8";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    enabled: true,
    collapsedSemesters: {}
  };

  let scanTimer = null;
  let loadingMore = false;
  let observer = null;

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
   * DISCOVERY
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

    /*
     * Do NOT delete saved selections merely because a class
     * isn't currently rendered. Remembered classes are exactly
     * what we want to preserve across Panopto loads.
     */

    if (save) {
      saveState();
    }

    return found.size;
  }

  /*
   * =========================================================
   * RECORDING CARDS
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

            if (links.length <= 5) {
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
   * FILTER
   * =========================================================
   */

  function showEverything() {
    findRecordingCards()
      .forEach(card => {
        card.classList.remove(
          "pcf-filtered-out"
        );

        /*
         * Also clean up any styles from older versions
         * of the extension.
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
      });
  }

  function applyFilter() {
    const cards =
      findRecordingCards();

    let matching = 0;

    cards.forEach(card => {
      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        matching++;
        return;
      }

      if (
        cardMatchesSelection(card)
      ) {
        card.classList.remove(
          "pcf-filtered-out"
        );

        matching++;
      } else {
        card.classList.add(
          "pcf-filtered-out"
        );
      }
    });

    updatePanel(matching);
  }

  /*
   * =========================================================
   * FIND PANOPTO'S REAL SCROLL CONTAINER
   * =========================================================
   */

  function getScrollContainers() {
    const result = [];
    const seen = new Set();

    function add(element) {
      if (!element) {
        return;
      }

      if (seen.has(element)) {
        return;
      }

      seen.add(element);
      result.push(element);
    }

    /*
     * First inspect ancestors of recording cards.
     */
    const cards =
      findRecordingCards();

    cards.slice(0, 50)
      .forEach(card => {
        let el =
          card.parentElement;

        while (
          el &&
          el !== document.body &&
          el !== document.documentElement
        ) {
          const style =
            getComputedStyle(el);

          const overflow =
            style.overflowY;

          const scrollable =
            (
              overflow === "auto" ||
              overflow === "scroll" ||
              overflow === "overlay"
            ) &&
            el.scrollHeight >
              el.clientHeight + 30;

          if (scrollable) {
            add(el);
          }

          el =
            el.parentElement;
        }
      });

    /*
     * Then inspect the whole document for scrollable elements.
     *
     * Panopto sometimes changes which element owns the
     * scrolling after navigating between pages.
     */
    document
      .querySelectorAll("*")
      .forEach(el => {
        if (
          result.length >= 8
        ) {
          return;
        }

        const style =
          getComputedStyle(el);

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
          el.scrollHeight >
          el.clientHeight + 300
        ) {
          add(el);
        }
      });

    /*
     * Always include window/document.
     */
    add(document.scrollingElement);

    return result;
  }

  /*
   * =========================================================
   * MUTATION WAIT
   * =========================================================
   */

  function waitForDOMChange(
    oldSignature,
    timeout = 1000
  ) {
    return new Promise(resolve => {
      let finished = false;

      const finish = changed => {
        if (finished) {
          return;
        }

        finished = true;

        if (localObserver) {
          localObserver.disconnect();
        }

        resolve(changed);
      };

      const localObserver =
        new MutationObserver(() => {
          finish(true);
        });

      localObserver.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );

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

  function getPageSignature() {
    const cards =
      findRecordingCards();

    /*
     * A signature based on card count + text allows us to
     * detect both newly-created cards and cards whose content
     * has changed.
     */
    let signature =
      `${cards.length}|`;

    cards.slice(-10)
      .forEach(card => {
        signature +=
          normalize(
            card.innerText ||
            card.textContent
          ).slice(0, 100) +
          "|";
      });

    return signature;
  }

  /*
   * =========================================================
   * GRADUAL SCROLLING
   * =========================================================
   *
   * This is the important part.
   *
   * Do NOT jump straight to scrollHeight.
   *
   * Panopto's lazy loader may use IntersectionObserver and
   * expects its sentinel to actually travel through the
   * viewport.
   * =========================================================
   */

  async function graduallyScrollContainer(
    container
  ) {
    const isDocument =
      container ===
      document.scrollingElement;

    let oldSignature =
      getPageSignature();

    let stableAtBottom = 0;

    const MAX_STEPS = 80;
    const STEP = 550;

    for (
      let step = 0;
      step < MAX_STEPS;
      step++
    ) {
      const beforeHeight =
        isDocument
          ? Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            )
          : container.scrollHeight;

      const beforePosition =
        isDocument
          ? window.scrollY
          : container.scrollTop;

      const maxScroll =
        Math.max(
          0,
          beforeHeight -
            (
              isDocument
                ? window.innerHeight
                : container.clientHeight
            )
        );

      const nextPosition =
        Math.min(
          maxScroll,
          beforePosition + STEP
        );

      if (
        nextPosition <=
        beforePosition + 2
      ) {
        stableAtBottom++;

        if (
          stableAtBottom >= 3
        ) {
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, 250)
        );

        continue;
      }

      stableAtBottom = 0;

      if (isDocument) {
        window.scrollTo(
          0,
          nextPosition
        );

        /*
         * Panopto/listeners may be listening specifically
         * for scroll events.
         */
        window.dispatchEvent(
          new Event("scroll", {
            bubbles: false
          })
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
       * Give IntersectionObserver and Panopto's React code
       * time to process the new viewport.
       */
      await new Promise(resolve =>
        setTimeout(resolve, 180)
      );

      /*
       * Wait briefly for a recording batch.
       */
      const changed =
        await waitForDOMChange(
          oldSignature,
          550
        );

      const newSignature =
        getPageSignature();

      if (changed) {
        oldSignature =
          newSignature;

        discoverEntries({
          save: true
        });
      }

      /*
       * Recalculate because Panopto may have increased the
       * scroll height while we were waiting.
       */
      const afterHeight =
        isDocument
          ? Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            )
          : container.scrollHeight;

      const afterPosition =
        isDocument
          ? window.scrollY
          : container.scrollTop;

      if (
        afterPosition >=
        afterHeight -
        (
          isDocument
            ? window.innerHeight
            : container.clientHeight
        ) -
        10
      ) {
        /*
         * We are at the current bottom. Panopto may still
         * append another batch after a delay.
         */
        await new Promise(resolve =>
          setTimeout(resolve, 500)
        );

        const newerHeight =
          isDocument
            ? Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              )
            : container.scrollHeight;

        if (
          newerHeight >
          afterHeight + 20
        ) {
          oldSignature =
            getPageSignature();

          continue;
        }

        stableAtBottom++;

        if (
          stableAtBottom >= 3
        ) {
          break;
        }
      }
    }
  }

  /*
   * =========================================================
   * LOAD EVERYTHING PANOPTO WILL LOAD
   * =========================================================
   */

  async function loadMoreRecordings() {
    if (loadingMore) {
      return;
    }

    loadingMore = true;

    try {
      /*
       * Absolutely critical:
       *
       * Remove our filtering before scrolling so Panopto sees
       * its entire recording list and its lazy-load sentinel.
       */
      showEverything();

      await new Promise(resolve =>
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        })
      );

      /*
       * Discover what is already on screen.
       */
      discoverEntries({
        save: true
      });

      /*
       * Find likely scrolling elements.
       */
      let containers =
        getScrollContainers();

      /*
       * If we couldn't identify a special container, use
       * document scrolling.
       */
      if (
        containers.length === 0
      ) {
        containers = [
          document.scrollingElement
        ];
      }

      /*
       * Sort the containers so the largest scroll area is
       * processed first.
       */
      containers.sort((a, b) => {
        const ah =
          a === document.scrollingElement
            ? document.documentElement.scrollHeight
            : a.scrollHeight;

        const bh =
          b === document.scrollingElement
            ? document.documentElement.scrollHeight
            : b.scrollHeight;

        return bh - ah;
      });

      /*
       * Process the most likely containers.
       *
       * Usually the first one is enough, but Panopto's layout
       * can have nested scrolling regions.
       */
      for (
        const container of containers.slice(
          0,
          3
        )
      ) {
        await graduallyScrollContainer(
          container
        );

        discoverEntries({
          save: true
        });
      }

      /*
       * One final scroll-to-bottom event.
       */
      const scrollElement =
        document.scrollingElement;

      if (scrollElement) {
        window.scrollTo(
          0,
          scrollElement.scrollHeight
        );

        window.dispatchEvent(
          new Event("scroll")
        );

        await new Promise(resolve =>
          setTimeout(resolve, 800)
        );
      }

      /*
       * Final discovery.
       */
      discoverEntries({
        save: true
      });

    } finally {
      loadingMore = false;
    }
  }

  /*
   * =========================================================
   * REFRESH AFTER SELECTION CHANGE
   * =========================================================
   */

  async function refreshAfterSelectionChange() {
    /*
     * First make the whole Panopto list visible.
     */
    showEverything();

    /*
     * Then actually exercise Panopto's lazy loader.
     */
    await loadMoreRecordings();

    /*
     * Only AFTER lazy loading is finished do we hide
     * nonmatching cards.
     */
    applyFilter();
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
    ).onclick = () => {
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

        /*
         * Even when disabling the filter, load the rest
         * of Panopto's recordings.
         */
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

        /*
         * This is deliberately NOT just "applyFilter".
         *
         * It restores every card and runs Panopto's lazy
         * loader so additional videos appear.
         */
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
     * USE SAVED
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
           * Completely forget discovered courses.
           */
          state.entries = [];
          state.selected = [];
          state.currentClasses = [];
          state.collapsedSemesters = {};

          await saveState();

          /*
           * Restore Panopto's full layout.
           */
          showEverything();

          /*
           * Rediscover what's currently rendered.
           */
          discoverEntries({
            replace: true
          });

          await saveState();

          /*
           * Scroll through the page to force Panopto to
           * discover additional recordings/classes.
           */
          await loadMoreRecordings();

          updatePanel();

          applyFilter();
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

        groups.get(group)
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

        list.appendChild(header);

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
               * Crucial:
               *
               * Selecting a SECOND class does not merely
               * filter the videos already present. It forces
               * Panopto's lazy loader to run again first.
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

          courses.appendChild(
            label
          );
        });

        list.appendChild(
          courses
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
        state.currentClasses.length
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
   * BACKGROUND DISCOVERY
   * =========================================================
   */

  function scheduleDiscovery() {
    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(
        () => {
          discoverEntries({
            save: true
          });

          updatePanel();
        },
        500
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
     * Discover whatever is currently on the page, but merge
     * it with remembered classes.
     */
    discoverEntries({
      save: true
    });

    /*
     * DO NOT filter immediately.
     *
     * First let Panopto finish constructing its recording
     * list.
     */
    showEverything();

    /*
     * Watch Panopto add/remove recording DOM nodes.
     *
     * This observer does NOT filter cards. That is intentional.
     */
    observer =
      new MutationObserver(() => {
        scheduleDiscovery();
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    /*
     * Give Panopto time to initialize before starting our
     * own lazy-load pass.
     */
    setTimeout(
      async () => {
        await loadMoreRecordings();

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
      1200
    );

    /*
     * User scrolling should cause new classes to be remembered.
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
  }

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init();
  }
})();
