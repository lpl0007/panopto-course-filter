(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const state = PCF.state;

  function restoreAll() {
    document
      .querySelectorAll(
        ".pcf-recording-hidden"
      )
      .forEach(element => {
        element.classList.remove(
          "pcf-recording-hidden"
        );

        element.style.removeProperty(
          "display"
        );

        element.style.removeProperty(
          "visibility"
        );

        element.removeAttribute(
          "hidden"
        );
      });
  }

  function applyFilter() {
    /*
     * CRITICAL SAFETY RULE:
     *
     * The extension never filters a Panopto
     * viewer page.
     */
    if (
      PCF.isViewerPage &&
      PCF.isViewerPage()
    ) {
      return;
    }

    restoreAll();

    if (
      !PCF.isFilterablePage ||
      !PCF.isFilterablePage()
    ) {
      return;
    }

    if (
      !state.enabled ||
      state.selected.length === 0
    ) {
      PCF.updatePanel();
      return;
    }

    const selected =
      new Set(state.selected);

    const recordings =
      PCF.getRecordings();

    for (const recording of recordings) {
      const courses =
        PCF.getRecordingCourses(
          recording
        );

      /*
       * Unknown course:
       *
       * Never hide something when we cannot
       * confidently determine its course.
       */
      if (courses.length === 0) {
        continue;
      }

      const matches =
        courses.some(course =>
          selected.has(course.key)
        );

      if (matches) {
        continue;
      }

      const container =
        recording.container;

      if (
        !PCF.isSafeToHide(container)
      ) {
        continue;
      }

      container.classList.add(
        "pcf-recording-hidden"
      );
    }

    PCF.updatePanel();
  }

  PCF.restoreAll = restoreAll;
  PCF.applyFilter = applyFilter;
})();
