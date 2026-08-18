(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV4";

  const state = {
    entries: [],
    selected: [],
    enabled: true
  };

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
      const term = match[1]
        .charAt(0)
        .toUpperCase() +
        match[1]
          .slice(1)
          .toLowerCase();

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
        match[4]
          .charAt(0)
          .toUpperCase() +
        match[4]
          .slice(1)
          .toLowerCase();

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
        const ay =
          Number(a.year);

        const by =
          Number(b.year);

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

          /*
           * An individual recording card should contain
           * a reasonable amount of text but not an entire
           * Panopto page section.
           */
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

  function applyFilter() {
    const cards =
      findRecordingCards();

    console.log(
      "[Panopto Course Filter]",
      "recording cards:",
      cards.length,
      "selected:",
      state.selected
    );

    cards.forEach(card => {
      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        card.style.display = "";
        return;
      }

      card.style.display =
        cardMatchesSelection(card)
          ? ""
          : "none";
    });

    updatePanel();
  }

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
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state
    });
  }

  function getCurrentTerm() {
    const now = new Date();

    const month =
      now.getMonth() + 1;

    const year =
      now.getFullYear();

    if (month >= 1 && month <= 5) {
      return {
        term: "Spring",
        year
      };
    }

    if (month >= 6 && month <= 7) {
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

      <div class="pcf-buttons">
        <button id="pcf-current">
          Current
        </button>

        <button id="pcf-all">
          All
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
        <span id="pcf-count"></span>

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
    ).onclick = () => {
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
      updatePanel;

    document.getElementById(
      "pcf-none"
    ).onclick =
      async () => {
        state.selected = [];

        await saveState();
        applyFilter();
      };

    document.getElementById(
      "pcf-all"
    ).onclick =
      async () => {
        state.selected =
          state.entries.map(
            entry => entry.key
          );

        await saveState();
        applyFilter();
      };

    document.getElementById(
      "pcf-current"
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

    document.getElementById(
      "pcf-refresh"
    ).onclick =
      () => {
        discoverEntries();
        applyFilter();
      };
  }

  function updatePanel() {
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

    /*
     * Group entries by semester.
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
        const group =
          `${entry.term} ${entry.year}`;

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
        const heading =
          document.createElement(
            "div"
          );

        heading.className =
          "pcf-semester";

        heading.textContent =
          semester;

        list.appendChild(
          heading
        );

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

          list.appendChild(
            label
          );
        });
      }
    );

    document.getElementById(
      "pcf-count"
    ).textContent =
      `${state.selected.length} selected · ${state.entries.length} found`;
  }

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
      };

    document.body.appendChild(
      button
    );
  }

  let scanTimer;

  function rescan() {
    clearTimeout(
      scanTimer
    );

    scanTimer =
      setTimeout(() => {
        discoverEntries();
        applyFilter();
      }, 700);
  }

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    discoverEntries();
    applyFilter();

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
  }

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init();
  }
})();
