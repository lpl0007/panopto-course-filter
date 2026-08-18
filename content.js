(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilter";

  const state = {
    courses: [],
    selected: [],
    enabled: true
  };

  const COURSE_RE =
    /\b([A-Z]{2,8})[-\s]+(\d{3,5})(?:[-\s]+[A-Z0-9]{1,8})?\b/gi;

  function normalize(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractCourseCodes(text) {
    const courses = new Set();

    COURSE_RE.lastIndex = 0;

    let match;

    while ((match = COURSE_RE.exec(text || ""))) {
      courses.add(
        `${match[1].toUpperCase()}-${match[2]}`
      );
    }

    return [...courses];
  }

  function findRecordingCards() {
    const cards = new Set();

    // Find text nodes/elements containing course metadata.
    const elements = document.querySelectorAll(
      "div, span, p, a"
    );

    elements.forEach(element => {
      const text = normalize(
        element.innerText || element.textContent
      );

      // We specifically want Panopto's semester-course format.
      if (
        !/(Fall|Spring|Summer|Winter)\s+\d{4}/i.test(text)
      ) {
        return;
      }

      const courses = extractCourseCodes(text);

      if (courses.length === 0) {
        return;
      }

      /*
       * Don't immediately hide this element.
       * Walk upward until we find the individual visual
       * recording card.
       */
      let parent = element;

      for (let i = 0; i < 8 && parent; i++) {
        const rect =
          parent.getBoundingClientRect();

        const parentText = normalize(
          parent.innerText || parent.textContent
        );

        // Individual Panopto cards are reasonably sized.
        if (
          rect.width > 200 &&
          rect.height > 150 &&
          rect.height < 650 &&
          parentText.length < 1000
        ) {
          cards.add(parent);
          break;
        }

        parent = parent.parentElement;
      }
    });

    return [...cards];
  }

  function discoverCourses() {
    const found = new Set();

    document.querySelectorAll(
      "div, span, p, a, button"
    ).forEach(element => {
      const text = normalize(
        element.innerText || element.textContent
      );

      if (
        text.length > 500 ||
        text.length < 5
      ) {
        return;
      }

      /*
       * Only extract from actual semester/course strings.
       * This prevents FALL-2026 and SPRING-2026 from
       * becoming fake courses.
       */
      if (
        !/(Fall|Spring|Summer|Winter)\s+\d{4}/i.test(
          text
        )
      ) {
        return;
      }

      extractCourseCodes(text)
        .forEach(course => found.add(course));
    });

    state.courses = [...found]
      .filter(course =>
        /^[A-Z]{2,8}-\d{3,5}$/.test(course)
      )
      .sort();
  }

  function getCardCourses(card) {
    return extractCourseCodes(
      normalize(
        card.innerText || card.textContent
      )
    );
  }

  function applyFilter() {
    const cards = findRecordingCards();

    console.log(
      "[Panopto Course Filter] cards found:",
      cards.length
    );

    cards.forEach(card => {
      if (
        !state.enabled ||
        state.selected.length === 0
      ) {
        card.style.display = "";
        return;
      }

      const cardCourses =
        getCardCourses(card);

      const matches =
        cardCourses.some(course =>
          state.selected.includes(course)
        );

      card.style.display =
        matches ? "" : "none";
    });

    updatePanel();
  }

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
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state
    });
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
     * Select courses that have recordings from
     * the current calendar year.
     */
    document.getElementById(
      "pcf-current"
    ).onclick = async () => {
      const year =
        new Date().getFullYear();

      const current =
        new Set();

      document.querySelectorAll(
        "div, span, p, a"
      ).forEach(element => {
        const text = normalize(
          element.innerText ||
          element.textContent
        );

        if (
          text.includes(
            String(year)
          ) &&
          /(Fall|Spring|Summer|Winter)/i.test(
            text
          )
        ) {
          extractCourseCodes(text)
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

        checkbox.type =
          "checkbox";

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
      discoverCourses();
      applyFilter();
    }, 700);
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
