(() => {
  "use strict";

  const MAIN_STORAGE_KEY = "panoptoCourseFilterV14";
  const RUN_KEY = "pcfDiscoveryFixV2Reloaded";

  const COURSE_RE = /\b([A-Z]{2,8})\s*[-–—]?\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi;
  const SEMESTER_RE = /\b(Fall|Spring|Summer)\s+(\d{4})\b/i;

  const normalize = text => (text || "").replace(/\s+/g, " ").trim();

  function semesterFromText(text) {
    const match = SEMESTER_RE.exec(normalize(text));
    return match
      ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}`
      : null;
  }

  function coursesFromText(text) {
    COURSE_RE.lastIndex = 0;
    const result = [];
    let match;

    while ((match = COURSE_RE.exec(normalize(text)))) {
      result.push(`${match[1].toUpperCase()}-${match[2]}`);
    }

    return [...new Set(result)];
  }

  function makeEntry(semester, course) {
    return {
      key: `${semester}|${course}`,
      term: semester.split(" ")[0],
      year: semester.split(" ")[1],
      course
    };
  }

  function uniqueSemester(text) {
    const matches = normalize(text).match(
      /\b(?:Fall|Spring|Summer)\s+\d{4}\b/gi
    ) || [];

    return matches.length === 1
      ? semesterFromText(matches[0])
      : null;
  }

  function findSemesterForElement(element, ordered) {
    const ownText = normalize(
      element.innerText || element.textContent
    );

    const ownSemester = uniqueSemester(ownText);
    if (ownSemester) return ownSemester;

    /*
     * Prefer a nearby semantic container. Panopto frequently
     * renders the semester heading separately from the course
     * link, so looking only at the course node is insufficient.
     */
    let ancestor = element.parentElement;

    for (
      let depth = 0;
      depth < 7 && ancestor;
      depth++,
      ancestor = ancestor.parentElement
    ) {
      const text = normalize(
        ancestor.innerText || ancestor.textContent
      );

      if (text.length > 0 && text.length <= 900) {
        const semester = uniqueSemester(text);
        if (semester) return semester;
      }
    }

    /*
     * Finally walk backwards through nearby DOM elements. This
     * handles layouts where the semester heading and course are
     * siblings rather than sharing a useful parent.
     */
    const index = ordered.indexOf(element);
    if (index < 0) return null;

    for (
      let i = index - 1, distance = 0;
      i >= 0 && distance < 150;
      i--, distance++
    ) {
      const candidate = ordered[i];
      const text = normalize(
        candidate.innerText || candidate.textContent
      );

      const semester = uniqueSemester(text);

      if (
        semester &&
        text.length <= 300
      ) {
        return semester;
      }
    }

    return null;
  }

  function collectEntries() {
    const elements = [
      ...document.querySelectorAll("body *")
    ].filter(
      element => !element.closest?.("#pcf-panel")
    );

    const found = new Map();

    for (const element of elements) {
      const text = normalize(
        element.innerText || element.textContent
      );

      if (
        text.length < 3 ||
        text.length > 1600
      ) {
        continue;
      }

      const courses = coursesFromText(text);
      if (!courses.length) continue;

      const semester = findSemesterForElement(
        element,
        elements
      );

      if (!semester) continue;

      for (const course of courses) {
        const entry = makeEntry(
          semester,
          course
        );

        found.set(
          entry.key,
          entry
        );
      }
    }

    return [...found.values()];
  }

  function normalizeSavedEntries(saved) {
    const merged = new Map();

    for (
      const entry of Array.isArray(saved.entries)
        ? saved.entries
        : []
    ) {
      if (!entry || !entry.key) continue;

      const separator = String(entry.key).indexOf("|");
      if (separator < 0) continue;

      const semester = String(entry.key).slice(
        0,
        separator
      );

      const course = String(entry.key)
        .slice(separator + 1)
        .toUpperCase()
        .replace(/[-–—]/g, "-")
        .split("-")
        .slice(0, 2)
        .join("-");

      if (!semester || !course) continue;

      const key = `${semester}|${course}`;

      merged.set(key, {
        ...entry,
        key,
        term: semester.split(" ")[0],
        year: semester.split(" ")[1],
        course
      });
    }

    return merged;
  }

  let scanTimer = null;
  let reloadScheduled = false;
  let lastCandidateSignature = "";

  async function scan() {
    if (!chrome?.storage?.local) return;

    const entries = collectEntries();

    if (!entries.length) return;

    const candidateSignature = entries
      .map(entry => entry.key)
      .sort()
      .join("\n");

    if (candidateSignature === lastCandidateSignature) {
      return;
    }

    lastCandidateSignature = candidateSignature;

    try {
      const result = await chrome.storage.local.get(
        MAIN_STORAGE_KEY
      );

      const saved = result[MAIN_STORAGE_KEY];
      if (!saved || typeof saved !== "object") return;

      const merged = normalizeSavedEntries(saved);
      const before = merged.size;

      for (const entry of entries) {
        if (!merged.has(entry.key)) {
          merged.set(entry.key, entry);
        }
      }

      if (merged.size === before) return;

      const cleaned = {
        ...saved,
        entries: [...merged.values()]
      };

      await chrome.storage.local.set({
        [MAIN_STORAGE_KEY]: cleaned
      });

      /*
       * One reload per page load is enough. The reload lets the
       * main extension build its normal course list from the
       * expanded stored state. The session guard prevents a
       * reload loop.
       */
      if (
        !reloadScheduled &&
        sessionStorage.getItem(RUN_KEY) !== "1"
      ) {
        reloadScheduled = true;
        sessionStorage.setItem(RUN_KEY, "1");

        setTimeout(() => {
          location.reload();
        }, 50);
      }
    } catch (error) {
      console.warn(
        "Panopto Course Filter: discovery fix could not update course state.",
        error
      );
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      void scan();
    }, 250);
  }

  function start() {
    void scan();

    /*
     * Panopto is a React application and can insert course data
     * well after document_idle. Keep discovery alive while the
     * page is settling instead of doing only one initial scan.
     */
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;

        if (
          mutation.target?.closest?.("#pcf-panel")
        ) {
          continue;
        }

        if (mutation.addedNodes.length) {
          scheduleScan();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    /*
     * Also rescan periodically for content that changes without
     * producing a useful childList mutation.
     */
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      void scan();

      if (attempts >= 60) {
        clearInterval(timer);
        observer.disconnect();
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
