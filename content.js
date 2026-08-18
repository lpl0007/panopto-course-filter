(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilter";

  const state = {
    courses: [],
    selected: [],
    enabled: true
  };

  const COURSE_RE =
    /\b([A-Z]{2,8})\s*[-:]?\s*(\d{3,5})\b/gi;

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function extractCourses(text) {
    const result = new Set();

    COURSE_RE.lastIndex = 0;

    let match;

    while ((match = COURSE_RE.exec(text || ""))) {
      result.add(
        `${match[1].toUpperCase()}-${match[2]}`
      );
    }

    return [...result];
  }

  function looksLikeVideoLink(link) {
    const href = link.getAttribute("href") || "";

    return (
      /viewer/i.test(href) ||
      /session/i.test(href) ||
      /recording/i.test(href)
    );
  }

  /*
   * Find the smallest ancestor that represents ONE recording.
   *
   * The old version could climb into a whole Panopto section
   * containing several recordings. This version deliberately
   * stops much sooner.
   */
  function findRecordingCard(link) {
    let element = link;

    for (let depth = 0; depth < 10 && element; depth++) {
      const rect = element.getBoundingClientRect();

      if (
        rect.width > 150 &&
        rect.height > 100 &&
        rect.height < 700
      ) {
        const descendantVideoLinks = [
          ...element.querySelectorAll("a[href]")
        ].filter(looksLikeVideoLink);

        /*
         * An individual recording should normally contain one
         * viewer/session link.
         */
        if (descendantVideoLinks.length === 1) {
          const text = normalize(element.innerText);

          if (
            text.length >= 20 &&
            text.length <= 1200
          ) {
            return element;
          }
        }
      }

      element = element.parentElement;
    }

    return null;
  }

  function findRecordingCards() {
    const cards = new Set();

    document
      .querySelectorAll("a[href]")
      .forEach(link => {
        if (!looksLikeVideoLink(link)) {
          return;
        }

        const card = findRecordingCard(link);

        if (card) {
          cards.add(card);
        }
      });

    return [...cards];
  }

  function discoverCourses() {
    const found = new Set();

    /*
     * Only look at relatively small elements so we don't
     * accidentally extract "Fall 2026" or courses from an
     * entire page section.
     */
    document
      .querySelectorAll(
        "a, button, [role='treeitem'], [class*='card'], [class*='Card']"
      )
      .forEach(element => {
        const text = normalize(
          element.innerText || element.textContent
        );

        if (
          text.length >= 10 &&
          text.length <= 500
        ) {
          extractCourses(text).forEach(course => {
            found.add(course);
          });
        }
      });

    /*
     * Only keep actual course-number combinations.
     * This removes things such as FALL-2026 and SPRING-2026.
     */
    state.courses = [...found]
      .filter(course =>
        /^[A-Z]{2,8}-\d{3,5}$/.test(course)
      )
      .sort();
  }

  function cardMatchesSelection(card) {
    const text = normalize(card.innerText);

    const courses = extractCourses(text);

    return courses.some(course =>
      state.selected.includes(course)
    );
  }

  function applyFilter() {
    const cards = findRecordingCards();

    cards.forEach(card => {
      if (!state.enabled || state.selected.length === 0) {
        card.style.display = "";
        card.removeAttribute("data-pcf-hidden");
        return;
      }

      const matches = cardMatchesSelection(card);

      card.style.display = matches ? "" : "none";
      card.setAttribute(
        "data-pcf-hidden",
        matches ? "false" : "true"
      );
    });

    updatePanel();
  }

  async function loadState() {
    const saved =
      await chrome.storage.local.get(STORAGE_KEY);

    if (saved[STORAGE_KEY]) {
      Object.assign(
        state,
        saved[STORAGE_KEY]
      );
    }
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state
    });
  }

  function createPanel() {
    if (
      document.getElementById("pcf-panel")
    ) {
      return;
    }

    const panel =
      document.createElement("div");

    panel.id = "pcf-panel";

    panel.innerHTML = `
      <div class="pcf-header">
        <strong>🎓 Panopto Courses</strong>
        <button id="pcf-close">×</button>
      </div>

      <div class="pcf-description">
        Select the classes you want to see.
      </div>

      <input
        id="pcf-search"
        type="search"
        placeholder="Search courses..."
      >

      <div class="pcf-buttons">
        <button id="pcf-current">Current</button>
        <button id="pcf-all">All</button>
        <button id="pcf-none">None</button>
      </div>

      <label class="pcf-toggle">
        <input id="pcf-enabled" type="checkbox">
        Filter recordings
      </label>

      <div id="pcf-course-list"></div>

      <div class="pcf-footer">
        <span id="pcf-count"></span>
        <button id="pcf-refresh">↻ Scan</button>
      </div>
    `;

    document.body.appendChild(panel);

    document.getElementById(
      "pcf-close"
    ).onclick = () => {
      panel.classList.add(
        "pcf-hidden"
      );
    };

    document.getElementById(
      "pcf-enabled"
    ).checked = state.enabled;

    document.getElementById(
      "pcf-enabled"
    ).onchange = async event => {
      state.enabled =
        event.target.checked;

      await saveState();
      applyFilter();
    };

    document.getElementById(
      "pcf-search"
    ).oninput = updatePanel;

    document.getElementById(
      "pcf-all"
    ).onclick = async () => {
      state.selected =
        [...state.courses];

      await saveState();
      applyFilter();
    };

    document.getElementById(
      "pcf-none"
    ).onclick = async () => {
      state.selected = [];

      await saveState();
      applyFilter();
    };

    /*
     * "Current" selects courses whose recordings/folders
     * contain the current year.
     */
    document.getElementById(
      "pcf-current"
    ).onclick = async () => {
      const currentYear =
        new Date().getFullYear();

      const current =
        new Set();

      document
        .querySelectorAll(
          "a, button, [role='treeitem'], [class*='card'], [class*='Card']"
        )
        .forEach(element => {
          const text = normalize(
            element.innerText ||
            element.textContent
          );

          if (
            text.includes(
              String(currentYear)
            )
          ) {
            extractCourses(text)
              .forEach(course =>
                current.add(course)
              );
          }
        });

      state.selected =
        [...current].filter(course =>
          state.courses.includes(course)
        );

      await saveState();
      applyFilter();
    };

    document.getElementById(
      "pcf-refresh"
    ).onclick = () => {
      discoverCourses();
      applyFilter();
    };
  }

  function updatePanel() {
    const list =
      document.getElementById(
        "pcf-course-list"
      );

    if (!list) return;

    const search =
      normalize(
        document.getElementById(
          "pcf-search"
        ).value
      ).toUpperCase();

    list.innerHTML = "";

    state.courses
      .filter(course =>
        !search ||
        course.includes(search)
      )
      .forEach(course => {
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

        checkbox.type = "checkbox";

        checkbox.checked =
          state.selected.includes(
            course
          );

        checkbox.onchange =
          async () => {
            if (checkbox.checked) {
              if (
                !state.selected.includes(
                  course
                )
              ) {
                state.selected.push(
                  course
                );
              }
            } else {
              state.selected =
                state.selected.filter(
                  c => c !== course
                );
            }

            await saveState();
            applyFilter();
          };

        label.append(
          checkbox,
          document.createTextNode(
            course
          )
        );

        list.appendChild(label);
      });

    document.getElementById(
      "pcf-count"
    ).textContent =
      `${state.selected.length} selected · ${state.courses.length} found`;
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

    button.onclick = () => {
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

  let timer;

  function rescan() {
    clearTimeout(timer);

    timer = setTimeout(() => {
      applyFilter();
    }, 400);
  }

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    discoverCourses();
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
