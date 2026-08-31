(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const STORAGE_KEY = "panoptoCourseFilterV12";

  const state = {
    entries: [],
    selected: [],
    currentClasses: [],
    collapsedSemesters: {},
    enabled: true,

    loading: false,

    lastUrl: location.href,
    generation: 0,

    initialized: false
  };

  function extensionAlive() {
    try {
      return !!(
        chrome &&
        chrome.runtime &&
        chrome.runtime.id &&
        chrome.storage &&
        chrome.storage.local
      );
    } catch {
      return false;
    }
  }

  async function safeStorageGet(key) {
    if (!extensionAlive()) {
      return null;
    }

    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      if (
        String(error?.message || error)
          .toLowerCase()
          .includes("context invalidated")
      ) {
        return null;
      }

      console.warn(
        "Panopto Course Filter: storage read failed",
        error
      );

      return null;
    }
  }

  async function safeStorageSet(data) {
    if (!extensionAlive()) {
      return false;
    }

    try {
      await chrome.storage.local.set(data);
      return true;
    } catch (error) {
      if (
        String(error?.message || error)
          .toLowerCase()
          .includes("context invalidated")
      ) {
        return false;
      }

      console.warn(
        "Panopto Course Filter: storage write failed",
        error
      );

      return false;
    }
  }

  function sanitizeState() {
    state.entries = Array.isArray(state.entries)
      ? state.entries.filter(
          entry =>
            entry &&
            typeof entry.key === "string" &&
            ["Fall", "Spring", "Summer"].includes(
              entry.term
            ) &&
            /^\d{4}$/.test(String(entry.year)) &&
            typeof entry.course === "string"
        )
      : [];

    state.selected = Array.isArray(state.selected)
      ? state.selected.filter(
          key => typeof key === "string"
        )
      : [];

    state.currentClasses = Array.isArray(
      state.currentClasses
    )
      ? state.currentClasses.filter(
          key => typeof key === "string"
        )
      : [];

    state.collapsedSemesters =
      state.collapsedSemesters &&
      typeof state.collapsedSemesters === "object"
        ? state.collapsedSemesters
        : {};

    state.enabled =
      typeof state.enabled === "boolean"
        ? state.enabled
        : true;
  }

  async function loadState() {
    const result =
      await safeStorageGet(STORAGE_KEY);

    if (result?.[STORAGE_KEY]) {
      Object.assign(
        state,
        result[STORAGE_KEY]
      );
    }

    sanitizeState();
  }

  async function saveState() {
    return safeStorageSet({
      [STORAGE_KEY]: {
        entries: state.entries,
        selected: state.selected,
        currentClasses:
          state.currentClasses,
        collapsedSemesters:
          state.collapsedSemesters,
        enabled: state.enabled
      }
    });
  }

  function bumpGeneration() {
    state.generation += 1;
    return state.generation;
  }

  PCF.STORAGE_KEY = STORAGE_KEY;
  PCF.state = state;
  PCF.extensionAlive = extensionAlive;
  PCF.loadState = loadState;
  PCF.saveState = saveState;
  PCF.bumpGeneration = bumpGeneration;
})();
