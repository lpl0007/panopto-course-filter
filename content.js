#pcf-panel {
  position: fixed;
  top: 80px;
  right: 18px;
  width: 320px;
  max-height: calc(100vh - 110px);
  z-index: 2147483647;

  background: white;
  color: #222;

  border: 1px solid #ccc;
  border-radius: 12px;

  box-shadow: 0 8px 30px rgba(0,0,0,.25);

  font-family: Arial, sans-serif;
  font-size: 14px;

  overflow: hidden;
}

#pcf-panel.pcf-hidden {
  display: none;
}

/* ---------------------------------------------------------
   HEADER
   --------------------------------------------------------- */

.pcf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  padding: 13px 14px;

  background: #f3f7f4;
  border-bottom: 1px solid #ddd;
}

.pcf-header strong {
  font-size: 15px;
}

#pcf-close {
  border: 0;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}

/* ---------------------------------------------------------
   DESCRIPTION / SEARCH
   --------------------------------------------------------- */

.pcf-description {
  padding: 10px 14px 5px;
  color: #666;
}

#pcf-search {
  box-sizing: border-box;

  width: calc(100% - 28px);
  margin: 8px 14px;

  padding: 8px 10px;

  border: 1px solid #bbb;
  border-radius: 7px;
}

/* ---------------------------------------------------------
   GLOBAL BUTTONS
   --------------------------------------------------------- */

.pcf-global-buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;

  gap: 6px;

  padding: 3px 14px 6px;
}

.pcf-global-buttons button {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 6px 9px;

  cursor: pointer;
  font-size: 13px;
}

.pcf-global-buttons button:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   EXPAND / COLLAPSE ALL
   --------------------------------------------------------- */

.pcf-semester-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;

  gap: 6px;

  padding: 3px 14px 6px;
}

.pcf-semester-actions button {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 6px 9px;

  cursor: pointer;
  font-size: 13px;
}

.pcf-semester-actions button:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   CURRENT CLASSES
   --------------------------------------------------------- */

.pcf-current-box {
  margin: 5px 14px 8px;
  padding: 8px;

  background: #f7f9f7;

  border: 1px solid #ddd;
  border-radius: 7px;

  text-align: center;
}

.pcf-current-title {
  margin-bottom: 7px;

  font-weight: bold;
  text-align: center;
}

.pcf-current-buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;

  gap: 6px;
}

.pcf-current-buttons button {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 5px 8px;

  cursor: pointer;
  font-size: 12px;
}

.pcf-current-buttons button:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   CURRENT SEMESTER
   --------------------------------------------------------- */

.pcf-buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;

  gap: 6px;

  padding: 3px 14px 8px;
}

.pcf-buttons button {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 6px 9px;

  cursor: pointer;
}

.pcf-buttons button:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   TOGGLES
   --------------------------------------------------------- */

.pcf-toggle {
  display: flex;
  justify-content: center;
  align-items: center;

  gap: 5px;

  padding: 5px 14px;

  text-align: center;
}

/* ---------------------------------------------------------
   VIDEO / RESET BUTTONS
   --------------------------------------------------------- */

.pcf-video-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;

  gap: 6px;

  padding: 4px 14px 8px;
}

.pcf-video-actions button {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 6px 9px;

  cursor: pointer;
  font-size: 12px;
}

.pcf-video-actions button:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   COURSE LIST
   --------------------------------------------------------- */

#pcf-course-list {
  height: 45vh;
  max-height: 45vh;

  overflow-y: scroll;
  overflow-x: hidden;

  border-top: 1px solid #eee;

  box-sizing: border-box;
}

#pcf-course-list::-webkit-scrollbar {
  width: 8px;
}

#pcf-course-list::-webkit-scrollbar-track {
  background: #f1f1f1;
}

#pcf-course-list::-webkit-scrollbar-thumb {
  background: #aaa;
  border-radius: 4px;
}

#pcf-course-list::-webkit-scrollbar-thumb:hover {
  background: #888;
}

/* ---------------------------------------------------------
   SEMESTER HEADINGS
   --------------------------------------------------------- */

.pcf-semester-header {
  display: flex;
  align-items: center;

  padding: 7px 8px;

  background: #eef4ef;

  border-bottom: 1px solid #ddd;
}

.pcf-semester-name {
  flex: 1;

  text-align: center;
}

.pcf-semester-header strong {
  display: inline;
}

.pcf-semester-count {
  margin-left: 4px;

  color: #777;
  font-size: 12px;
}

.pcf-semester-toggle,
.pcf-semester-all {
  flex: 0 0 auto;

  border: 1px solid #bbb;
  background: white;

  border-radius: 5px;

  cursor: pointer;
}

.pcf-semester-toggle {
  width: 25px;
  height: 24px;

  padding: 0;

  margin-right: 5px;
}

.pcf-semester-all {
  padding: 4px 7px;

  font-size: 11px;
}

.pcf-semester-toggle:hover,
.pcf-semester-all:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   COURSES
   --------------------------------------------------------- */

.pcf-course-row {
  display: flex;
  align-items: center;

  width: 100%;
  box-sizing: border-box;

  padding: 0;

  border-bottom: 1px solid #eee;
}

.pcf-course-row:hover {
  background: #f3f3f3;
}

.pcf-course {
  display: flex;
  align-items: center;

  flex: 1;
  min-width: 0;

  gap: 8px;

  padding: 8px 14px;

  cursor: pointer;
}

.pcf-course.pcf-current-class {
  background: #fffbea;
}

.pcf-course-name {
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 5px;

  overflow: hidden;
}

.pcf-course-display-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pcf-course-original-name {
  color: #888;
  font-size: 11px;

  white-space: nowrap;
}

.pcf-star {
  color: #d6a500;
}

/* ---------------------------------------------------------
   RENAME BUTTON
   --------------------------------------------------------- */

.pcf-rename {
  flex: 0 0 auto;

  width: 34px;
  height: 30px;

  margin: 0 8px 0 4px;
  padding: 0;

  display: flex;
  justify-content: center;
  align-items: center;

  border: 1px solid #bbb;
  background: white;

  border-radius: 5px;

  cursor: pointer;

  font-size: 14px;
}

.pcf-rename:hover {
  background: #f0f0f0;
}

/* ---------------------------------------------------------
   FOOTER
   --------------------------------------------------------- */

.pcf-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;

  padding: 9px 14px;

  border-top: 1px solid #ddd;

  color: #666;
  font-size: 12px;
}

#pcf-refresh {
  border: 1px solid #bbb;
  background: white;

  border-radius: 6px;

  padding: 6px 9px;

  cursor: pointer;
}

#pcf-refresh:hover {
  background: #f0f0f0;
}

.pcf-saved-count {
  margin-top: 3px;
}

/* ---------------------------------------------------------
   LAUNCHER
   --------------------------------------------------------- */

#pcf-launcher {
  position: fixed;
  right: 18px;
  bottom: 18px;

  z-index: 2147483646;

  border: 0;
  border-radius: 22px;

  padding: 11px 16px;

  background: #3f7f4f;
  color: white;

  font: bold 14px Arial, sans-serif;

  cursor: pointer;

  box-shadow: 0 4px 15px rgba(0,0,0,.25);
}

#pcf-launcher:hover {
  background: #336a40;
}
