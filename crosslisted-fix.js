(() => {
  "use strict";

  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";
  const CROSS_LISTED_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\s*\/\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?(?:\s*\/\s*([A-Z0-9]{1,8}))?\b/gi;

  const normalize = text => String(text || "").replace(/\s+/g, " ").trim();

  function discoverCrossListedPairs() {
    const pairs = new Map();
    const scan = text => {
      CROSS_LISTED_RE.lastIndex = 0;
      let match;
      while ((match = CROSS_LISTED_RE.exec(text))) {
        const subject = match[1].toUpperCase();
        const a = match[2];
        const b = match[3];
        const first = Math.min(Number(a), Number(b));
        const second = Math.max(Number(a), Number(b));
        if (first === second) continue;
        pairs.set(`${subject}-${first}/${second}`, {
          subject,
          first: String(first),
          second: String(second)
        });
      }
    };

    document.querySelectorAll("body *").forEach(element => {
      if (element.closest?.("#pcf-panel")) return;
      const text = normalize(element.innerText || element.textContent);
      if (text.length >= 5 && text.length <= 5000) scan(text);
    });

    scan(document.documentElement?.outerHTML || "");
    return [...pairs.values()];
  }

  function pairForCourse(course, pairs) {
    const match = String(course || "").toUpperCase().match(/^([A-Z]{2,8})-(\d{3,5})(?:-|$)/);
    if (!match) return null;
    const subject = match[1];
    const number = Number(match[2]);
    return pairs.find(pair => pair.subject === subject && (Number(pair.first) === number || Number(pair.second) === number)) || null;
  }

  function canonicalCourse(course, pairs) {
    const pair = pairForCourse(course, pairs);
    if (!pair) return String(course || "");
    return `${pair.subject}-${pair.first}`;
  }

  function canonicalKey(key, pairs) {
    const value = String(key || "");
    const separator = value.indexOf("|");
    if (separator < 0) return value;
    const semester = value.slice(0, separator);
    const course = value.slice(separator + 1);
    const canonical = canonicalCourse(course, pairs);
    return `${semester}|${canonical}`;
  }

  function courseRows() {
    const panel = document.querySelector("#pcf-panel");
    return panel ? [...panel.querySelectorAll(".pcf-course-row")] : [];
  }

  function rowCourse(row) {
    const node = row.querySelector(".pcf-course");
    return normalize(node && (node.innerText || node.textContent)).match(/\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/i)?.[0]?.replace(/\s*[-–—]\s*/g, "-").toUpperCase() || null;
  }

  function mergeRows(pairs) {
    const groups = new Map();

    for (const row of courseRows()) {
      const course = rowCourse(row);
      const pair = pairForCourse(course, pairs);
      if (!pair) continue;

      const group = row.closest(".pcf-semester-courses");
      const header = group && group.previousElementSibling;
      const semester = normalize(header && (header.innerText || header.textContent));
      if (!semester) continue;

      const key = `${semester}|${pair.subject}-${pair.first}/${pair.second}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    for (const [key, rows] of groups) {
      if (rows.length < 2) continue;

      const pair = pairs.find(item => key.endsWith(`${item.subject}-${item.first}/${item.second}`));
      if (!pair) continue;

      const first = rows[0];
      const firstNumber = Number(rowCourse(first)?.match(/(\d{3,5})/)?.[1]);
      const preferred = rows.find(row => firstNumber !== Number(pair.first) && Number(rowCourse(row)?.match(/(\d{3,5})/)?.[1]) === Number(pair.first)) || first;
      const name = preferred.querySelector(".pcf-course-display-name");
      if (name) {
        name.textContent = `${pair.subject}-${pair.first}/${pair.second}`;
        name.title = `${pair.subject}-${pair.first}/${pair.second} (cross-listed)`;
      }

      const checkbox = preferred.querySelector("input[type='checkbox']");
      if (checkbox) {
        checkbox.dataset.crosslistedCourse = `${pair.subject}-${pair.first}/${pair.second}`;
      }

      const ignore = preferred.querySelector(".pcf-ignore-fix");
      if (ignore) {
        ignore.dataset.crosslistedCourse = `${pair.subject}-${pair.first}/${pair.second}`;
        ignore.dataset.courseKey = canonicalKey(ignore.dataset.courseKey, pairs);
      }

      for (const row of rows) {
        if (row !== preferred) row.remove();
      }
    }
  }

  async function normalizeStorage(pairs) {
    try {
      const result = await chrome.storage.local.get(MAIN_STORAGE_KEY);
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return false;

      const entries = Array.isArray(saved.entries) ? saved.entries : [];
      const unique = new Map();
      let changed = false;

      for (const entry of entries) {
        if (!entry || !entry.key) continue;
        const key = canonicalKey(entry.key, pairs);
        const separator = key.indexOf("|");
        const course = separator >= 0 ? key.slice(separator + 1) : entry.course;
        if (key !== entry.key || course !== entry.course) changed = true;
        unique.set(key, { ...entry, key, course });
      }

      const normalizeKeys = values => [...new Set((Array.isArray(values) ? values : []).map(value => canonicalKey(value, pairs)))];
      const selected = normalizeKeys(saved.selected);
      const currentClasses = normalizeKeys(saved.currentClasses);
      const customNames = {};
      for (const [key, value] of Object.entries(saved.customNames || {})) {
        customNames[canonicalKey(key, pairs)] = value;
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

  function keepCrossListedCardsVisible(pairs) {
    chrome.storage.local.get(MAIN_STORAGE_KEY).then(result => {
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;
      const selected = Array.isArray(saved.selected) ? saved.selected.map(String) : [];

      const selectedPairs = pairs.filter(pair => selected.some(key => key.includes(`|${pair.subject}-${pair.first}`)));
      if (!selectedPairs.length) return;

      document.querySelectorAll("a[href]").forEach(link => {
        if (link.closest?.("#pcf-panel")) return;
        const href = link.getAttribute("href") || "";
        if (!/viewer|session|recording/i.test(href)) return;

        let current = link;
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++, current = current.parentElement) {
          const text = normalize(current.innerText || current.textContent).toUpperCase();
          const matchingPair = selectedPairs.find(pair => text.includes(`${pair.subject}-${pair.first}`) && text.includes(`${pair.subject}-${pair.second}`));
          if (!matchingPair) continue;

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
    const pairs = discoverCrossListedPairs();
    if (!pairs.length) return;

    const changed = await normalizeStorage(pairs);
    mergeRows(pairs);
    keepCrossListedCardsVisible(pairs);

    if (changed && sessionStorage.getItem("pcfCrossListedNormalizedV2") !== "1") {
      sessionStorage.setItem("pcfCrossListedNormalizedV2", "1");
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
    observer.timer = setTimeout(run, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(run, 700);
})();
