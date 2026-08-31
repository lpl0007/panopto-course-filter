# Panopto Course Filter

A Chrome extension that filters Auburn University Panopto recordings by course.

## Why I Built This

Auburn's Panopto contains recordings from many publicly accessible courses. Finding recordings for a specific course meant digging through recordings from courses I wasn't interested in.

I built this extension to make that process easier. It lets me select the courses I want to see and hides recordings from other courses.

## Features

* Automatically discovers courses from Auburn Panopto pages
* Organizes discovered courses by semester
* Selects which courses should be displayed
* Filters recordings based on their associated course
* Saves course selections between sessions
* Provides a search/filter interface for courses
* Handles additional recordings loaded dynamically as the page is scrolled
* Allows the filter to be enabled or disabled

## How It Works

The extension runs as a Chrome content script on Auburn's hosted Panopto site.

It identifies course information from the Panopto page, organizes the courses it finds, and uses the selected courses to determine which recordings should remain visible.

Course selections and other settings are stored locally using Chrome's extension storage.

## Installation

This project is currently intended for personal use and is not published to the Chrome Web Store.

To install it locally:

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the project directory.
6. Open Auburn's Panopto site and use the extension.

## Current Status

This project is a work in progress. It currently works for my use case, but some edge cases and bugs remain.

The extension was built primarily to solve my own problem with navigating Auburn's Panopto recordings, so compatibility with every possible Panopto page or recording format has not been guaranteed.

## Future Improvements

* Improve course and recording detection
* Reduce false positives and missed course associations
* Improve handling of dynamically loaded content
* Refactor the content script into smaller modules
* Add more robust testing
* Improve the user interface

## Technologies

* JavaScript
* HTML
* CSS
* Chrome Extensions API
* Chrome Storage API
