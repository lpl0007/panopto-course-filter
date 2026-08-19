(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV10";

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

  // ============================================================
  // COURSE PARSING
  // Auburn: Fall / Spring / Summer only
  // ============================================================

  const FORWARD_RE =
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;

  const REVERSE_RE =
    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi;

  function normalize(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  function semesterKey(entry) {
    return `${entry.term} ${entry.year}`;
  }

  function parseEntries(text) {
    const results = [];

    text = normalize(text);

    let match;

    FORWARD_RE.lastIndex = 0;

    while ((match = FORWARD_RE.exec(text))) {
      const term =
        match[1][0].toUpperCase() +
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

      const number =
        match[2];

      const section =
        match[3]
          ? match[3].toUpperCase()
          : "";

      const term =
        match[4][0].toUpperCase() +
        match[4].slice(1).toLowerCase();

      const year =
        match[5];

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

  function sortEntries(entries) {
    const termOrder = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return [...entries].sort((a, b) => {
      const ay = Number(a.year);
      const by = Number(b.year);

      if (ay !== by) return by - ay;

      const at = termOrder[a.term] || 0;
      const bt = termOrder[b.term] || 0;

      if (at !== bt) return bt - at;

      return a.course.localeCompare(b.course);
    });
  }

  // ============================================================
  // STORAGE
  // ============================================================

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

    // Remove Winter/anything else from old versions.
    state.entries =
      state.entries.filter(entry =>
        entry.term === "Fall" ||
        entry.term === "Spring" ||
        entry.term === "Summer"
      );

    const valid =
      new Set(
        state.entries.map(
          entry => entry.key
        )
      );

    state.selected =
      state.selected.filter(
        key => valid.has(key)
      );

    state.currentClasses =
      state.currentClasses.filter(
        key => valid.has(key)
      );
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

  // ============================================================
  // DISCOVERY
  // ============================================================

  async function discoverEntries({
    replace = false
  } = {}) {
    const found = new Map();

    const scanText = text => {
      parseEntries(text).forEach(entry => {
        found.set(entry.key, entry);
      });
    };

    // Individual elements first.
    document
      .querySelectorAll(
        "a,span,p,div,li,td,button,[role='treeitem']"
      )
      .forEach(el => {
        const text =
          normalize(
            el.innerText ||
            el.textContent
          );

        if (
          text.length >= 8 &&
          text.length <= 1000
        ) {
          scanText(text);
        }
      });

    // Whole page as a fallback.
    scanText(
      normalize(
        document.body?.innerText || ""
      )
    );

    const combined =
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
      (entry, key) =>
        combined.set(key, entry)
    );

    state.entries =
      sortEntries(
        [...combined.values()]
      );

    await saveState();

    return found.size;
  }

  // ============================================================
  // CLEAR EVERYTHING
  // ============================================================

  async function clearAllCourses() {
    state.entries = [];
    state.selected = [];
    state.currentClasses = [];
    state.collapsedSemesters = {};

    await saveState();

    restoreAllRecordingElements();

    await sleep(100);

    await discoverEntries({
      replace: true
    });

    restoreAllRecordingElements();

    applyFilter();

    updatePanel();

    showStatus(
      `Course list cleared and rebuilt. ${state.entries.length} courses discovered.`
    );
  }

  // ============================================================
  // RECORDING DETECTION
  //
  // This is the major fix.
  //
  // We no longer require BOTH:
  //   - viewer/session href
  //   - course text inside same card
  //
  // Instead we find likely recording/list items and then look
  // upward through their ancestors for course information.
  // ============================================================

  function isVisibleElement(el) {
    if (!el) return false;

    const rect =
      el.getBoundingClientRect();

    if (
      rect.width < 80 ||
      rect.height < 40
    ) {
      return false;
    }

    const style =
      getComputedStyle(el);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  function looksLikeRecordingLink(link) {
    const href =
      link.getAttribute("href") || "";

    const text =
      normalize(
        link.innerText ||
        link.textContent
      );

    const aria =
      normalize(
        link.getAttribute("aria-label")
      );

    const title =
      normalize(
        link.getAttribute("title")
      );

    const combined =
      `${href} ${text} ${aria} ${title}`;

    // Strong Panopto URL indicators.
    if (
      /\/Panopto\/Pages\/Viewer\.aspx/i.test(href) ||
      /\/Viewer\.aspx/i.test(href) ||
      /\/Pages\/Viewer/i.test(href)
    ) {
      return true;
    }

    // Generic Panopto viewer/session routes.
    if (
      /viewer|session/i.test(href) &&
      text.length > 0
    ) {
      return true;
    }

    // Common recording accessibility/title text.
    if (
      /\b(play|watch|recording|video|session)\b/i.test(
        combined
      ) &&
      text.length > 0
    ) {
      return true;
    }

    return false;
  }

  function getRecordingRoot(link) {
    let current = link;

    let best = null;
    let bestScore = -Infinity;

    for (
      let depth = 0;
      depth < 12 && current;
      depth++
    ) {
      const text =
        normalize(
          current.innerText ||
          current.textContent
        );

      const rect =
        current.getBoundingClientRect();

      if (
        rect.width < 120 ||
        rect.height < 50
      ) {
        current =
          current.parentElement;

        continue;
      }

      const links =
        current.querySelectorAll(
          "a"
        ).length;

      const buttons =
        current.querySelectorAll(
          "button"
        ).length;

      let score = 0;

      // Prefer reasonably sized cards.
      if (
        rect.width >= 180 &&
        rect.width <= 1000
      ) {
        score += 3;
      }

      if (
        rect.height >= 70 &&
        rect.height <= 700
      ) {
        score += 3;
      }

      // A recording card normally has only a few links.
      if (links <= 8) {
        score += 2;
      }

      if (buttons <= 8) {
        score += 1;
      }

      // Avoid grabbing giant page containers.
      if (
        rect.width >
          window.innerWidth * 0.95 &&
        rect.height >
          window.innerHeight * 0.95
      ) {
        score -= 8;
      }

      if (text.length > 2500) {
        score -= 6;
      }

      // Course text is a very strong signal.
      if (
        parseEntries(text).length
      ) {
        score += 8;
      }

      if (score > bestScore) {
        bestScore = score;
        best = current;
      }

      current =
        current.parentElement;
    }

    return best || link.parentElement;
  }

  function findRecordingElements() {
    const results = new Set();

    /*
     * First: actual links.
     */
    document
      .querySelectorAll(
        "a[href]"
      )
      .forEach(link => {
        if (
          looksLikeRecordingLink(
            link
          )
        ) {
          const root =
            getRecordingRoot(
              link
            );

          if (
            root &&
            isVisibleElement(root)
          ) {
            results.add(root);
          }
        }
      });

    /*
     * Second: elements with explicit Panopto-ish attributes.
     */
    document
      .querySelectorAll(
        "[data-testid],[data-automation-id],[aria-label],[role]"
      )
      .forEach(el => {
        const attrs =
          [
            el.getAttribute(
              "data-testid"
            ),
            el.getAttribute(
              "data-automation-id"
            ),
            el.getAttribute(
              "aria-label"
            ),
            el.getAttribute(
              "role"
            )
          ]
            .filter(Boolean)
            .join(" ");

        if (
          /\b(session|recording|video|viewer|play)\b/i.test(
            attrs
          )
        ) {
          const root =
            getRecordingRoot(
              el
            );

          if (
            root &&
            isVisibleElement(root)
          ) {
            results.add(root);
          }
        }
      });

    return [...results];
  }

  // ============================================================
  // COURSE CONTEXT
  //
  // Search the recording and its ancestors.
  // ============================================================

  function getCourseContext(element) {
    const entries =
      new Map();

    let current = element;

    for (
      let depth = 0;
      depth < 12 && current;
      depth++
    ) {
      const text =
        normalize(
          current.innerText ||
          current.textContent
        );

      if (
        text.length <= 5000
      ) {
        parseEntries(text)
          .forEach(entry =>
            entries.set(
              entry.key,
              entry
            )
          );
      }

      current =
        current.parentElement;
    }

    return [
      ...entries.values()
    ];
  }

  function getElementEntries(element) {
    return getCourseContext(
      element
    );
  }

  // ============================================================
  // MATCHING
  // ============================================================

  function cardMatchesSelection(
    element
  ) {
    const entries =
      getElementEntries(
        element
      );

    /*
     * IMPORTANT:
     *
     * If Panopto hasn't exposed course metadata on this
     * recording, DO NOT hide it.
     *
     * This prevents Shared with Me from becoming blank.
     */
    if (
      entries.length === 0
    ) {
      return true;
    }

    return entries.some(
      entry =>
        state.selected.includes(
          entry.key
        )
    );
  }

  // ============================================================
  // RESTORE
  // ============================================================

  function restoreAllRecordingElements() {
    findRecordingElements()
      .forEach(element => {
        element.style.removeProperty(
          "display"
        );

        element.style.removeProperty(
          "visibility"
        );

        element.style.removeProperty(
          "opacity"
        );

        element.style.removeProperty(
          "pointer-events"
        );

        element.removeAttribute(
          "hidden"
        );

        element.classList.remove(
          "pcf-filter-hidden"
        );
      });
  }

  // ============================================================
  // FILTER
  // ============================================================

  function applyFilter() {
    /*
     * Never filter while Panopto is still loading recordings.
     */
    if (
      state.loadingMatches
    ) {
      return;
    }

    /*
     * Always start by restoring everything.
     */
    restoreAllRecordingElements();

    /*
     * Empty selection means SHOW EVERYTHING.
     */
    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      updatePanel();

      return;
    }

    const recordings =
      findRecordingElements();

    let visible = 0;

    recordings.forEach(
      element => {
        const entries =
          getElementEntries(
            element
          );

        /*
         * Unknown course = leave visible.
         */
        if (
          entries.length === 0
        ) {
          return;
        }

        const matches =
          entries.some(
            entry =>
              state.selected.includes(
                entry.key
              )
          );

        if (matches) {
          element.style.display = "";
          visible++;
        } else {
          element.classList.add(
            "pcf-filter-hidden"
          );

          element.style.display =
            "none";
        }
      }
    );

    updatePanel(
      visible
    );
  }

  // ============================================================
  // CURRENT SEMESTER
  // ============================================================

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

  // ============================================================
  // SCROLLING / LAZY LOADING
  // ============================================================

  function getScrollableContainers() {
    const results = [];

    document
      .querySelectorAll(
        "body,main,section,div,ul,ol"
      )
      .forEach(el => {
        if (!el) return;

        const style =
          getComputedStyle(el);

        const vertical =
          (
            style.overflowY === "auto" ||
            style.overflowY === "scroll" ||
            style.overflowY === "overlay"
          ) &&
          el.scrollHeight >
            el.clientHeight + 100;

        if (vertical) {
          results.push(el);
        }
      });

    results.sort(
      (a, b) =>
        (
          b.clientWidth *
          b.clientHeight
        ) -
        (
          a.clientWidth *
          a.clientHeight
        )
    );

    return results;
  }

  function scrollToBottomEverywhere() {
    window.scrollTo({
      top:
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        ),
      behavior: "instant"
    });

    getScrollableContainers()
      .forEach(el => {
        try {
          el.scrollTop =
            el.scrollHeight;
        } catch (_) {}
      });
  }

  async function loadMatchingRecordings() {
    if (
      state.loadingMatches
    ) {
      return;
    }

    /*
     * Nothing selected: don't load/filter anything.
     */
    if (
      state.selected.length === 0
    ) {
      restoreAllRecordingElements();

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
     * Remove our filtering while Panopto loads more.
     */
    restoreAllRecordingElements();

    let lastCount =
      findRecordingElements().length;

    let unchanged =
      0;

    try {
      for (
        let i = 0;
        i < 60;
        i++
      ) {
        if (
          !state.loadingMatches
        ) {
          break;
        }

        restoreAllRecordingElements();

        scrollToBottomEverywhere();

        await sleep(800);
        await sleep(800);

        /*
         * New DOM may have revealed new courses.
         */
        await discoverEntries();

        const count =
          findRecordingElements().length;

        updateLoadingUI(
          i + 1,
          count
        );

        if (
          count > lastCount
        ) {
          lastCount = count;
          unchanged = 0;
        } else {
          unchanged++;
        }

        /*
         * Seven consecutive rounds without a new
         * recording is a reasonable stopping point.
         */
        if (
          unchanged >= 7
        ) {
          break;
        }
      }
    } finally {
      state.loadingMatches =
        false;

      await discoverEntries();

      /*
       * Only NOW apply the filter.
       */
      applyFilter();

      updateLoadingUI();

      showStatus(
        `Finished loading. ${findRecordingElements().length} recordings detected.`
      );
    }
  }

  function stopLoading() {
    state.loadingMatches =
      false;

    restoreAllRecordingElements();

    applyFilter();

    updateLoadingUI();

    showStatus(
      "Loading stopped."
    );
  }

  // ============================================================
  // STATUS
  // ============================================================

  let statusTimer = null;

  function showStatus(message) {
    const el =
      document.getElementById(
        "pcf-status"
      );

    if (!el) return;

    el.textContent =
      message;

    el.classList.add(
      "pcf-status-visible"
    );

    clearTimeout(
      statusTimer
    );

    statusTimer =
      setTimeout(() => {
        el.classList.remove(
          "pcf-status-visible"
        );
      }, 5000);
  }

  // ============================================================
  // PANEL
  // ============================================================

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
        Select semester/course sections.
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

    document.getElementById(
      "pcf-close"
    ).onclick = () => {
      panel.classList.add(
        "pcf-hidden"
      );
    };

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

        if (
          !state.enabled
        ) {
          restoreAllRecordingElements();
        }

        applyFilter();
      };

    document.getElementById(
      "pcf-search"
    ).oninput = () =>
      updatePanel();

    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        restoreAllRecordingElements();

        applyFilter();

        showStatus(
          "No courses selected — showing all recordings."
        );
      };

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
          [...state.currentClasses];

        await saveState();

        if (
          state.selected.length === 0
        ) {
          restoreAllRecordingElements();
        }

        applyFilter();
      };

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
          `Scan complete. ${state.entries.length} courses discovered.`
        );
      };

    document.getElementById(
      "pcf-clear-discovered"
    ).onclick =
      async () => {
        if (
          !confirm(
            "Clear ALL courses and saved Current Classes?\n\nThe extension will immediately scan this Panopto page and rebuild the list."
          )
        ) {
          return;
        }

        await clearAllCourses();
      };

    updateLoadingUI();
  }

  // ============================================================
  // PANEL UPDATE
  // ============================================================

  function updatePanel(
    recordingCount = null
  ) {
    const list =
      document.getElementById(
        "pcf-course-list"
      );

    if (!list) return;

    const searchInput =
      document.getElementById(
        "pcf-search"
      );

    const search =
      normalize(
        searchInput?.value || ""
      ).toUpperCase();

    list.innerHTML = "";

    const groups =
      new Map();

    state.entries
      .filter(entry => {
        if (!search) return true;

        return entryLabel(entry)
          .toUpperCase()
          .includes(search);
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
        const header =
          document.createElement(
            "div"
          );

        header.className =
          "pcf-semester-header";

        const collapsed =
          !!state.collapsedSemesters[
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

        header
          .querySelector(
            ".pcf-semester-toggle"
          )
          .onclick =
          async () => {
            state.collapsedSemesters[
              semester
            ] =
              !state.collapsedSemesters[
                semester
              ];

            await saveState();

            updatePanel(
              recordingCount
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
              keys.every(
                key =>
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

            if (
              state.selected.length === 0
            ) {
              restoreAllRecordingElements();
            }

            applyFilter();
          };

        entries.forEach(entry => {
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

              if (
                state.selected.length === 0
              ) {
                restoreAllRecordingElements();
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
      recordingCount === null
    ) {
      recordingCount =
        findRecordingElements().length;
    }

    const count =
      document.getElementById(
        "pcf-count"
      );

    count.innerHTML = `
      <div>
        <strong>${state.selected.length}</strong>
        selected ·
        <strong>${recordingCount}</strong>
        recordings detected
      </div>

      <div class="pcf-database-count">
        ${state.entries.length}
        discovered courses
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

    updateLoadingUI();
  }

  // ============================================================
  // LOADING BUTTON
  // ============================================================

  function updateLoadingUI(
    round = 0,
    count = null
  ) {
    const button =
      document.getElementById(
        "pcf-load-matching"
      );

    if (!button) return;

    if (
      state.loadingMatches
    ) {
      button.textContent =
        count === null
          ? "⏳ Loading recordings..."
          : `⏳ Loading... ${count} detected`;

      button.onclick =
        stopLoading;

      return;
    }

    button.textContent =
      "🔎 Load Matching Recordings";

    button.onclick =
      loadMatchingRecordings;
  }

  // ============================================================
  // LAUNCHER
  // ============================================================

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

  // ============================================================
  // RESCAN
  // ============================================================

  function scheduleRescan(
    delay = 500
  ) {
    if (
      state.scanQueued ||
      state.loadingMatches
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

        /*
         * Only apply filtering if we're not in the middle
         * of Panopto lazy loading.
         */
        if (
          !state.loadingMatches
        ) {
          applyFilter();
        }
      },
      delay
    );
  }

  function installObservers() {
    const observer =
      new MutationObserver(
        () =>
          scheduleRescan(
            350
          )
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
      () =>
        scheduleRescan(
          500
        ),
      {
        passive: true
      }
    );

    /*
     * Attach listeners to Panopto's internal scroll areas.
     */
    setInterval(() => {
      getScrollableContainers()
        .forEach(container => {
          if (
            container.dataset
              .pcfWatching
          ) {
            return;
          }

          container.dataset
            .pcfWatching =
            "1";

          container.addEventListener(
            "scroll",
            () =>
              scheduleRescan(
                500
              ),
            {
              passive: true
            }
          );
        });
    }, 1200);
  }

  // ============================================================
  // URL / SPA WATCH
  // ============================================================

  function watchNavigation() {
    setInterval(() => {
      if (
        location.href !==
        state.lastUrl
      ) {
        state.lastUrl =
          location.href;

        /*
         * Don't clear anything when moving between
         * Home / Shared with Me / other Panopto tabs.
         */
        scheduleRescan(700);

        setTimeout(
          () => scheduleRescan(0),
          1500
        );

        setTimeout(
          () => scheduleRescan(0),
          3000
        );

        setTimeout(
          () => scheduleRescan(0),
          5000
        );
      }
    }, 500);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    await discoverEntries();

    /*
     * Don't leave stale filtering behind from a previous page.
     */
    restoreAllRecordingElements();

    applyFilter();

    installObservers();
    watchNavigation();

    setTimeout(
      () => scheduleRescan(0),
      800
    );

    setTimeout(
      () => scheduleRescan(0),
      2000
    );

    setTimeout(
      () => scheduleRescan(0),
      4000
    );

    setTimeout(
      () => scheduleRescan(0),
      7000
    );
  }

  // ============================================================
  // START
  // ============================================================

  /*
   * Don't hard-code only the Auburn hostname here.
   * Panopto can be hosted under different Auburn-related
   * routes/subdomains.
   *
   * The manifest's content_scripts match pattern is what
   * determines where this runs.
   */
  init();

})();
