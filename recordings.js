(() => {
  "use strict";

  window.PCF = window.PCF || {};

  const MAX_CONTAINER_DEPTH = 8;
  const MAX_CONTEXT_DEPTH = 7;

  const VIEWER_SELECTOR =
    'a[href*="/Panopto/Pages/Viewer.aspx?id="]';

  function getViewerLinks() {
    if (
      PCF.isViewerPage &&
      PCF.isViewerPage()
    ) {
      return [];
    }

    return [
      ...document.querySelectorAll(
        VIEWER_SELECTOR
      )
    ];
  }

  function getViewerId(link) {
    try {
      const url = new URL(
        link.href,
        location.href
      );

      return (
        url.searchParams.get("id") ||
        link.href
      );
    } catch {
      return link.href;
    }
  }

  function isPageSized(element) {
    const rect =
      element.getBoundingClientRect();

    return (
      rect.width >=
        window.innerWidth * 0.90 &&
      rect.height >=
        window.innerHeight * 0.70
    );
  }

  function getViewerCount(element) {
    return element.querySelectorAll(
      VIEWER_SELECTOR
    ).length;
  }

  function getElementText(element) {
    return PCF.normalize(
      element.innerText ||
        element.textContent
    );
  }

  function isSafeRecordingContainer(
    element
  ) {
    if (
      !(element instanceof HTMLElement)
    ) {
      return false;
    }

    if (
      element === document.body ||
      element ===
        document.documentElement
    ) {
      return false;
    }

    if (isPageSized(element)) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    if (
      rect.width < 150 ||
      rect.height < 40
    ) {
      return false;
    }

    const viewerCount =
      getViewerCount(element);

    if (viewerCount > 2) {
      return false;
    }

    const text =
      getElementText(element);

    if (
      text.length < 1 ||
      text.length >= 1500
    ) {
      return false;
    }

    return true;
  }

  function getRecordingContainer(
    link
  ) {
    let current = link;

    for (
      let depth = 0;
      depth < MAX_CONTAINER_DEPTH &&
      current;
      depth++
    ) {
      if (
        isSafeRecordingContainer(
          current
        )
      ) {
        return current;
      }

      current =
        current.parentElement;
    }

    const parent =
      link.parentElement;

    if (
      parent &&
      !isPageSized(parent) &&
      parent !== document.body &&
      parent !==
        document.documentElement
    ) {
      return parent;
    }

    return link;
  }

  function getRecordings() {
    if (
      PCF.isViewerPage &&
      PCF.isViewerPage()
    ) {
      return [];
    }

    const links =
      getViewerLinks();

    const seen = new Set();
    const recordings = [];

    for (const link of links) {
      const id =
        getViewerId(link);

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);

      const container =
        getRecordingContainer(
          link
        );

      recordings.push({
        id,
        link,
        container
      });
    }

    return recordings;
  }

  function getRecordingCourses(
    recording
  ) {
    const found = new Map();

    let current =
      recording.container;

    for (
      let depth = 0;
      depth < MAX_CONTEXT_DEPTH &&
      current;
      depth++
    ) {
      if (isPageSized(current)) {
        break;
      }

      const text =
        getElementText(current);

      if (
        text.length > 0 &&
        text.length < 2500
      ) {
        for (const entry of PCF.parseCourses(
          text
        )) {
          found.set(
            entry.key,
            entry
          );
        }
      }

      current =
        current.parentElement;
    }

    return [...found.values()];
  }

  function isSafeToHide(
    container
  ) {
    if (
      !(container instanceof HTMLElement)
    ) {
      return false;
    }

    if (
      container === document.body ||
      container ===
        document.documentElement
    ) {
      return false;
    }

    if (isPageSized(container)) {
      return false;
    }

    const viewerCount =
      getViewerCount(container);

    return viewerCount <= 2;
  }

  PCF.getViewerLinks =
    getViewerLinks;

  PCF.getViewerId =
    getViewerId;

  PCF.getRecordingContainer =
    getRecordingContainer;

  PCF.getRecordings =
    getRecordings;

  PCF.getRecordingCourses =
    getRecordingCourses;

  PCF.isSafeToHide =
    isSafeToHide;
})();
