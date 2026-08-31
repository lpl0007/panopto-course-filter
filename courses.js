(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const state = PCF.state;

  const COURSE_PATTERNS = [
    /\b(Fall|Spring|Summer)\s+(\d{4})\s*[-–—]\s*([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\b/gi,

    /\b([A-Z]{2,8})\s*[-–—]\s*(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*[-–—]\s*(Fall|Spring|Summer)\s+(\d{4})\b/gi,

    /\b([A-Z]{2,8})\s+(\d{3,5})(?:\s*[-–—]\s*([A-Z0-9]{1,8}))?\s*\(\s*(Fall|Spring|Summer)\s+(\d{4})\s*\)/gi
  ];

  function normalize(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCourses(text) {
    text = normalize(text);

    if (!text) {
      return [];
    }

    const found = new Map();

    for (const pattern of COURSE_PATTERNS) {
      pattern.lastIndex = 0;

      let match;

      while ((match = pattern.exec(text))) {
        let term;
        let year;
        let subject;
        let number;
        let section;

        if (
          /Fall|Spring|Summer/i.test(
            match[1]
          )
        ) {
          term =
            match[1][0].toUpperCase() +
            match[1]
              .slice(1)
              .toLowerCase();

          year = match[2];
          subject =
            match[3].toUpperCase();
          number = match[4];
          section = match[5] || "";
        } else {
          subject =
            match[1].toUpperCase();
          number = match[2];
          section = match[3] || "";

          term =
            match[4][0].toUpperCase() +
            match[4]
              .slice(1)
              .toLowerCase();

          year = match[5];
        }

        const course =
          `${subject}-${number}${
            section
              ? "-" + section.toUpperCase()
              : ""
          }`;

        const entry = {
          key: `${term} ${year}|${course}`,
          term,
          year,
          course
        };

        found.set(entry.key, entry);
      }
    }

    return [...found.values()];
  }

  function sortEntries(entries) {
    const order = {
      Fall: 3,
      Summer: 2,
      Spring: 1
    };

    return [...entries].sort((a, b) => {
      const yearDiff =
        Number(b.year) - Number(a.year);

      if (yearDiff) {
        return yearDiff;
      }

      const termDiff =
        (order[b.term] || 0) -
        (order[a.term] || 0);

      if (termDiff) {
        return termDiff;
      }

      return a.course.localeCompare(
        b.course
      );
    });
  }

  function entryLabel(entry) {
    return `${entry.term} ${entry.year} — ${entry.course}`;
  }

  function mergeEntries(entries) {
    const merged = new Map(
      state.entries.map(entry => [
        entry.key,
        entry
      ])
    );

    for (const entry of entries) {
      merged.set(entry.key, entry);
    }

    state.entries = sortEntries([
      ...merged.values()
    ]);

    const valid = new Set(
      state.entries.map(entry => entry.key)
    );

    state.selected =
      state.selected.filter(key =>
        valid.has(key)
      );

    state.currentClasses =
      state.currentClasses.filter(key =>
        valid.has(key)
      );
  }

  function collectCourseText() {
    const discovered = [];

    const bodyText = normalize(
      document.body?.innerText || ""
    );

    discovered.push(
      ...parseCourses(bodyText)
    );

    const elements =
      document.querySelectorAll(
        "a,span,p,div,li,td,button"
      );

    for (const element of elements) {
      const text = normalize(
        element.innerText ||
          element.textContent
      );

      if (
        text.length <= 5 ||
        text.length >= 2500
      ) {
        continue;
      }

      discovered.push(
        ...parseCourses(text)
      );
    }

    return discovered;
  }

  async function discoverCourses() {
    if (
      PCF.isViewerPage &&
      PCF.isViewerPage()
    ) {
      return;
    }

    const discovered =
      collectCourseText();

    mergeEntries(discovered);

    await PCF.saveState();
  }

  async function clearAllCourses() {
    state.entries = [];
    state.selected = [];
    state.currentClasses = [];
    state.collapsedSemesters = {};

    await PCF.saveState();

    if (
      PCF.isFilterablePage &&
      !PCF.isFilterablePage()
    ) {
      return;
    }

    await discoverCourses();

    PCF.restoreAll();
    PCF.applyFilter();
    PCF.updatePanel();

    PCF.showStatus(
      `Course list cleared. ${state.entries.length} courses rediscovered.`
    );
  }

  function currentTerm() {
    const date = new Date();

    const month =
      date.getMonth() + 1;

    const year =
      date.getFullYear();

    if (month <= 5) {
      return {
        term: "Spring",
        year
      };
    }

    if (month <= 7) {
      return {
        term: "Summer",
        year
      };
    }

    return {
      term: "Fall",
      year
    };
  }

  PCF.normalize = normalize;
  PCF.parseCourses = parseCourses;
  PCF.sortEntries = sortEntries;
  PCF.entryLabel = entryLabel;
  PCF.discoverCourses =
    discoverCourses;
  PCF.clearAllCourses =
    clearAllCourses;
  PCF.currentTerm = currentTerm;
})();
