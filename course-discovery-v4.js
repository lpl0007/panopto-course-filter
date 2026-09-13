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

  function canonicalTerm(semester) {
    return `${semester.term[0].toUpperCase()}${semester.term.slice(1).toLowerCase()} ${semester.year}`;
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
      const before = normalized.slice(0, match.index);
      const after = normalized.slice(match.index + match[0].length);
      if (/\/\s*\d{3,5}/.test(after) || /\d{3,5}\s*\/\s*$/.test(before)) continue;
      courses.push([subject, match[2]]);
    }

    const unique = new Map();
    courses.forEach(([subject, number]) => unique.set(`${subject}-${number}`, [subject, number]));
    return [...unique.values()];
  }

  function addGroup(found, semester, courses) {
    if (!semester || !courses.length || courses.length > 2) return;

    const unique = [...new Map(courses.map(([subject, number]) => [
      `${subject}-${number}`,
      [subject, number]
    ])).values()];

    if (!unique.length) return;

    const term = canonicalTerm(semester);
    const aliases = unique.map(([subject, number]) => `${subject}-${number}`);
    const primaryCourse = aliases[0];
    const displayCourse = aliases.length === 1
      ? primaryCourse
      : aliases.join(" / ");
    const key = `${term}|${primaryCourse}`;

    found.set(key, {
      key,
      term: term.split(" ")[0],
      year: term.split(" ")[1],
      course: primaryCourse,
      aliases,
      displayCourse
    });
  }

  function extractFromText(text, found) {
    const normalized = normalize(text);
    if (normalized.length < 8 || normalized.length > 350) return;

    const semester = semesterOf(normalized);
    if (!semester) return;

    const termCount = (normalized.match(/\b(Fall|Spring|Summer)\s+\d{4}\b/gi) || []).length;
    if (termCount !== 1) return;

    const courses = extractCoursePairs(normalized);
    if (!courses.length || courses.length > 2) return;

    addGroup(found, semester, courses);
  }

  function scanPairText(text, found) {
    const normalized = normalize(text);
    const semester = semesterOf(normalized);
    if (!semester) return;

    PAREN_RE.lastIndex = 0;
    let match;
    while ((match = PAREN_RE.exec(normalized))) {
      const courses = extractCoursePairs(match[1]);
      if (courses.length === 2) addGroup(found, semester, courses);
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

    const normalizeKeys = values => [...new Set(Array.isArray(values) ? values.map(String) : [])];
    const customNames = saved.customNames && typeof saved.customNames === "object"
      ? { ...saved.customNames }
      : {};

    for (const entry of entries) {
      if (entry.displayCourse && entry.displayCourse !== entry.course && !customNames[entry.key]) {
        customNames[entry.key] = entry.displayCourse;
      }
    }

    return {
      ...saved,
      entries,
      selected: normalizeKeys(saved.selected),
      currentClasses: normalizeKeys(saved.currentClasses),
      customNames
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

      for (const entry of found.values()) discovered.set(entry.key, entry);

      const validKeys = new Set(discovered.keys());
      const cleaned = normalizeSaved(saved, validKeys);
      cleaned.entries = [...discovered.values()];

      if (JSON.stringify(cleaned) !== JSON.stringify(saved)) {
        await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });
      }
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) {
        console.warn("Panopto Course Filter: grouped course discovery failed.", error);
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
      if (mutations.some(m => m.type === "childList" && !m.target?.closest?.("#pcf-panel"))) schedule();
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
