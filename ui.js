(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const state = PCF.state;

  let statusTimer = null;

  function createPanel() {
    if (
      document.getElementById(
        "pcf-panel"
      )
    ) {
      return;
    }

    const panel =
      document.createElement("div");

    panel.id = "pcf-panel";

    panel.innerHTML = `
      <div class="pcf-header">
        <strong>🎓 Panopto Courses</strong>
        <button id="pcf-close" type="button">×</button>
      </div>

      <input
        id="pcf-search"
        type="search"
        placeholder="Search courses..."
        autocomplete="off"
      >

      <div class="pcf-current">
        <strong>⭐ Current Classes</strong>

        <div>
          <button id="pcf-current" type="button">
            Use Current
          </button>

          <button id="pcf-save" type="button">
            Save Selected
          </button>

          <button
            id="pcf-clear-current"
            type="button"
          >
            Clear Saved
          </button>
        </div>
      </div>

      <button
        id="pcf-load"
        class="pcf-load"
        type="button"
      >
        🔎 Load Matching Recordings
      </button>

      <div
        id="pcf-status"
        class="pcf-status"
        aria-live="polite"
      ></div>

      <div class="pcf-actions">
        <button id="pcf-term" type="button">
          Current Semester
        </button>

        <button id="pcf-none" type="button">
          Show All
        </button>
      </div>

      <label class="pcf-toggle">
        <input
          id="pcf-enabled"
          type="checkbox"
        >
        Enable Filter
      </label>

      <div id="pcf-list"></div>

      <div class="pcf-footer">
        <div id="pcf-count"></div>

        <button id="pcf-scan" type="button">
          ↻ Scan
        </button>

        <button
          id="pcf-clear"
          class="pcf-danger"
          type="button"
        >
          🗑 Clear All Courses
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    document.getElementById(
      "pcf-close"
    ).onclick = () => {
      panel.classList.add(
        "pcf-hidden"
      );
    };

    const enabled =
      document.getElementById(
        "pcf-enabled"
      );

    enabled.checked = state.enabled;

    enabled.onchange = async event => {
      state.enabled =
        event.target.checked;

      state.generation += 1;

      await PCF.saveState();

      if (!state.enabled) {
        PCF.restoreAll();
      }

      PCF.applyFilter();
    };

    document.getElementById(
      "pcf-search"
    ).oninput = () => {
      updatePanel();
    };

    document.getElementById(
      "pcf-none"
    ).onclick = async () => {
      state.generation += 1;
      state.selected = [];

      await PCF.saveState();

      PCF.restoreAll();
      PCF.applyFilter();

      showStatus(
        "Showing all recordings."
      );
    };

    document.getElementById(
      "pcf-term"
    ).onclick = async () => {
      const current =
        PCF.currentTerm();

      state.selected =
        state.entries
          .filter(entry =>
            entry.term ===
              current.term &&
            Number(entry.year) ===
              current.year
          )
          .map(entry => entry.key);

      state.generation += 1;

      await PCF.saveState();

      PCF.applyFilter();

      showStatus(
        `Selected ${current.term} ${current.year}.`
      );
    };

    document.getElementById(
      "pcf-current"
    ).onclick = async () => {
      state.selected = [
        ...state.currentClasses
      ];

      state.generation += 1;

      await PCF.saveState();

      if (
        state.selected.length === 0
      ) {
        PCF.restoreAll();
      }

      PCF.applyFilter();
    };

    document.getElementById(
      "pcf-save"
    ).onclick = async () => {
      state.currentClasses = [
        ...state.selected
      ];

      await PCF.saveState();

      updatePanel();

      showStatus(
        "Current classes saved."
      );
    };

    document.getElementById(
      "pcf-clear-current"
    ).onclick = async () => {
      state.currentClasses = [];

      await PCF.saveState();

      updatePanel();

      showStatus(
        "Saved current classes cleared."
      );
    };

    document.getElementById(
      "pcf-scan"
    ).onclick = async () => {
      if (
        PCF.isViewerPage &&
        PCF.isViewerPage()
      ) {
        return;
      }

      await PCF.discoverCourses();

      PCF.applyFilter();
      updatePanel();

      showStatus(
        `Scan complete — ${state.entries.length} courses discovered.`
      );
    };

    document.getElementById(
      "pcf-clear"
    ).onclick = async () => {
      if (
        !confirm(
          "Clear ALL discovered courses and saved current classes?"
        )
      ) {
        return;
      }

      state.generation += 1;

      await PCF.clearAllCourses();
    };

    updateLoadButton();
  }

  function updatePanel() {
    const list =
      document.getElementById(
        "pcf-list"
      );

    if (!list) {
      return;
    }

    const search =
      PCF.normalize(
        document.getElementById(
          "pcf-search"
        )?.value
      ).toUpperCase();

    list.innerHTML = "";

    const groups = new Map();

    state.entries
      .filter(entry =>
        !search ||
        PCF.entryLabel(entry)
          .toUpperCase()
          .includes(search)
      )
      .forEach(entry => {
        const key =
          `${entry.term} ${entry.year}`;

        if (!groups.has(key)) {
          groups.set(key, []);
        }

        groups
          .get(key)
          .push(entry);
      });

    for (const [
      semester,
      entries
    ] of groups) {
      createSemesterGroup(
        list,
        semester,
        entries
      );
    }

    const count =
      document.getElementById(
        "pcf-count"
      );

    if (count) {
      const recordings =
        PCF.getRecordings();

      count.innerHTML = `
        <div>
          <strong>${state.selected.length}</strong>
          selected
        </div>

        <div>
          <strong>${recordings.length}</strong>
          recordings on page
        </div>

        <div>
          <strong>${state.entries.length}</strong>
          discovered courses
        </div>

        ${
          state.currentClasses.length
            ? `
              <div>
                ⭐ ${state.currentClasses.length}
                saved current
              </div>
            `
            : ""
        }
      `;
    }

    updateLoadButton();
  }

  function createSemesterGroup(
    list,
    semester,
    entries
  ) {
    const header =
      document.createElement("div");

    header.className =
      "pcf-semester";

    const collapsed =
      !!state.collapsedSemesters[
        semester
      ];

    const collapseButton =
      document.createElement("button");

    collapseButton.type = "button";
    collapseButton.className =
      "pcf-collapse";
    collapseButton.textContent =
      collapsed ? "▶" : "▼";

    const title =
      document.createElement("strong");

    title.textContent = semester;

    const selectAll =
      document.createElement("button");

    selectAll.type = "button";
    selectAll.className =
      "pcf-select-all";
    selectAll.textContent = "All";

    header.appendChild(
      collapseButton
    );

    header.appendChild(title);
    header.appendChild(selectAll);

    list.appendChild(header);

    const courses =
      document.createElement("div");

    courses.className =
      "pcf-courses";

    courses.style.display =
      collapsed ? "none" : "";

    collapseButton.onclick =
      async () => {
        state.collapsedSemesters[
          semester
        ] =
          !state.collapsedSemesters[
            semester
          ];

        await PCF.saveState();

        updatePanel();
      };

    selectAll.onclick =
      async () => {
        const keys =
          entries.map(
            entry => entry.key
          );

        const allSelected =
          keys.length > 0 &&
          keys.every(key =>
            state.selected.includes(
              key
            )
          );

        if (allSelected) {
          state.selected =
            state.selected.filter(
              key =>
                !keys.includes(key)
            );
        } else {
          for (const key of keys) {
            if (
              !state.selected.includes(
                key
              )
            ) {
              state.selected.push(key);
            }
          }
        }

        state.generation += 1;

        await PCF.saveState();

        if (
          state.selected.length === 0
        ) {
          PCF.restoreAll();
        }

        PCF.applyFilter();
      };

    for (const entry of entries) {
      createCourseCheckbox(
        courses,
        entry
      );
    }

    list.appendChild(courses);
  }

  function createCourseCheckbox(
    parent,
    entry
  ) {
    const label =
      document.createElement("label");

    label.className =
      "pcf-course";

    const checkbox =
      document.createElement("input");

    checkbox.type = "checkbox";

    checkbox.checked =
      state.selected.includes(
        entry.key
      );

    checkbox.onchange =
      async () => {
        state.generation += 1;

        if (checkbox.checked) {
          if (
            !state.selected.includes(
              entry.key
            )
          ) {
            state.selected.push(
              entry.key
            );
          }
        } else {
          state.selected =
            state.selected.filter(
              key =>
                key !== entry.key
            );
        }

        await PCF.saveState();

        if (
          state.selected.length === 0
        ) {
          PCF.restoreAll();
        }

        PCF.applyFilter();
      };

    label.appendChild(checkbox);

    label.appendChild(
      document.createTextNode(
        entry.course
      )
    );

    if (
      state.currentClasses.includes(
        entry.key
      )
    ) {
      const star =
        document.createElement("span");

      star.textContent = " ★";
      star.className = "pcf-star";

      label.appendChild(star);
    }

    parent.appendChild(label);
  }

  function updateLoadButton() {
    const button =
      document.getElementById(
        "pcf-load"
      );

    if (!button) {
      return;
    }

    if (state.loading) {
      button.textContent =
        "⏳ Loading recordings…";

      button.disabled = true;
      button.onclick = null;
    } else {
      button.textContent =
        "🔎 Load Matching Recordings";

      button.disabled = false;
      button.onclick =
        PCF.loadRecordings;
    }
  }

  function showStatus(text) {
    const element =
      document.getElementById(
        "pcf-status"
      );

    if (!element) {
      return;
    }

    element.textContent = text;

    clearTimeout(statusTimer);

    statusTimer =
      setTimeout(() => {
        if (element) {
          element.textContent = "";
        }
      }, 5000);
  }

  function createLauncher() {
    if (
      document.getElementById(
        "pcf-launcher"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");

    button.id =
      "pcf-launcher";

    button.type = "button";
    button.textContent =
      "🎓 Courses";

    button.onclick = () => {
      const panel =
        document.getElementById(
          "pcf-panel"
        );

      if (!panel) {
        return;
      }

      panel.classList.remove(
        "pcf-hidden"
      );

      updatePanel();
    };

    document.body.appendChild(
      button
    );
  }

  function showExtensionUi() {
    const panel =
      document.getElementById(
        "pcf-panel"
      );

    const launcher =
      document.getElementById(
        "pcf-launcher"
      );

    panel?.classList.remove(
      "pcf-hidden"
    );

    launcher?.classList.remove(
      "pcf-hidden"
    );
  }

  function hideExtensionUi() {
    /*
     * This is only used during SPA transitions.
     * The viewer itself is never filtered.
     */
    document
      .getElementById("pcf-panel")
      ?.classList.add("pcf-hidden");

    document
      .getElementById("pcf-launcher")
      ?.classList.add(
        "pcf-hidden"
      );
  }

  PCF.createPanel = createPanel;
  PCF.updatePanel = updatePanel;
  PCF.updateLoadButton =
    updateLoadButton;
  PCF.showStatus = showStatus;
  PCF.createLauncher =
    createLauncher;
  PCF.showExtensionUi =
    showExtensionUi;
  PCF.hideExtensionUi =
    hideExtensionUi;
})();
