(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV11";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    collapsedSemesters: {},
    enabled: true,
    loading: false,
    lastUrl: location.href
  };

  // ============================================================
  // COURSE PARSING
  // Auburn uses Fall / Spring / Summer only.
  // ============================================================

  const COURSE_PATTERNS = [
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi,

    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*[-–—]\s*(Fall|Spring|Summer)\s+(\d{4})\b/gi,

    /\b([A-Z]{2,8})\s+(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi
  ];

  function normalize(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCourses(text) {
    text = normalize(text);

    if (!text) {
      return [];
    }

    const found = new Map();

    for (const pattern of COURSE_PATTERNS) {
      pattern.lastIndex = 0;

      let m;

      while ((m = pattern.exec(text))) {
        let term;
        let year;
        let subject;
        let number;
        let section;

        /*
         * Pattern 1:
         * Fall 2025 - COMP - 4300
         */
        if (
          /Fall|Spring|Summer/i.test(m[1])
        ) {
          term =
            m[1][0].toUpperCase() +
            m[1].slice(1).toLowerCase();

          year = m[2];
          subject = m[3].toUpperCase();
          number = m[4];
          section = m[5] || "";
        }

        /*
         * Pattern 2/3:
         * COMP-4300 - Fall 2025
         * COMP 4300 (Fall 2025)
         */
        else {
          subject = m[1].toUpperCase();
          number = m[2];
          section = m[3] || "";

          term =
            m[4][0].toUpperCase() +
            m[4].slice(1).toLowerCase();

          year = m[5];
        }

        const course =
          `${subject}-${number}${section ? "-" + section.toUpperCase() : ""}`;

        const entry = {
          key: `${term} ${year}|${course}`,
          term,
          year,
          course
        };

        found.set(
          entry.key,
          entry
        );
      }
    }

    return [...found.values()];
  }

  function sortEntries(entries) {
    const order = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return [...entries].sort((a, b) => {
      const yearDiff =
        Number(b.year) -
        Number(a.year);

      if (yearDiff) {
        return yearDiff;
      }

      const termDiff =
        (order[b.term] || 0) -
        (order[a.term] || 0);

      if (termDiff) {
        return termDiff;
      }

      return a.course.localeCompare(
        b.course
      );
    });
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  // ============================================================
  // STORAGE
  // ============================================================

  async function loadState() {
    const result =
      await chrome.storage.local.get(
        STORAGE_KEY
      );

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
      Array.isArray(
        state.currentClasses
      )
        ? state.currentClasses
        : [];

    state.collapsedSemesters =
      state.collapsedSemesters || {};

    // Remove obsolete Winter entries from older versions.
    state.entries =
      state.entries.filter(entry =>
        ["Fall", "Spring", "Summer"]
          .includes(entry.term)
      );
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        entries: state.entries,
        selected: state.selected,
        currentClasses:
          state.currentClasses,
        collapsedSemesters:
          state.collapsedSemesters,
        enabled: state.enabled
      }
    });
  }

  // ============================================================
  // DISCOVERY
  // ============================================================

  async function discoverCourses() {
    const discovered = new Map();

    /*
     * Scan visible page text.
     */
    const bodyText =
      normalize(
        document.body?.innerText || ""
      );

    parseCourses(bodyText)
      .forEach(entry => {
        discovered.set(
          entry.key,
          entry
        );
      });

    /*
     * Scan reasonably sized elements too.
     *
     * This catches course labels that aren't represented
     * in body.innerText in the same way.
     */
    document
      .querySelectorAll(
        "a,span,p,div,li,td,button"
      )
      .forEach(el => {
        const text =
          normalize(
            el.innerText ||
            el.textContent
          );

        if (
          text.length > 5 &&
          text.length < 2500
        ) {
          parseCourses(text)
            .forEach(entry => {
              discovered.set(
                entry.key,
                entry
              );
            });
        }
      });

    const merged =
      new Map(
        state.entries.map(
          entry => [
            entry.key,
            entry
          ]
        )
      );

    discovered.forEach(
      (entry, key) =>
        merged.set(key, entry)
    );

    state.entries =
      sortEntries(
        [...merged.values()]
      );

    /*
     * Keep selected/current references valid.
     */
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

    await saveState();
  }

  // ============================================================
  // CLEAR COURSE DATABASE
  // ============================================================

  async function clearAllCourses() {
    state.entries = [];
    state.selected = [];
    state.currentClasses = [];
    state.collapsedSemesters = {};

    await saveState();

    /*
     * Rebuild from the current page.
     */
    await discoverCourses();

    restoreAll();

    applyFilter();

    updatePanel();

    showStatus(
      `Course list cleared. ${state.entries.length} courses rediscovered.`
    );
  }

  // ============================================================
  // PANOPTO RECORDING LINKS
  // ============================================================

  function getViewerLinks() {
    return [
      ...document.querySelectorAll(
        'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
      )
    ];
  }

  /*
   * Return a stable identifier for a recording.
   */
  function getViewerId(link) {
    try {
      const url =
        new URL(
          link.href,
          location.href
        );

      return (
        url.searchParams.get("id") ||
        link.href
      );
    } catch {
      return link.href;
    }
  }

  // ============================================================
  // FIND RECORDING CONTAINER
  //
  // CRITICAL:
  // We NEVER use giant page-level ancestors.
  // ============================================================

  function getRecordingContainer(link) {
    let current = link;

    /*
     * Look for the smallest useful ancestor.
     */
    for (
      let depth = 0;
      depth < 8 && current;
      depth++
    ) {
      const rect =
        current.getBoundingClientRect();

      const text =
        normalize(
          current.innerText ||
          current.textContent
        );

      /*
       * Reject the entire page / giant containers.
       */
      if (
        rect.width >
          window.innerWidth * 0.95 &&
        rect.height >
          window.innerHeight * 0.8
      ) {
        current =
          current.parentElement;

        continue;
      }

      /*
       * Don't use tiny inline elements.
       */
      if (
        rect.width < 150 ||
        rect.height < 40
      ) {
        current =
          current.parentElement;

        continue;
      }

      /*
       * A recording container shouldn't contain
       * dozens/hundreds of Viewer links.
       */
      const viewerCount =
        current.querySelectorAll(
          'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
        ).length;

      if (
        viewerCount > 6
      ) {
        current =
          current.parentElement;

        continue;
      }

      /*
       * Prefer containers with reasonable text.
       */
      if (
        text.length >= 1 &&
        text.length < 1500
      ) {
        return current;
      }

      current =
        current.parentElement;
    }

    /*
     * Absolute fallback:
     * the direct parent of the viewer link.
     */
    return (
      link.parentElement ||
      link
    );
  }

  // ============================================================
  // RECORDING OBJECTS
  // ============================================================

  function getRecordings() {
    const links =
      getViewerLinks();

    const seen =
      new Set();

    const recordings = [];

    for (const link of links) {
      const id =
        getViewerId(link);

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);

      const container =
        getRecordingContainer(
          link
        );

      recordings.push({
        id,
        link,
        container
      });
    }

    return recordings;
  }

  // ============================================================
  // COURSE CONTEXT
  //
  // Search from the recording upward, but don't go to
  // page-level containers.
  // ============================================================

  function getRecordingCourses(
    recording
  ) {
    const found = new Map();

    let current =
      recording.container;

    for (
      let depth = 0;
      depth < 7 && current;
      depth++
    ) {
      const rect =
        current.getBoundingClientRect();

      /*
       * Stop before reaching the entire recording list.
       */
      if (
        rect.width >
          window.innerWidth * 0.95 &&
        rect.height >
          window.innerHeight * 0.8
      ) {
        break;
      }

      const text =
        normalize(
          current.innerText ||
          current.textContent
        );

      if (
        text.length > 0 &&
        text.length < 2500
      ) {
        parseCourses(text)
          .forEach(entry => {
            found.set(
              entry.key,
              entry
            );
          });
      }

      current =
        current.parentElement;
    }

    return [...found.values()];
  }

  // ============================================================
  // RESTORE
  // ============================================================

  function restoreAll() {
    /*
     * Only restore actual recording containers we previously
     * modified.
     */
    document
      .querySelectorAll(
        ".pcf-recording-hidden"
      )
      .forEach(el => {
        el.classList.remove(
          "pcf-recording-hidden"
        );

        el.style.removeProperty(
          "display"
        );

        el.style.removeProperty(
          "visibility"
        );

        el.removeAttribute(
          "hidden"
        );
      });
  }

  // ============================================================
  // FILTER
  // ============================================================

  function applyFilter() {
    /*
     * ALWAYS restore our own changes first.
     *
     * This fixes the problem where unselecting a course
     * previously didn't bring recordings back.
     */
    restoreAll();

    /*
     * Nothing selected means EVERYTHING.
     */
    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      updatePanel();

      return;
    }

    const selected =
      new Set(
        state.selected
      );

    const recordings =
      getRecordings();

    let hidden = 0;

    for (
      const recording of recordings
    ) {
      const courses =
        getRecordingCourses(
          recording
        );

      /*
       * UNKNOWN COURSE:
       *
       * Do NOT hide it.
       *
       * This is much safer than blanking the entire
       * Shared with Me page.
       */
      if (
        courses.length === 0
      ) {
        continue;
      }

      const matches =
        courses.some(
          course =>
            selected.has(
              course.key
            )
        );

      if (!matches) {
        const container =
          recording.container;

        /*
         * Only hide a container that we know represents
         * a single recording.
         */
        const viewerCount =
          container.querySelectorAll(
            'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
          ).length;

        if (
          viewerCount <= 2
        ) {
          container.classList.add(
            "pcf-recording-hidden"
          );

          container.style.display =
            "none";

          hidden++;
        }
      }
    }

    updatePanel();

    return hidden;
  }

  // ============================================================
  // LAZY LOADING
  // ============================================================

  function getScrollContainers() {
    const result = [];

    document
      .querySelectorAll(
        "div,main,section,ul,ol"
      )
      .forEach(el => {
        const style =
          getComputedStyle(el);

        if (
          (
            style.overflowY === "auto" ||
            style.overflowY === "scroll"
          ) &&
          el.scrollHeight >
            el.clientHeight + 150
        ) {
          result.push(el);
        }
      });

    return result;
  }

  async function loadRecordings() {
    if (state.loading) {
      return;
    }

    if (
      state.selected.length === 0
    ) {
      restoreAll();
      applyFilter();

      showStatus(
        "No courses selected — showing everything."
      );

      return;
    }

    state.loading = true;

    updateLoadButton();

    /*
     * Don't filter while Panopto is adding DOM elements.
     */
    restoreAll();

    let previous = 0;
    let unchanged = 0;

    try {
      for (
        let round = 0;
        round < 50;
        round++
      ) {
        /*
         * Scroll the actual document.
         */
        window.scrollTo({
          top:
            document.documentElement
              .scrollHeight,
          behavior: "instant"
        });

        /*
         * Also scroll internal Panopto containers.
         */
        getScrollContainers()
          .forEach(el => {
            try {
              el.scrollTop =
                el.scrollHeight;
            } catch {}
          });

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              900
            )
        );

        const count =
          getRecordings().length;

        if (
          count <= previous
        ) {
          unchanged++;
        } else {
          unchanged = 0;
          previous = count;
        }

        showStatus(
          `Loading recordings… ${count} found`
        );

        /*
         * Seven rounds without new recordings means
         * Panopto has probably finished.
         */
        if (
          unchanged >= 7
        ) {
          break;
        }
      }

      await discoverCourses();

    } finally {
      state.loading = false;

      /*
       * NOW filter.
       */
      applyFilter();

      updateLoadButton();

      showStatus(
        `Finished. ${getRecordings().length} recordings found.`
      );
    }
  }

  function updateLoadButton() {
    const button =
      document.getElementById(
        "pcf-load"
      );

    if (!button) return;

    if (state.loading) {
      button.textContent =
        "⏳ Loading recordings…";

      button.onclick =
        () => {
          state.loading = false;
        };
    } else {
      button.textContent =
        "🔎 Load Matching Recordings";

      button.onclick =
        loadRecordings;
    }
  }

  // ============================================================
  // CURRENT TERM
  // ============================================================

  function currentTerm() {
    const date =
      new Date();

    const month =
      date.getMonth() + 1;

    const year =
      date.getFullYear();

    if (
      month <= 5
    ) {
      return {
        term: "Spring",
        year
      };
    }

    if (
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

      <input
        id="pcf-search"
        type="search"
        placeholder="Search courses..."
      >

      <div class="pcf-current">
        <strong>⭐ Current Classes</strong>

        <div>
          <button id="pcf-current">
            Use Current
          </button>

          <button id="pcf-save">
            Save Selected
          </button>

          <button id="pcf-clear-current">
            Clear Saved
          </button>
        </div>
      </div>

      <button
        id="pcf-load"
        class="pcf-load"
      >
        🔎 Load Matching Recordings
      </button>

      <div
        id="pcf-status"
        class="pcf-status"
      ></div>

      <div class="pcf-actions">
        <button id="pcf-term">
          Current Semester
        </button>

        <button id="pcf-none">
          Show All
        </button>
      </div>

      <label class="pcf-toggle">
        <input
          id="pcf-enabled"
          type="checkbox"
        >
        Enable Filter
      </label>

      <div id="pcf-list"></div>

      <div class="pcf-footer">
        <div id="pcf-count"></div>

        <button id="pcf-scan">
          ↻ Scan
        </button>

        <button
          id="pcf-clear"
          class="pcf-danger"
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
      async e => {
        state.enabled =
          e.target.checked;

        await saveState();

        if (
          !state.enabled
        ) {
          restoreAll();
        }

        applyFilter();
      };

    document.getElementById(
      "pcf-search"
    ).oninput =
      () =>
        updatePanel();

    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();

        restoreAll();

        applyFilter();

        showStatus(
          "Showing all recordings."
        );
      };

    document.getElementById(
      "pcf-term"
    ).onclick =
      async () => {
        const current =
          currentTerm();

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
      "pcf-current"
    ).onclick =
      async () => {
        state.selected =
          [...state.currentClasses];

        await saveState();

        if (
          state.selected.length === 0
        ) {
          restoreAll();
        }

        applyFilter();
      };

    document.getElementById(
      "pcf-save"
    ).onclick =
      async () => {
        state.currentClasses =
          [...state.selected];

        await saveState();

        updatePanel();

        showStatus(
          "Current classes saved."
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
      "pcf-scan"
    ).onclick =
      async () => {
        await discoverCourses();

        applyFilter();

        updatePanel();

        showStatus(
          `Scan complete — ${state.entries.length} courses discovered.`
        );
      };

    document.getElementById(
      "pcf-clear"
    ).onclick =
      async () => {
        if (
          !confirm(
            "Clear ALL discovered courses and saved current classes?"
          )
        ) {
          return;
        }

        await clearAllCourses();
      };

    updateLoadButton();
  }

  // ============================================================
  // PANEL UPDATE
  // ============================================================

  function updatePanel() {
    const list =
      document.getElementById(
        "pcf-list"
      );

    if (!list) return;

    const search =
      normalize(
        document.getElementById(
          "pcf-search"
        )?.value
      ).toUpperCase();

    list.innerHTML = "";

    const groups =
      new Map();

    state.entries
      .filter(entry =>
        !search ||
        entryLabel(entry)
          .toUpperCase()
          .includes(search)
      )
      .forEach(entry => {
        const key =
          `${entry.term} ${entry.year}`;

        if (!groups.has(key)) {
          groups.set(
            key,
            []
          );
        }

        groups
          .get(key)
          .push(entry);
      });

    for (
      const [semester, entries]
      of groups
    ) {
      const header =
        document.createElement(
          "div"
        );

      header.className =
        "pcf-semester";

      const collapsed =
        !!state.collapsedSemesters[
          semester
        ];

      header.innerHTML = `
        <button class="pcf-collapse">
          ${collapsed ? "▶" : "▼"}
        </button>

        <strong>${semester}</strong>

        <button class="pcf-select-all">
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
        "pcf-courses";

      courses.style.display =
        collapsed
          ? "none"
          : "";

      header
        .querySelector(
          ".pcf-collapse"
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

          updatePanel();
        };

      header
        .querySelector(
          ".pcf-select-all"
        )
        .onclick =
        async () => {
          const keys =
            entries.map(
              e => e.key
            );

          const all =
            keys.every(
              key =>
                state.selected.includes(
                  key
                )
            );

          if (all) {
            state.selected =
              state.selected.filter(
                key =>
                  !keys.includes(
                    key
                  )
              );
          } else {
            for (
              const key of keys
            ) {
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
          }

          await saveState();

          if (
            state.selected.length === 0
          ) {
            restoreAll();
          }

          applyFilter();
        };

      for (
        const entry of entries
      ) {
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
              restoreAll();
            }

            applyFilter();
          };

        label.appendChild(
          checkbox
        );

        label.appendChild(
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

          star.textContent =
            " ★";

          star.className =
            "pcf-star";

          label.appendChild(
            star
          );
        }

        courses.appendChild(
          label
        );
      }

      list.appendChild(
        courses
      );
    }

    const count =
      document.getElementById(
        "pcf-count"
      );

    const recordings =
      getRecordings();

    count.innerHTML = `
      <div>
        <strong>${state.selected.length}</strong>
        selected
      </div>

      <div>
        <strong>${recordings.length}</strong>
        recordings on page
      </div>

      <div>
        <strong>${state.entries.length}</strong>
        discovered courses
      </div>

      ${
        state.currentClasses.length
          ? `
            <div>
              ⭐ ${state.currentClasses.length}
              saved current
            </div>
          `
          : ""
      }
    `;

    updateLoadButton();
  }

  // ============================================================
  // STATUS
  // ============================================================

  let statusTimer;

  function showStatus(text) {
    const el =
      document.getElementById(
        "pcf-status"
      );

    if (!el) return;

    el.textContent =
      text;

    clearTimeout(
      statusTimer
    );

    statusTimer =
      setTimeout(() => {
        el.textContent = "";
      }, 5000);
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

  // ============================================================
  // MUTATION OBSERVER
  // ============================================================

  let scanTimer;

  function scheduleScan() {
    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(
        async () => {
          /*
           * Don't interfere while we're deliberately
           * loading more recordings.
           */
          if (
            state.loading
          ) {
            return;
          }

          await discoverCourses();

          applyFilter();
        },
        500
      );
  }

  function installObserver() {
    const observer =
      new MutationObserver(
        scheduleScan
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  // ============================================================
  // SPA NAVIGATION
  // ============================================================

  function watchUrl() {
    setInterval(
      () => {
        if (
          location.href !==
          state.lastUrl
        ) {
          state.lastUrl =
            location.href;

          /*
           * Panopto changes the hash when switching between:
           * Home
           * Shared with Me
           * Everything
           *
           * Give React time to rebuild the list.
           */
          setTimeout(
            async () => {
              await discoverCourses();

              restoreAll();

              applyFilter();

              updatePanel();
            },
            800
          );

          setTimeout(
            scheduleScan,
            2500
          );

          setTimeout(
            scheduleScan,
            5000
          );
        }
      },
      400
    );
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    await discoverCourses();

    restoreAll();

    applyFilter();

    installObserver();
    watchUrl();

    /*
     * Panopto loads its recording list asynchronously.
     */
    setTimeout(
      scheduleScan,
      1000
    );

    setTimeout(
      scheduleScan,
      2500
    );

    setTimeout(
      scheduleScan,
      5000
    );
  }

  init();

})();
