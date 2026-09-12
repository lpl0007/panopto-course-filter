(() => {
  "use strict";

  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/i;
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function rowKey(row) {
    const courseNode = row.querySelector(".pcf-course");
    const text = normalize(courseNode && (courseNode.innerText || courseNode.textContent));
    const course = COURSE_RE.exec(text);
    if (!course) return null;

    const group = row.closest(".pcf-semester-courses");
    const header = group && group.previousElementSibling;
    const semester = SEMESTER_RE.exec(normalize(header && (header.innerText || header.textContent)));
    if (!semester) return null;

    return `${semester[1][0].toUpperCase()}${semester[1].slice(1).toLowerCase()} ${semester[2]}|${course[1].toUpperCase()}-${course[2]}`;
  }

  function ensureButton(row, key) {
    let button = row.querySelector(".pcf-ignore-fix");
    if (button) return button;
    button = document.createElement("button");
    button.type = "button";
    button.className = "pcf-ignore-fix";
    button.dataset.courseKey = key;
    button.textContent = "🚫";
    button.title = "Ignore this course";
    button.setAttribute("aria-label", "Ignore this course");
    row.appendChild(button);
    return button;
  }

  function repair() {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;

    const seen = new Map();
    const rows = [...panel.querySelectorAll(".pcf-course-row")];

    for (const row of rows) {
      const key = rowKey(row);
      if (!key) continue;

      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, row);
        ensureButton(row, key);
        continue;
      }

      if (!existing.querySelector(".pcf-ignore-fix") && row.querySelector(".pcf-ignore-fix")) {
        existing.appendChild(row.querySelector(".pcf-ignore-fix"));
      }

      row.remove();
    }
  }

  function start() {
    repair();
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === "childList" && m.target?.closest?.("#pcf-panel"))) {
        repair();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    let attempts = 0;
    const timer = setInterval(() => {
      repair();
      attempts++;
      if (attempts >= 60) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
