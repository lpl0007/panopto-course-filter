(() => {
  "use strict";

  const STORAGE_KEY = "panoptoSemesterIgnoreV1";
  const state = { ignored: {} };
  let observer = null;
  let saveTimer = null;
  let running = false;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  function parseSemester(text) {
    const match = SEMESTER_RE.exec(normalize(text));
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : null;
  }

  function groups() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return [];
    return [...panel.querySelectorAll(".pcf-semester-header")].map(header => {
      const semester = parseSemester(header.innerText || header.textContent);
      const group = header.nextElementSibling?.classList.contains("pcf-semester-courses")
        ? header.nextElementSibling
        : null;
      return semester && group ? { header, group, semester } : null;
    }).filter(Boolean);
  }

  function semesterIgnored(semester) {
    return Array.isArray(state.ignored[semester]);
  }

  function updateButton(button, semester) {
    const ignored = semesterIgnored(semester);
    button.textContent = ignored ? "↩" : "🚫";
    button.title = ignored ? `Restore ${semester}` : `Ignore all of ${semester}`;
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-ignored", ignored);
  }

  function ensureButtons() {
    groups().forEach(({ header, semester }) => {
      let button = header.querySelector(".pcf-semester-ignore");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "pcf-semester-ignore";
        header.appendChild(button);
      }
      button.dataset.semester = semester;
      updateButton(button, semester);
    });
  }

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY];
      state.ignored = saved && typeof saved.ignored === "object" ? saved.ignored : {};
      Object.keys(state.ignored).forEach(semester => {
        if (!Array.isArray(state.ignored[semester])) delete state.ignored[semester];
      });
    } catch (error) {
      console.warn("Panopto Course Filter: could not load semester ignore state.", error);
    }
  }

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: { ignored: state.ignored } }).catch(error => {
        console.warn("Panopto Course Filter: could not save semester ignore state.", error);
      });
    }, 0);
  }

  function courseRows(group) {
    return [...group.querySelectorAll(":scope > .pcf-course-row")];
  }

  async function clickButtons(buttons) {
    for (const button of buttons) {
      if (!button.isConnected) continue;
      button.click();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  async function ignoreSemester(semester, group) {
    if (running) return;
    running = true;

    // IMPORTANT: let the normal course-ignore handler add each key first.
    // The previous implementation wrote the semester keys before clicking the
    // course buttons, causing each course click to immediately remove its key.
    const buttons = courseRows(group)
      .map(row => row.querySelector(".pcf-ignore-fix"))
      .filter(button => button && button.textContent.trim() === "🚫");
    const added = buttons
      .map(button => button.dataset.courseKey)
      .filter(Boolean);

    await clickButtons(buttons);

    state.ignored[semester] = [...new Set([
      ...(state.ignored[semester] || []),
      ...added
    ])];
    saveState();
    running = false;
    ensureButtons();
  }

  async function restoreSemester(semester, group) {
    if (running) return;
    running = true;
    const keys = new Set(state.ignored[semester] || []);
    const buttons = courseRows(group)
      .map(row => row.querySelector(".pcf-ignore-fix"))
      .filter(button => button && keys.has(button.dataset.courseKey) && button.textContent.trim() === "↩");

    await clickButtons(buttons);
    delete state.ignored[semester];
    saveState();
    running = false;
    ensureButtons();
  }

  function setupEvents() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel || panel.dataset.semesterIgnoreEventsReady === "true") return;
    panel.dataset.semesterIgnoreEventsReady = "true";
    panel.addEventListener("click", event => {
      const button = event.target.closest(".pcf-semester-ignore");
      if (!button || !panel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      const semester = button.dataset.semester;
      const match = groups().find(item => item.semester === semester);
      if (!match) return;
      if (semesterIgnored(semester)) void restoreSemester(semester, match.group);
      else void ignoreSemester(semester, match.group);
    }, true);
  }

  function syncIgnoredSemesterCourses() {
    if (running) return;
    groups().forEach(({ group, semester }) => {
      if (!semesterIgnored(semester)) return;
      const known = new Set(state.ignored[semester]);
      const buttons = courseRows(group)
        .map(row => row.querySelector(".pcf-ignore-fix"))
        .filter(button => button && button.textContent.trim() === "🚫");
      buttons.forEach(button => {
        if (button.dataset.courseKey) known.add(button.dataset.courseKey);
      });
      if (buttons.length) {
        state.ignored[semester] = [...known];
        buttons.forEach(button => button.click());
        saveState();
      }
    });
  }

  function start() {
    loadState().then(() => {
      ensureButtons();
      setupEvents();
      syncIgnoredSemesterCourses();
      if (!observer) {
        observer = new MutationObserver(() => {
          clearTimeout(window.__pcfSemesterIgnoreTimer);
          window.__pcfSemesterIgnoreTimer = setTimeout(() => {
            ensureButtons();
            setupEvents();
            syncIgnoredSemesterCourses();
          }, 100);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
