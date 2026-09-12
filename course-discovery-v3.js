(() => {
  "use strict";

  const STORAGE_KEY = "panoptoCourseFilterV14";
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/gi;
  const CROSS_LISTED_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\s*\/\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?(?:\s*\/\s*([A-Z0-9]{1,8}))?\b/gi;
  const PAIR_A = /\b(Fall|Spring|Summer)\s+(\d{4})[\s\S]{0,280}?\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/gi;
  const PAIR_B = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b[\s\S]{0,280}?\b(Fall|Spring|Summer)\s+(\d{4})\b/gi;

  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const termName = (term, year) => `${term[0].toUpperCase()}${term.slice(1).toLowerCase()} ${year}`;

  function add(found, term, year, course) {
    const semester = termName(term, year);
    const key = `${semester}|${course}`;
    found.set(key, { key, term: semester.split(" ")[0], year: semester.split(" ")[1], course });
  }

  function scanCrossListed(text, found, semester) {
    CROSS_LISTED_RE.lastIndex = 0;
    let match;
    while ((match = CROSS_LISTED_RE.exec(text))) {
      const subject = match[1].toUpperCase();
      const first = match[2];
      const second = match[3];
      if (!semester) continue;
      add(found, semester.term, semester.year, `${subject}-${first}`);
      add(found, semester.term, semester.year, `${subject}-${second}`);
    }
  }

  function scanPairs(text, found) {
    let match;
    PAIR_A.lastIndex = 0;
    while ((match = PAIR_A.exec(text))) {
      const semester = { term: match[1], year: match[2] };
      scanCrossListed(match[0], found, semester);
      add(found, match[1], match[2], `${match[3].toUpperCase()}-${match[4]}`);
    }

    PAIR_B.lastIndex = 0;
    while ((match = PAIR_B.exec(text))) {
      const semester = { term: match[3], year: match[4] };
      scanCrossListed(match[0], found, semester);
      add(found, match[3], match[4], `${match[1].toUpperCase()}-${match[2]}`);
    }
  }

  function scanVisibleNodes(found) {
    const elements = [...document.querySelectorAll("body *")].filter(el => !el.closest?.("#pcf-panel"));
    for (const element of elements) {
      const parts = [element.innerText || element.textContent || ""];
      for (const attr of element.attributes || []) {
        if (attr.name !== "class" && attr.name !== "style" && attr.value) parts.push(attr.value);
      }
      const text = parts.join(" | ");
      if (text.length < 3 || text.length > 5000) continue;

      const semesterMatch = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i.exec(text);
      if (semesterMatch) {
        const semester = { term: semesterMatch[1], year: semesterMatch[2] };
        scanCrossListed(text, found, semester);
        COURSE_RE.lastIndex = 0;
        let course;
        while ((course = COURSE_RE.exec(text))) add(found, semesterMatch[1], semesterMatch[2], `${course[1].toUpperCase()}-${course[2]}`);
      }
      scanPairs(text, found);
    }
  }

  function normalizeSaved(saved) {
    const map = new Map();
    for (const item of Array.isArray(saved.entries) ? saved.entries : []) {
      if (!item || !item.key) continue;
      const split = String(item.key).indexOf("|");
      if (split < 0) continue;
      const semester = String(item.key).slice(0, split).trim();
      const course = String(item.key).slice(split + 1).toUpperCase().replace(/[-–—]/g, "-").split("-").slice(0, 2).join("-");
      if (!semester || !course) continue;
      map.set(`${semester}|${course}`, { ...item, key: `${semester}|${course}`, term: semester.split(" ")[0], year: semester.split(" ")[1], course });
    }
    return map;
  }

  async function scan() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;

      const found = new Map();
      scanVisibleNodes(found);
      scanPairs(document.documentElement?.outerHTML || "", found);
      if (!found.size) return;

      const entries = normalizeSaved(saved);
      for (const item of found.values()) entries.set(item.key, item);

      const cleaned = { ...saved, entries: [...entries.values()] };
      if (JSON.stringify(cleaned) === JSON.stringify(saved)) return;
      await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });

      if (sessionStorage.getItem("pcfDiscoveryV4Reloaded") !== "1") {
        sessionStorage.setItem("pcfDiscoveryV4Reloaded", "1");
        setTimeout(() => location.reload(), 50);
      }
    } catch (error) {
      console.warn("Panopto Course Filter: discovery v4 failed.", error);
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }

  function start() {
    scan();
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === "childList" && !m.target?.closest?.("#pcf-panel"))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let attempts = 0;
    const interval = setInterval(() => {
      scan();
      attempts++;
      if (attempts >= 120) { clearInterval(interval); observer.disconnect(); }
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
