# Panopto Course Filter

A Chrome extension that filters Auburn University Panopto recordings by course.

## Overview

Auburn's Panopto can contain recordings from many courses, making it difficult to quickly find recordings for a specific class.

Panopto Course Filter adds a course-selection interface that lets users choose which courses they want to see and hides recordings from other courses.

I built this project to solve that navigation problem while gaining hands-on experience with browser-extension development, DOM manipulation, dynamic page content, and Chrome extension storage.

## Features

- Automatically discovers courses from Auburn Panopto pages
- Organizes discovered courses by semester
- Selects which courses should be displayed
- Filters recordings based on their associated course
- Saves course selections between sessions
- Provides a search/filter interface for courses
- Handles additional recordings loaded dynamically as the page is scrolled
- Allows the filter to be enabled or disabled

## How It Works

The extension runs as a Chrome content script on Auburn's hosted Panopto site.

At a high level, it:

1. Detects course and recording information from the Panopto page.
2. Organizes discovered courses by semester.
3. Lets the user select the courses they want to see.
4. Hides recordings that do not match the selected courses.
5. Continues applying the filter as additional content is loaded.

Course selections and other settings are stored locally using the Chrome Storage API.

## Installation

This project is currently intended for local use and is not published to the Chrome Web Store.

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the project directory.
6. Open Auburn's Panopto site and use the extension.

## Project Structure

```text
panopto-course-filter/
├── content.js
├── manifest.json
├── styles.css
└── README.md
```

- `content.js` — extension logic for discovering courses, managing selections, and filtering recordings
- `styles.css` — styling for the extension's interface
- `manifest.json` — Chrome Manifest V3 configuration and permissions

## Current Status

The extension is functional for my primary use case, but it is still a work in progress. Because it interacts directly with Auburn's Panopto interface, changes to Panopto's page structure may require updates to the extension.

Known areas for improvement include additional automated testing, handling more edge cases, and refactoring the content script into smaller modules.

## Future Improvements

- Improve course and recording detection
- Reduce false positives and missed course associations
- Improve handling of dynamically loaded content
- Refactor the content script into smaller modules
- Add more robust automated testing
- Improve accessibility and the user interface
- Add extension icons and additional metadata
- Publish a stable release if the project reaches a suitable level of maturity

## Technologies

- JavaScript
- HTML
- CSS
- Chrome Extensions API
- Chrome Storage API
- Chrome Manifest V3

## Why I Built It

This project started from a simple problem: Auburn's Panopto recordings can be difficult to navigate when recordings from many courses are displayed together.

Instead of repeatedly searching through unrelated recordings, I built a browser extension that lets users control which courses are displayed. The project gave me practical experience building software that integrates with an existing web application and adapting to dynamically changing page content.
