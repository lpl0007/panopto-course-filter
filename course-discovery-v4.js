(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const BAD_SUBJECTS = new Set(["FALL", "SPRING", "SUMMER", "SP", "SU", "FA"]);
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const CROSS_LISTED_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\s*\/\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?(?:\s*\/\s*([A-Z0-9]{1,8}))?\b/gi;

  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const semesterOf = text => {
    const m = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i.exec(normalize(text));
    return m ? { term: m[1], year: m[2] } : null;
  };
  const add = (found, semester, course) => {
    const subject = String(course).split("-")[0].toUpperCase();
    if (!semester || BAD_SUBJECTS.has(subject)) return;
    const term = `${semester.term[0].toUpperCase()}${semester.term.slice(1).toLowerCase()}`;
    const key = `${term} ${semester.year}|${course}`;
    found.set(key, { key, term, year: semester.year, course });
  };
  const coursesOf = text => {
    COURSE_RE.lastIndex = 0;
    const out = [];
    let m;
    while ((m = COURSE_RE.exec(normalize(text)))) {
      const subject = m[1].toUpperCase();
      if (BAD_SUBJECTS.has(subject)) continue;
      out.push(`${subject}-${m[2]}${m[3] ? `-${m[3].toUpperCase()}` : ""}`);
    }
    return [...new Set(out)];
  };
  const crossListedOf = (text, semester, found) => {
    CROSS_LISTED_RE.lastIndex = 0;
    let m;
    while ((m = CROSS_LISTED_RE.exec(normalize(text)))) {
      const subject = m[1].toUpperCase();
      if (BAD_SUBJECTS.has(subject)) continue;
      add(found, semester, `${subject}-${m[2]}`);
      add(found, semester, `${subject}-${m[3]}`);
    }
  };

  function scan(found) {
    const selectors = "a, span, p, [role='treeitem'], [class*='card'], [class*='Card']";
    document.querySelectorAll(selectors).forEach(el => {
      if (el.closest?.("#pcf-panel")) return;
      const text = normalize(el.innerText || el.textContent);
      if (text.length < 8 || text.length > 350) return;

      let semester = semesterOf(text);
      if (!semester) {
        let parent = el.parentElement;
        for (let depth = 0; depth < 3 && parent; depth++, parent = parent.parentElement) {
          const parentText = normalize(parent.innerText || parent.textContent);
          if (parentText.length > 500) break;
          semester = semesterOf(parentText);
          if (semester) break;
        }
      }
      if (!semester) return;

      crossListedOf(text, semester, found);
      for (const course of coursesOf(text)) add(found, semester, course);
    });
  }

  function normalizeSaved(saved) {
    const map = new Map();
    for (const item of Array.isArray(saved.entries) ? saved.entries : []) {
      if (!item?.key) continue;
      const split = String(item.key).indexOf("|");
      if (split < 0) continue;
      const semester = String(item.key).slice(0, split).trim();
      const raw = String(item.key).slice(split + 1).toUpperCase().replace(/[-–—]/g, "-");
      const parts = raw.split("-");
      const course = parts.slice(0, 2).join("-");
      if (!semester || !course || BAD_SUBJECTS.has(parts[0])) continue;
      map.set(`${semester}|${course}`, { ...item, key: `${semester}|${course}`, course, term: semester.split(" ")[0], year: semester.split(" ")[1] });
    }
    return map;
  }

  async function run() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;
      const found = new Map();
      scan(found);
      if (!found.size) return;
      const entries = normalizeSaved(saved);
      for (const entry of found.values()) entries.set(entry.key, entry);
      const cleaned = { ...saved, entries: [...entries.values()] };
      if (JSON.stringify(cleaned) !== JSON.stringify(saved)) await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) console.warn("Panopto Course Filter: course discovery failed.", error);
    }
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  function start() {
    run();
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === "childList" && !m.target?.closest?.("#pcf-panel"))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let attempts = 0;
    const interval = setInterval(() => {
      run();
      if (++attempts >= 120) { clearInterval(interval); observer.disconnect(); }
    }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
