(() => {
  "use strict";

  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";
  const CROSS_LISTED_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\s*\/\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?(?:\s*\/\s*([A-Z0-9]{1,8}))?\b/gi;
  let active = true;
  let observer = null;
  let interval = null;
  let runTimer = null;

  const normalize = text => String(text || "").replace(/\s+/g, " ").trim();

  function isInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function stopIfInvalidated(error) {
    if (!isInvalidated(error)) return false;
    active = false;
    if (observer) observer.disconnect();
    if (interval) clearInterval(interval);
    if (runTimer) clearTimeout(runTimer);
    return true;
  }

  function discoverCrossListedPairs() {
    const pairs = new Map();
    const scan = text => {
      CROSS_LISTED_RE.lastIndex = 0;
      let match;
      while ((match = CROSS_LISTED_RE.exec(text))) {
        const subject = match[1].toUpperCase();
        const first = Math.min(Number(match[2]), Number(match[3]));
        const second = Math.max(Number(match[2]), Number(match[3]));
        if (first === second) continue;
        pairs.set(`${subject}-${first}/${second}`, { subject, first: String(first), second: String(second) });
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
    const number = Number(match[2]);
    return pairs.find(pair => pair.subject === match[1] && (Number(pair.first) === number || Number(pair.second) === number)) || null;
  }

  function canonicalKey(key, pairs) {
    const value = String(key || "");
    const separator = value.indexOf("|");
    if (separator < 0) return value;
    const course = value.slice(separator + 1);
    const pair = pairForCourse(course, pairs);
    return `${value.slice(0, separator)}|${pair ? `${pair.subject}-${pair.first}` : course}`;
  }

  function mergeRows(pairs) {
    const panel = document.querySelector("#pcf-panel");
    if (!panel) return;
    const groups = new Map();

    for (const row of panel.querySelectorAll(".pcf-course-row")) {
      const node = row.querySelector(".pcf-course");
      const match = normalize(node && (node.innerText || node.textContent)).match(/\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/i);
      if (!match) continue;
      const course = `${match[1].toUpperCase()}-${match[2]}`;
      const pair = pairForCourse(course, pairs);
      if (!pair) continue;
      const group = row.closest(".pcf-semester-courses");
      const header = group?.previousElementSibling;
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
      const preferred = rows.find(row => Number(row.querySelector(".pcf-course")?.textContent.match(/\d{3,5}/)?.[0]) === Number(pair.first)) || rows[0];
      const name = preferred.querySelector(".pcf-course-display-name");
      if (name) name.textContent = `${pair.subject}-${pair.first}/${pair.second}`;
      const checkbox = preferred.querySelector("input[type='checkbox']");
      if (checkbox) checkbox.dataset.crosslistedCourse = `${pair.subject}-${pair.first}/${pair.second}`;
      const ignore = preferred.querySelector(".pcf-ignore-fix");
      if (ignore) {
        ignore.dataset.crosslistedCourse = `${pair.subject}-${pair.first}/${pair.second}`;
        ignore.dataset.courseKey = canonicalKey(ignore.dataset.courseKey, pairs);
      }
      rows.forEach(row => { if (row !== preferred) row.remove(); });
    }
  }

  async function normalizeStorage(pairs) {
    try {
      if (!active) return false;
      const result = await chrome.storage.local.get(MAIN_STORAGE_KEY);
      if (!active) return false;
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return false;

      const unique = new Map();
      for (const entry of Array.isArray(saved.entries) ? saved.entries : []) {
        if (!entry?.key) continue;
        const key = canonicalKey(entry.key, pairs);
        const separator = key.indexOf("|");
        const course = separator >= 0 ? key.slice(separator + 1) : entry.course;
        unique.set(key, { ...entry, key, course });
      }
      const normalizeKeys = values => [...new Set((Array.isArray(values) ? values : []).map(value => canonicalKey(value, pairs)))];
      const customNames = {};
      for (const [key, value] of Object.entries(saved.customNames || {})) customNames[canonicalKey(key, pairs)] = value;
      const cleaned = { ...saved, entries: [...unique.values()], selected: normalizeKeys(saved.selected), currentClasses: normalizeKeys(saved.currentClasses), customNames };

      const changed = JSON.stringify(cleaned) !== JSON.stringify(saved);
      if (changed) {
        if (!active) return false;
        await chrome.storage.local.set({ [MAIN_STORAGE_KEY]: cleaned });
      }
      return changed;
    } catch (error) {
      if (!stopIfInvalidated(error)) console.warn("Panopto Course Filter: could not normalize cross-listed course state.", error);
      return false;
    }
  }

  async function keepCrossListedCardsVisible(pairs) {
    try {
      if (!active) return;
      const result = await chrome.storage.local.get(MAIN_STORAGE_KEY);
      if (!active) return;
      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;
      const selected = Array.isArray(saved.selected) ? saved.selected.map(String) : [];
      const selectedPairs = pairs.filter(pair => selected.some(key => key.includes(`|${pair.subject}-${pair.first}`)));
      if (!selectedPairs.length) return;

      document.querySelectorAll("a[href]").forEach(link => {
        if (!active || link.closest?.("#pcf-panel")) return;
        if (!/viewer|session|recording/i.test(link.getAttribute("href") || "")) return;
        let current = link;
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++, current = current.parentElement) {
          const text = normalize(current.innerText || current.textContent).toUpperCase();
          const pair = selectedPairs.find(item => text.includes(`${item.subject}-${item.first}`) || text.includes(`${item.subject}-${item.second}`));
          if (!pair) continue;
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
    } catch (error) {
      if (!stopIfInvalidated(error)) console.warn("Panopto Course Filter: could not restore cross-listed recordings.", error);
    }
  }

  async function run() {
    if (!active) return;
    try {
      const pairs = discoverCrossListedPairs();
      if (!pairs.length) return;
      const changed = await normalizeStorage(pairs);
      if (!active) return;
      mergeRows(pairs);
      await keepCrossListedCardsVisible(pairs);
      if (!active) return;
      if (changed && sessionStorage.getItem("pcfCrossListedNormalizedV4") !== "1") {
        sessionStorage.setItem("pcfCrossListedNormalizedV4", "1");
        setTimeout(() => { if (active) location.reload(); }, 50);
      }
    } catch (error) {
      if (!stopIfInvalidated(error)) console.warn("Panopto Course Filter: cross-listed helper failed.", error);
    }
  }

  function scheduleRun(delay = 150) {
    if (!active) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(run, delay);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scheduleRun(0), { once: true });
  else scheduleRun(0);

  observer = new MutationObserver(() => scheduleRun(150));
  observer.observe(document.body, { childList: true, subtree: true });
  interval = setInterval(run, 700);
})();