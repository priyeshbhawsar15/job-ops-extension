# JobOps Clipper

Chrome Manifest V3 extension for saving job pages into a self-hosted JobOps instance.

## What It Does

- Detects likely job pages on `http` and `https` websites.
- Extracts a local draft from JSON-LD `JobPosting`, meta tags, headings, and visible page text.
- Calls `POST /api/manual-jobs/infer` before import so JobOps can infer structured fields.
- Calls `POST /api/manual-jobs/import` with `source: extension:<hostname>` and a stable URL hash as `sourceJobId`.
- Lets JobOps tailor and score automatically by default.
- Shows duplicate imports as `Already saved`.
- Shows real inference/import failures in the popup or in-page overlay.

## Install Locally

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.

## Setup

1. Click the extension icon.
2. Open `Options`.
3. Enter the base URL of your JobOps instance, for example `http://localhost:3005`.
4. Enter your JobOps username.
5. Enter the JobOps password and click `Sign in`.

The extension stores the returned JobOps bearer token in `chrome.storage.local`. It does not store the password.

## Domain Modes

- `Default`: detect silently; use the toolbar popup or manual overlay.
- `Auto-prompt`: show an in-page review overlay when a job is detected.
- `Auto-import`: run inference and import directly without review.

Auto-import requires explicit confirmation when enabled from the popup or options page.

## Notes

The extension requests broad host access so the content script can detect job pages and support per-domain auto-prompt/auto-import. It sends page content to JobOps only when you import manually or a domain is configured for auto-import.
