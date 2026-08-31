(() => {
  "use strict";

  window.PCF = window.PCF || {};

  async function getScrollContainers() {
    const result = [];

    document
      .querySelectorAll(
        "div,main,section,ul,ol"
      )
      .forEach(element => {
        const style =
          getComputedStyle(element);

        if (
          (
            style.overflowY === "auto" ||
            style.overflowY === "scroll"
          ) &&
          element.scrollHeight >
            element.clientHeight + 150
        ) {
          result.push(element);
        }
      });

    return result;
  }

  async function loadRecordings() {
    const state = PCF.state;

    if (
      state.loading ||
      PCF.isViewerPage()
    ) {
      return;
    }

    const generation =
      PCF.bumpGeneration();

    if (
      state.selected.length === 0
    ) {
      PCF.restoreAll();
      PCF.applyFilter();

      PCF.showStatus(
        "No courses selected — showing everything."
      );

      return;
    }

    state.loading = true;

    PCF.updateLoadButton();

    PCF.restoreAll();

    let previous = 0;
    let unchanged = 0;

    try {
      for (
        let round = 0;
        round < 50;
        round++
      ) {
        /*
         * Stop immediately if navigation occurred.
         */
        if (
          generation !==
            state.generation ||
          PCF.isViewerPage()
        ) {
          return;
        }

        /*
         * Load the main document.
         */
        window.scrollTo({
          top:
            document.documentElement
              .scrollHeight,
          behavior: "instant"
        });

        /*
         * Load any nested Panopto scroll areas.
         */
        const containers =
          await getScrollContainers();

        for (const element of containers) {
          try {
            element.scrollTop =
              element.scrollHeight;
          } catch {
            // Ignore inaccessible scroll containers.
          }
        }

        await new Promise(resolve =>
          setTimeout(resolve, 900)
        );

        if (
          generation !==
            state.generation ||
          PCF.isViewerPage()
        ) {
          return;
        }

        const count =
          PCF.getRecordings().length;

        if (count <= previous) {
          unchanged += 1;
        } else {
          unchanged = 0;
          previous = count;
        }

        PCF.showStatus(
          `Loading recordings… ${count} found`
        );

        if (
          unchanged >= 7
        ) {
          break;
        }
      }

      if (
        generation !==
          state.generation ||
        PCF.isViewerPage()
      ) {
        return;
      }

      await PCF.discoverCourses();
    } finally {
      if (
        generation ===
        state.generation
      ) {
        state.loading = false;

        if (
          !PCF.isViewerPage()
        ) {
          PCF.applyFilter();
          PCF.updateLoadButton();

          PCF.showStatus(
            `Finished. ${PCF.getRecordings().length} recordings found.`
          );
        }
      }
    }
  }

  PCF.loadRecordings =
    loadRecordings;

  async function init() {
    /*
     * If the extension was reloaded while this
     * page was open, Chrome may invalidate the
     * content-script context.
     */
    if (
      !PCF.extensionAlive()
    ) {
      return;
    }

    try {
      await PCF.loadState();

      if (
        !PCF.extensionAlive()
      ) {
        return;
      }

      /*
       * We always watch navigation because Panopto
       * can change pages without a traditional reload.
       */
      PCF.watchUrl();

      /*
       * If the initial page is a viewer, stop here.
       *
       * This is the second major safety net.
       */
      if (
        PCF.isViewerPage()
      ) {
        return;
      }

      /*
       * Do not touch arbitrary Panopto pages.
       */
      if (
        !PCF.isFilterablePage()
      ) {
        return;
      }

      PCF.createPanel();
      PCF.createLauncher();

      await PCF.discoverCourses();

      if (
        !PCF.extensionAlive() ||
        PCF.isViewerPage()
      ) {
        return;
      }

      PCF.restoreAll();
      PCF.applyFilter();

      PCF.installObserver();

      /*
       * Panopto can finish rendering additional
       * recordings after document_idle.
       */
      PCF.scheduleScan();

      setTimeout(
        () => {
          if (
            !PCF.isViewerPage()
          ) {
            PCF.scheduleScan();
          }
        },
        2500
      );

      setTimeout(
        () => {
          if (
            !PCF.isViewerPage()
          ) {
            PCF.scheduleScan();
          }
        },
        5000
      );
    } catch (error) {
      const message =
        String(
          error?.message ||
            error
        ).toLowerCase();

      if (
        !message.includes(
          "context invalidated"
        )
      ) {
        console.error(
          "Panopto Course Filter initialization failed:",
          error
        );
      }
    }
  }

  init();
})();
