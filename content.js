(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilter";
  const COURSE_RE = /\b([A-Z]{2,6})\s*[-:]?\s*(\d{3,5})\b/gi;

  const state = {
    courses: [],
    selected: [],
    enabled: true
  };

  const normalize = s => (s || "").replace(/\s+/g, " ").trim();

  const courseCode = text => {
    const m = normalize(text).toUpperCase().match(COURSE_RE);
    return m ? `${m[1]}-${m[2]}` : null;
  };

  function extractCourses(text) {
    const result = new Set();
    let match;
    COURSE_RE.lastIndex = 0;

    while ((match = COURSE_RE.exec(text || ""))) {
      result.add(`${match[1].toUpperCase()}-${match[2]}`);
    }

    return [...result];
  }

  async function loadState() {
    const saved = await chrome.storage.local.get(STORAGE_KEY);

    if (saved[STORAGE_KEY]) {
      Object.assign(state, saved[STORAGE_KEY]);
    }
  }

  async function saveState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state
    });
  }

  function discoverCourses() {
    const found = new Set(state.courses);

    document
      .querySelectorAll(
        "a, button, [role='treeitem'], [class*='folder'], [class*='Folder'], [class*='card'], [class*='Card'], [class*='session'], [class*='Session']"
      )
      .forEach(element => {
        const text = normalize(element.innerText || element.textContent);

        if (text.length > 250) return;

        extractCourses(text).forEach(course => found.add(course));
      });

    state.courses = [...found].sort();
  }

  function isVideoCard(element) {
    if (!(element instanceof HTMLElement)) return false;

    const text = normalize(element.innerText);

    if (text.length < 15 || text.length > 1500) {
      return false;
    }

    const hasViewerLink = !!element.querySelector(
      "a[href*='Viewer'], a[href*='viewer'], a[href*='Session'], a[href*='session']"
    );

    const hasDuration = /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text);

    return hasViewerLink || hasDuration;
  }

  function findVideoCards() {
    const cards = new Set();

    document.querySelectorAll("a[href]").forEach(link => {
      const href = link.getAttribute("href") || "";

      if (!/viewer|session/i.test(href)) {
        return;
      }

      let parent = link;

      for (let i = 0; i < 7 && parent; i++) {
        if (isVideoCard(parent)) {
          cards.add(parent);
          break;
        }

        parent = parent.parentElement;
      }
    });

    return [...cards];
  }

  function applyFilter() {
    const cards = findVideoCards();

    for (const card of cards) {
      const courses = extractCourses(card.innerText);
      const selected = state.selected;

      let visible = true;

      if (state.enabled && selected.length > 0) {
        visible = courses.some(course =>
          selected.includes(course)
        );
      }

      card.style.display = visible ? "" : "none";
    }

    updatePanel();
  }

  function createPanel() {
    if (document.getElementById("pcf-panel")) {
      return;
    }

    const panel = document.createElement("div");

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
        <button id="pcf-recent">2026</button>
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

    document.getElementById("pcf-close").onclick = () => {
      panel.classList.add("pcf-hidden");
    };

    document.getElementById("pcf-enabled").checked = state.enabled;

    document.getElementById("pcf-enabled").onchange = async event => {
      state.enabled = event.target.checked;
      await saveState();
      applyFilter();
    };

    document.getElementById("pcf-search").oninput = updatePanel;

    document.getElementById("pcf-all").onclick = async () => {
      state.selected = [...state.courses];
      await saveState();
      applyFilter();
    };

    document.getElementById("pcf-none").onclick = async () => {
      state.selected = [];
      await saveState();
      applyFilter();
    };

    document.getElementById("pcf-recent").onclick = async () => {
      const recent = new Set();

      document.querySelectorAll(
        "a, button, [class*='card'], [class*='Card'], [class*='folder'], [class*='Folder']"
      ).forEach(element => {
        const text = normalize(element.innerText || element.textContent);

        if (/\b2026\b/i.test(text)) {
          extractCourses(text).forEach(course => {
            recent.add(course);
          });
        }
      });

      state.selected = [...recent];

      await saveState();
      applyFilter();
    };

    document.getElementById("pcf-refresh").onclick = () => {
      discoverCourses();
      applyFilter();
    };
  }

  function updatePanel() {
    const panel = document.getElementById("pcf-panel");

    if (!panel) return;

    const search =
      normalize(
        document.getElementById("pcf-search").value
      ).toUpperCase();

    const list =
      document.getElementById("pcf-course-list");

    list.innerHTML = "";

    const courses = state.courses.filter(course =>
      !search || course.includes(search)
    );

    courses.forEach(course => {
      const label = document.createElement("label");

      label.className = "pcf-course";

      const checkbox =
        document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.checked =
        state.selected.includes(course);

      checkbox.onchange = async () => {
        if (checkbox.checked) {
          if (!state.selected.includes(course)) {
            state.selected.push(course);
          }
        } else {
          state.selected =
            state.selected.filter(c => c !== course);
        }

        await saveState();
        applyFilter();
      };

      label.append(
        checkbox,
        document.createTextNode(course)
      );

      list.appendChild(label);
    });

    document.getElementById("pcf-count").textContent =
      `${state.selected.length} selected · ${courses.length} found`;
  }

  function createLauncher() {
    if (document.getElementById("pcf-launcher")) {
      return;
    }

    const button = document.createElement("button");

    button.id = "pcf-launcher";
    button.textContent = "🎓 Courses";

    button.onclick = () => {
      document
        .getElementById("pcf-panel")
        .classList.remove("pcf-hidden");
    };

    document.body.appendChild(button);
  }

  let timer;

  function rescan() {
    clearTimeout(timer);

    timer = setTimeout(() => {
      discoverCourses();
      applyFilter();
    }, 500);
  }

  async function init() {
    await loadState();

    createPanel();
    createLauncher();

    discoverCourses();
    applyFilter();

    const observer =
      new MutationObserver(rescan);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(rescan, 3000);
  }

  if (
    location.hostname ===
    "auburn.hosted.panopto.com"
  ) {
    init();
  }
})();
