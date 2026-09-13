(() => {
  "use strict";

  const MAIN_KEY = "panoptoCourseFilterV14";
  const FIXES_KEY = "panoptoCourseFilterFixesV8";
  const BAD = new Set(["FALL", "SPRING", "SUMMER", "SP", "SU", "FA"]);
  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})\b/gi;
  const TERM_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  let mainState = null;
  let fixesState = null;
  let timer = null;

  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();

  function parseCourses(text) {
    COURSE_RE.lastIndex = 0;
    const result = [];
    let match;
    while ((match = COURSE_RE.exec(normalize(text)))) {
      const subject = match[1].toUpperCase();
      if (BAD.has(subject)) continue;
      result.push(`${subject}-${match[2]}`);
    }
    return [...new Set(result)];
  }

  function parseSemester(text) {
    const match = TERM_RE.exec(normalize(text));
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : null;
  }

  function aliasMap() {
    const map = new Map();
    const entries = Array.isArray(mainState?.entries) ? mainState.entries : [];
    entries.forEach(entry => {
      if (!entry?.key || !Array.isArray(entry.aliases) || entry.aliases.length < 2) return;
      const semester = String(entry.key).split("|")[0];
      entry.aliases.forEach(alias => {
        map.set(`${semester}|${String(alias).toUpperCase()}`, entry.key);
      });
    });
    return map;
  }

  function cardElements() {
    const cards = new Set();
    document.querySelectorAll("a[href]").forEach(link => {
      if (link.closest?.("#pcf-panel")) return;
      const href = link.getAttribute("href") || "";
      if (!/viewer|session|recording/i.test(href)) return;

      let current = link;
      for (let depth = 0; depth < 10 && current && current !== document.body; depth++, current = current.parentElement) {
        if (current.closest?.("#pcf-panel")) break;
        const rect = current.getBoundingClientRect();
        const text = normalize(current.innerText || current.textContent);
        const links = current.querySelectorAll("a[href]").length;
        if (rect.width > 150 && rect.height > 70 && rect.height < 750 && text.length >= 12 && text.length < 1400 && links <= 5 && parseCourses(text).length) {
          cards.add(current);
          break;
        }
      }
    });
    return [...cards];
  }

  function clearAliasStyles() {
    document.querySelectorAll(".pcf-alias-fix-hidden").forEach(card => {
      card.classList.remove("pcf-alias-fix-hidden");
      ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
    });
  }

  function hide(card) {
    card.classList.add("pcf-alias-fix-hidden");
    card.style.setProperty("display", "none", "important");
    card.style.setProperty("visibility", "hidden", "important");
    card.style.setProperty("opacity", "0", "important");
    card.style.setProperty("pointer-events", "none", "important");
  }

  function show(card) {
    if (!card.classList.contains("pcf-alias-fix-hidden")) return;
    card.classList.remove("pcf-alias-fix-hidden");
    ["display", "visibility", "opacity", "pointer-events"].forEach(prop => card.style.removeProperty(prop));
  }

  function apply() {
    const map = aliasMap();
    if (!map.size) return;

    const selected = new Set(Array.isArray(mainState?.selected) ? mainState.selected.map(String) : []);
    const enabled = mainState?.enabled !== false;
    const ignored = new Set(Array.isArray(fixesState?.ignored) ? fixesState.ignored.map(String) : []);
    const ignoreMode = fixesState?.mode !== "selected";

    cardElements().forEach(card => {
      const text = normalize(card.innerText || card.textContent);
      const semester = parseSemester(text);
      if (!semester) return;
      const courses = parseCourses(text);

      let matchedSharedKey = null;
      for (const course of courses) {
        const key = `${semester}|${course}`;
        const sharedKey = map.get(key);
        if (sharedKey) {
          matchedSharedKey = sharedKey;
          break;
        }
      }
      if (!matchedSharedKey) return;

      const entry = mainState.entries.find(item => item?.key === matchedSharedKey);
      if (!entry) return;
      const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      const isAliasOnly = courses.some(course => aliases.includes(course)) && !courses.includes(entry.course);
      if (!isAliasOnly) return;

      if (ignoreMode && ignored.has(matchedSharedKey)) {
        hide(card);
      } else if (enabled && !ignoreMode && selected.length > 0 && selected.has(matchedSharedKey)) {
        show(card);
      } else {
        show(card);
      }
    });
  }

  async function load() {
    try {
      const result = await chrome.storage.local.get([MAIN_KEY, FIXES_KEY]);
      mainState = result[MAIN_KEY] || null;
      fixesState = result[FIXES_KEY] || { mode: "ignore", ignored: [] };
      apply();
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) console.warn("Panopto Course Filter: course alias fix failed.", error);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(load, 100);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[MAIN_KEY] || changes[FIXES_KEY])) schedule();
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  load();
})();
