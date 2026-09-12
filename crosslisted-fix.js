(() => {
  "use strict";

  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";
  const COURSE_RE = /\bCOMP\s*[-–—]?\s*(5830|6830)\b/gi;

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function canonicalKey(key) {
    return String(key || "").replace(/\|COMP-6830(?=-|$)/i, "|COMP-5830");
  }

  function isCrossListedText(text) {
    const value = normalize(text);
    const matches = [...value.matchAll(COURSE_RE)].map(match => match[1]);
    return matches.includes("5830") && matches.includes("6830");
  }

  function courseRows() {
    const panel = document.querySelector("#pcf-panel");
    return panel ? [...panel.querySelectorAll(".pcf-course-row")] : [];
  }

  function rowCourse(row) {
    const node = row.querySelector(".pcf-course");
    return normalize(node && (node.innerText || node.textContent)).match(/\bCOMP\s*[-–—]?\s*(5830|6830)\b/i)?.[1] || null;
  }

  function mergeRows() {
    const groups = new Map();

    for (const row of courseRows()) {
      const course = rowCourse(row);
      if (!course) continue;
      const group = row.closest(".pcf-semester-courses");
      const header = group && group.previousElementSibling;
      const semester = normalize(header && (header.innerText || header.textContent));
      if (!semester) continue;
      const key = semester + "|COMP-5830/6830";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      const first = rows.find(row => rowCourse(row) === "5830") || rows[0];
      const second = rows.find(row => row !== first);
      if (!second) continue;

      const name = first.querySelector(".pcf-course-display-name");
      if (name) {
        name.textContent = "COMP-5830/6830";
        name.title = "COMP-5830/6830 (cross-listed)";
      }

      const checkbox = first.querySelector("input[type='checkbox']");
      if (checkbox) checkbox.dataset.crosslisted58306830 = "true";

      const ignore = first.querySelector(".pcf-ignore-fix");
      if (ignore) {
        ignore.dataset.crosslisted58306830 = "true";
        ignore.dataset.courseKey = canonicalKey(ignore.dataset.courseKey);
      }

      second.remove();
    }
  }

  async function normalizeStorage() {
    try {
      const result = await chrome.storage.local.get(MAIN_STORAGE_KEY);
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return false;

      const entries = Array.isArray(saved.entries) ? saved.entries : [];
      const unique = new Map();
      let changed = false;

      for (const entry of entries) {
        if (!entry || !entry.key) continue;
        const key = canonicalKey(entry.key);
        const course = key.slice(key.indexOf("|") + 1);
        if (key !== entry.key || course !== entry.course) changed = true;
        unique.set(key, { ...entry, key, course });
      }

      const normalizeKeys = values => [...new Set((Array.isArray(values) ? values : []).map(canonicalKey))];
      const selected = normalizeKeys(saved.selected);
      const currentClasses = normalizeKeys(saved.currentClasses);
      const customNames = {};
      for (const [key, value] of Object.entries(saved.customNames || {})) {
        customNames[canonicalKey(key)] = value;
      }

      const cleaned = {
        ...saved,
        entries: [...unique.values()],
        selected,
        currentClasses,
        customNames
      };

      if (JSON.stringify(cleaned) !== JSON.stringify(saved)) {
        await chrome.storage.local.set({ [MAIN_STORAGE_KEY]: cleaned });
        changed = true;
      }
      return changed;
    } catch (error) {
      console.warn("Panopto Course Filter: could not normalize cross-listed course state.", error);
      return false;
    }
  }

  function keepCrossListedCardsVisible() {
    chrome.storage.local.get(MAIN_STORAGE_KEY).then(result => {
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;
      const selected = Array.isArray(saved.selected) ? saved.selected.map(String) : [];
      const selected5830 = selected.some(key => /\|COMP-5830(?:-|$)/.test(key));
      if (!selected5830) return;

      document.querySelectorAll("a[href]").forEach(link => {
        if (link.closest?.("#pcf-panel")) return;
        const href = link.getAttribute("href") || "";
        if (!/viewer|session|recording/i.test(href)) return;
        let current = link;
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++, current = current.parentElement) {
          const text = normalize(current.innerText || current.textContent);
          if (!isCrossListedText(text)) continue;
          if (getComputedStyle(current).display === "none") {
            current.classList.add("pcf-crosslisted-selected");
            current.style.setProperty("display", "revert", "important");
            current.style.removeProperty("visibility");
            current.style.removeProperty("opacity");
            current.style.removeProperty("pointer-events");
          }
          break;
        }
      });
    }).catch(() => {});
  }

  async function run() {
    const changed = await normalizeStorage();
    mergeRows();
    keepCrossListedCardsVisible();

    if (changed && sessionStorage.getItem("pcfCrossListedNormalized") !== "1") {
      sessionStorage.setItem("pcfCrossListedNormalized", "1");
      setTimeout(() => location.reload(), 50);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(run, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(run, 700);
})();
