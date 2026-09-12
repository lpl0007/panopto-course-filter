(() => {
  "use strict";

  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";
  const COURSE_RE = /\bCOMP\s*[-–—]?\s*(5830|6830)\b/gi;

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
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
      if (name) name.textContent = "COMP-5830/6830";
      if (name) name.title = "COMP-5830/6830 (cross-listed)";

      const checkbox = first.querySelector("input[type='checkbox']");
      if (checkbox) checkbox.dataset.crosslisted58306830 = "true";

      const ignore = first.querySelector(".pcf-ignore-fix");
      if (ignore) {
        ignore.dataset.crosslisted58306830 = "true";
        ignore.dataset.courseKey = ignore.dataset.courseKey.replace(/COMP-(?:5830|6830)/, "COMP-5830");
      }

      second.remove();
    }
  }

  function syncStorage() {
    chrome.storage.local.get(MAIN_STORAGE_KEY).then(result => {
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;

      const selected = Array.isArray(saved.selected) ? saved.selected : [];
      const has5830 = selected.some(key => /\|COMP-5830(?:-|$)/.test(String(key)));
      const has6830 = selected.some(key => /\|COMP-6830(?:-|$)/.test(String(key)));
      if (!has5830 && !has6830) return;

      const nextSelected = [...new Set(selected.map(key => {
        const value = String(key);
        if (/\|COMP-6830(?:-|$)/.test(value)) return value.replace(/\|COMP-6830/, "|COMP-5830");
        return value;
      }))];

      if (JSON.stringify(nextSelected) !== JSON.stringify(selected)) {
        chrome.storage.local.set({ [MAIN_STORAGE_KEY]: { ...saved, selected: nextSelected } });
      }
    }).catch(() => {});
  }

  function keepCrossListedCardsVisible() {
    const savedPromise = chrome.storage.local.get(MAIN_STORAGE_KEY).catch(() => ({}));
    savedPromise.then(result => {
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;
      const selected = Array.isArray(saved.selected) ? saved.selected.map(String) : [];
      const selected5830 = selected.some(key => /\|COMP-5830(?:-|$)/.test(key));
      const selected6830 = selected.some(key => /\|COMP-6830(?:-|$)/.test(key));
      if (!selected5830 && !selected6830) return;

      document.querySelectorAll("a[href]").forEach(link => {
        if (link.closest?.("#pcf-panel")) return;
        const href = link.getAttribute("href") || "";
        if (!/viewer|session|recording/i.test(href)) return;
        let current = link;
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++, current = current.parentElement) {
          const text = normalize(current.innerText || current.textContent);
          if (!isCrossListedText(text)) continue;
          const style = getComputedStyle(current);
          if (style.display === "none") {
            current.classList.add("pcf-crosslisted-selected");
            current.style.setProperty("display", "revert", "important");
            current.style.removeProperty("visibility");
            current.style.removeProperty("opacity");
            current.style.removeProperty("pointer-events");
          }
          break;
        }
      });
    });
  }

  function run() {
    mergeRows();
    syncStorage();
    keepCrossListedCardsVisible();
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
