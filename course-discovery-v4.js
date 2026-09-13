(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const BAD_SUBJECTS = new Set(["FALL", "SPRING", "SUMMER", "SP", "SU", "FA"]);
  const TERM_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;
  const STANDARD_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const CROSS_RE = /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})\s*\/\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?(?:\s*\/\s*([A-Z0-9]{1,8}))?\b/gi;
  const PAREN_RE = /\(([^()]{1,220})\)/g;

  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();

  function semesterOf(text) {
    const match = TERM_RE.exec(normalize(text));
    return match ? { term: match[1], year: match[2] } : null;
  }

  function add(found, semester, subject, number) {
    subject = String(subject || "").toUpperCase();
    number = String(number || "");
    if (!semester || !number || BAD_SUBJECTS.has(subject)) return;

    const term = `${semester.term[0].toUpperCase()}${semester.term.slice(1).toLowerCase()}`;
    const course = `${subject}-${number}`;
    const key = `${term} ${semester.year}|${course}`;
    found.set(key, {
      key,
      term,
      year: semester.year,
      course
    });
  }

  function extractCoursePairs(text) {
    const courses = [];
    const normalized = normalize(text);

    CROSS_RE.lastIndex = 0;
    let match;
    while ((match = CROSS_RE.exec(normalized))) {
      const subject = match[1].toUpperCase();
      if (BAD_SUBJECTS.has(subject)) continue;
      courses.push([subject, match[2]]);
      courses.push([subject, match[3]]);
    }

    STANDARD_RE.lastIndex = 0;
    while ((match = STANDARD_RE.exec(normalized))) {
      const subject = match[1].toUpperCase();
      if (BAD_SUBJECTS.has(subject)) continue;

      // A cross-listed label has already supplied both course numbers.
      const before = normalized.slice(0, match.index);
      const after = normalized.slice(match.index + match[0].length);
      if (/\/\s*\d{3,5}/.test(after) || /\d{3,5}\s*\/\s*$/.test(before)) continue;

      courses.push([subject, match[2]]);
    }

    return [...new Map(courses.map(([subject, number]) => [`${subject}-${number}`, [subject, number]])).values()];
  }

  function extractFromText(text, found) {
    const normalized = normalize(text);
    if (normalized.length < 8 || normalized.length > 350) return;

    const semester = semesterOf(normalized);
    if (!semester) return;

    // A real Browse folder label contains the semester and its own course code.
    // Do not inherit a semester from a large parent container: that was the source
    // of false associations such as BUAL-2650 appearing under Spring 2026.
    const termCount = (normalized.match(/\b(Fall|Spring|Summer)\s+\d{4}\b/gi) || []).length;
    if (termCount !== 1) return;

    const courses = extractCoursePairs(normalized);
    if (!courses.length || courses.length > 2) return;

    for (const [subject, number] of courses) {
      add(found, semester, subject, number);
    }
  }

  function scanPairText(text, found) {
    const normalized = normalize(text);
    const semester = semesterOf(normalized);
    if (!semester) return;

    PAREN_RE.lastIndex = 0;
    let match;
    while ((match = PAREN_RE.exec(normalized))) {
      const courses = extractCoursePairs(match[1]);
      if (courses.length === 2) {
        for (const [subject, number] of courses) add(found, semester, subject, number);
      }
    }
  }

  function scan(found) {
    const selectors = "a, span, p, [role='treeitem'], [class*='card'], [class*='Card']";

    for (const element of document.querySelectorAll(selectors)) {
      if (element.closest?.("#pcf-panel")) continue;

      const text = normalize(element.innerText || element.textContent);
      if (text.length < 8 || text.length > 350) continue;

      extractFromText(text, found);
      scanPairText(text, found);
    }
  }

  function normalizeSaved(saved, validKeys) {
    const entries = [];
    const seen = new Set();

    for (const item of Array.isArray(saved.entries) ? saved.entries : []) {
      if (!item?.key || !validKeys.has(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      entries.push(item);
    }

    const normalizeKeys = values => [...new Set(
      (Array.isArray(values) ? values : [])
        .map(String)
        .filter(key => validKeys.has(key))
    )];

    return {
      ...saved,
      entries,
      selected: normalizeKeys(saved.selected),
      currentClasses: normalizeKeys(saved.currentClasses)
    };
  }

  let discovered = new Map();
  let timer = null;

  async function run() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;

      const found = new Map();
      scan(found);
      if (!found.size) return;

      // Accumulate only strictly identified Browse labels as Panopto loads them.
      // Once we have at least one valid label, replace the polluted legacy list
      // rather than merging old false semester associations back in.
      for (const entry of found.values()) discovered.set(entry.key, entry);

      const validKeys = new Set(discovered.keys());
      const cleaned = normalizeSaved(saved, validKeys);
      cleaned.entries = [...discovered.values()];

      if (JSON.stringify(cleaned) !== JSON.stringify(saved)) {
        await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });
      }
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) {
        console.warn("Panopto Course Filter: strict course discovery failed.", error);
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  function start() {
    run();

    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === "childList" && !m.target?.closest?.("#pcf-panel"))) {
        schedule();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    let attempts = 0;
    const interval = setInterval(() => {
      run();
      if (++attempts >= 120) {
        clearInterval(interval);
        observer.disconnect();
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
