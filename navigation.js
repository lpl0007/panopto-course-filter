(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const state = PCF.state;

  let scanTimer = null;
  let navigationTimer = null;
  let observer = null;

  function isViewerPage(
    url = location.href
  ) {
    try {
      const parsed =
        new URL(url);

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

  function isFilterablePage() {
    if (isViewerPage()) {
      return false;
    }

    /*
     * The extension should only operate on pages
     * that actually contain Panopto recording links.
     *
     * This prevents unrelated Panopto pages from
     * being treated like recording lists.
     */
    return (
      document.querySelector(
        'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
      ) !== null
    );
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

        if (
          node.matches(
            'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
          )
        ) {
          return true;
        }

        if (
          node.querySelector(
            'a[href*="/Panopto/Pages/Viewer.aspx?id="]'
          )
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
          if (
            isViewerPage() ||
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
           * NEVER process mutations on a viewer page.
           */
          if (isViewerPage()) {
            return;
          }

          /*
           * Avoid rescanning for every little DOM
           * mutation. We only care when recording
           * links are added.
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
     * IMPORTANT:
     *
     * Once we reach the viewer, the extension
     * becomes dormant. It does not discover courses,
     * filter recordings, or run scans.
     */
    if (isViewerPage(url)) {
      clearTimeout(scanTimer);

      /*
       * We stop observing the viewer.
       */
      stopObserver();

      /*
       * Don't run any filtering code here.
       */
      PCF.hideExtensionUi();

      return;
    }

    /*
     * We have left the viewer.
     *
     * Give Panopto a moment to construct the
     * recordings page before scanning it.
     */
    await wait(500);

    if (
      isViewerPage()
    ) {
      return;
    }

    PCF.showExtensionUi();

    if (
      !isFilterablePage()
    ) {
      /*
       * This is some other Panopto page.
       * Do not touch its DOM.
       */
      return;
    }

    installObserver();

    await PCF.discoverCourses();

    if (
      isViewerPage()
    ) {
      return;
    }

    PCF.applyFilter();
    PCF.updatePanel();

    scheduleScan();

    setTimeout(
      () => {
        if (
          !isViewerPage()
        ) {
          scheduleScan();
        }
      },
      2500
    );

    setTimeout(
      () => {
        if (
          !isViewerPage()
        ) {
          scheduleScan();
        }
      },
      5000
    );
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
