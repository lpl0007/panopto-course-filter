(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const state = PCF.state;

  let scanTimer = null;
  let navigationTimer = null;
  let observer = null;

  /*
   * A Panopto viewer is the one place where this
   * extension must completely stay out of the DOM.
   */
  function isViewerPage(url = location.href) {
    try {
      const parsed = new URL(url);

      const pathname =
        parsed.pathname.toLowerCase();

      return (
        /\/panopto\/pages\/viewer\.aspx$/i.test(
          pathname
        ) &&
        parsed.searchParams.has("id")
      );
    } catch {
      return false;
    }
  }

  /*
   * Check whether a link is a Panopto recording.
   *
   * We intentionally use URL parsing instead of
   * one exact CSS selector so small Panopto URL
   * formatting changes don't kill the extension.
   */
  function isRecordingLink(link) {
    if (!(link instanceof HTMLAnchorElement)) {
      return false;
    }

    try {
      const url = new URL(
        link.href,
        location.href
      );

      const pathname =
        url.pathname.toLowerCase();

      /*
       * Normal Panopto viewer URL.
       */
      if (
        /\/panopto\/pages\/viewer\.aspx$/i.test(
          pathname
        ) &&
        url.searchParams.has("id")
      ) {
        return true;
      }

      /*
       * Keep compatibility with the older v2
       * recording/session detection.
       */
      return (
        /viewer|session/i.test(
          url.href
        ) &&
        url.searchParams.has("id")
      );

    } catch {
      return false;
    }
  }

  function hasRecordingLinks(root = document) {
    if (
      !root ||
      !(root.querySelectorAll)
    ) {
      return false;
    }

    const links =
      root.querySelectorAll("a[href]");

    for (const link of links) {
      if (isRecordingLink(link)) {
        return true;
      }
    }

    return false;
  }

  function isFilterablePage() {
    /*
     * Never consider the actual video viewer
     * filterable.
     */
    if (isViewerPage()) {
      return false;
    }

    return hasRecordingLinks();
  }

  function wait(ms) {
    return new Promise(resolve =>
      setTimeout(resolve, ms)
    );
  }

  function mutationContainsRecording(
    mutations
  ) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          !(node instanceof Element)
        ) {
          continue;
        }

        /*
         * The added element itself may be the link.
         */
        if (
          node instanceof HTMLAnchorElement &&
          isRecordingLink(node)
        ) {
          return true;
        }

        /*
         * Or a recording link may be somewhere
         * inside the newly-added element.
         */
        if (
          hasRecordingLinks(node)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function scheduleScan(
    immediate = false
  ) {
    clearTimeout(scanTimer);

    if (isViewerPage()) {
      return;
    }

    scanTimer =
      setTimeout(
        async () => {
          /*
           * The viewer check happens again when
           * the delayed scan actually executes.
           */
          if (isViewerPage()) {
            return;
          }

          if (
            !isFilterablePage()
          ) {
            return;
          }

          if (state.loading) {
            return;
          }

          if (
            !PCF.extensionAlive()
          ) {
            return;
          }

          try {
            await PCF.discoverCourses();

            if (
              isViewerPage()
            ) {
              return;
            }

            PCF.applyFilter();

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
              console.warn(
                "Panopto Course Filter scan failed:",
                error
              );
            }
          }
        },
        immediate ? 0 : 700
      );
  }

  function installObserver() {
    if (observer) {
      return;
    }

    if (!document.body) {
      return;
    }

    observer =
      new MutationObserver(
        mutations => {
          /*
           * NEVER process mutations on a viewer.
           */
          if (isViewerPage()) {
            return;
          }

          /*
           * Only wake the scanner when something
           * resembling a recording was added.
           */
          if (
            !mutationContainsRecording(
              mutations
            )
          ) {
            return;
          }

          scheduleScan();
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  async function handleNavigation(
    url
  ) {
    if (
      !PCF.extensionAlive()
    ) {
      return;
    }

    state.lastUrl = url;
    state.generation += 1;

    /*
     * ENTERING VIEWER
     *
     * Shut everything down before Panopto's
     * player gets a chance to be affected.
     */
    if (isViewerPage(url)) {
      clearTimeout(scanTimer);

      stopObserver();

      PCF.hideExtensionUi();

      return;
    }

    /*
     * We left the viewer.
     *
     * Give Panopto time to build the next page.
     */
    await wait(500);

    if (
      isViewerPage()
    ) {
      return;
    }

    /*
     * The UI can safely come back now.
     */
    PCF.showExtensionUi();

    /*
     * This may simply be another Panopto page.
     * That's okay — leave the UI alone and wait.
     */
    if (
      !isFilterablePage()
    ) {
      return;
    }

    installObserver();

    try {
      await PCF.discoverCourses();

      if (
        isViewerPage()
      ) {
        return;
      }

      PCF.applyFilter();
      PCF.updatePanel();

      scheduleScan();

      setTimeout(() => {
        if (!isViewerPage()) {
          scheduleScan();
        }
      }, 2500);

      setTimeout(() => {
        if (!isViewerPage()) {
          scheduleScan();
        }
      }, 5000);

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
        console.warn(
          "Panopto Course Filter navigation failed:",
          error
        );
      }
    }
  }

  function watchUrl() {
    setInterval(() => {
      const currentUrl =
        location.href;

      if (
        currentUrl ===
        state.lastUrl
      ) {
        return;
      }

      clearTimeout(
        navigationTimer
      );

      navigationTimer =
        setTimeout(() => {
          handleNavigation(
            currentUrl
          ).catch(error => {
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
              console.warn(
                "Panopto Course Filter navigation failed:",
                error
              );
            }
          });
        }, 50);

    }, 100);
  }

  PCF.isViewerPage =
    isViewerPage;

  PCF.isFilterablePage =
    isFilterablePage;

  PCF.scheduleScan =
    scheduleScan;

  PCF.installObserver =
    installObserver;

  PCF.stopObserver =
    stopObserver;

  PCF.handleNavigation =
    handleNavigation;

  PCF.watchUrl =
    watchUrl;
})();
