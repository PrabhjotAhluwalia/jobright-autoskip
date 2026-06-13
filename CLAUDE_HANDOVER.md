# Claude Handover: JobRight Automation Extension

Last updated: June 12, 2026

## Purpose

This repository contains a Manifest V3 Chromium extension that coordinates
JobRight queue selection, ATS form completion, Gmail OTP retrieval, application
submission detection, stuck-job screenshots, and automatic skip/advance logic.

The repository is private as of June 12, 2026. Still never commit live OAuth
client secrets, access tokens, refresh tokens, passwords, browser profiles,
cookies, one-time codes, or GitHub credentials. Private Git history is not a
credential vault and can later be shared, cloned, or exposed.

## Current Repository State

The working tree contains a broad set of user-requested changes that are not in
the previous `main` commit. They include:

- ATS form repair and validation retry logic.
- Fallback resume and generic cover-letter uploads.
- Stronger United States country and `+1` phone-code selection.
- Automatic answers for acknowledgments, work authorization, sponsorship,
  onsite schedules, communications consent, previous employment, FINRA, and
  referral-name questions.
- Configurable terminal success phrases and stronger `I've Applied` handling.
- Lever-specific protection and one-time `Apply for this job` handling.
- A 100-second stuck-job watcher that captures before skipping.
- A one-time native notification at 70 seconds so the user has roughly 30
  seconds to intervene before capture and skip.
- macOS and Windows screenshot-helper support.
- Auto-queue and blocklist changes.
- Navjeet setup documents replacing the legacy setup documents.

## Important Known Issue

The auto-queue can begin scanning before `chrome.storage.sync` finishes loading
the saved company blocklist. That race can add a blocklisted company to the
JobRight queue. The same area also has broad company/card association logic that
can associate a visible `Skip` control with the wrong historical card.

This is not a request to disable or clear the blocklist. Preserve every existing
entry. The surgical fix should:

1. Gate auto-queue selection until the initial blocklist load completes.
2. Extract the company from the exact right-pane result card containing the Add
   button.
3. Require blocklist pre-skip to use the exact active application card.
4. Keep blocklisted jobs eligible for immediate skip after they are genuinely
   identified.
5. Never delete blocklist entries unless the user explicitly requests deletion.

## Repository Map

- `manifest.json`
  - Permissions, host permissions, content scripts, OAuth registration, and
    web-accessible resources.
- `background.js`
  - Service worker, Gmail OAuth and API access, OTP extraction, ATS-to-JobRight
    message routing, screenshot capture/save coordination, alarms, and shared
    blocklist server calls.
- `content.js`
  - JobRight page automation, queue construction, blocklist handling, status
    prompts, `I've Applied`, active-job tracking, stuck timer, and skip logic.
- `ats_content.js`
  - ATS iframe automation, field repair, profile corrections, fallback file
    uploads, validation retry, Lever handling, OTP entry, and terminal
    submission detection.
- `popup.html`, `popup.js`
  - Extension controls, status, blocklist management, terminal success phrase
    configuration, Gmail connection, and feature toggles.
- `blocklist_server.mjs`
  - Local helper at `127.0.0.1:17373` for shared blocklist persistence and
    Desktop screenshot saving.
- `shared_blocklist.json`
  - Shared normalized company blocklist. Preserve its contents.
- `jobright_terminal_success_phrases.txt`
  - Built-in configurable phrases that indicate successful application
    submission.
- `jobright_excluded_job_titles.txt`
  - Plain-text title exclusions for automatic queue selection.
- `jobright_excluded_job_title_regexes.txt`
  - Regex title exclusions for automatic queue selection.
- `jobright_system_prompt.txt`
  - JobRight chat prompt used by the extension.
- `jobright_more_jobs_prompt.txt`
  - Prompt sent when JobRight asks whether to find more jobs.
- `assets/Prabhjot_Ahluwalia_PM_Resume_US_Citizen.pdf`
  - Fallback resume.
- `assets/Prabhjot_Ahluwalia_Cover_Letter.pdf`
  - Generic fallback cover letter.
- `docs/NAVJEET_MAC_SETUP.md`
  - Text setup guide.
- `docs/Navjeet_JobRight_Mac_Guide.docx`
  - Word setup guide.
- `docs/Navjeet_JobRight_Mac_Guide.pdf`
  - PDF setup guide.
- `start_jobright_helper_windows.cmd`
  - Windows helper launcher.
- `tools/build_navjeet_mac_guide.py`
  - Source script for regenerating the Navjeet guides.

## Core Behavioral Invariants

### Queue Selection

- Only add a right-pane job when the same card has an Autofill marker.
- Never add a blocklisted company.
- Never add a title matching the configured phrase or regex exclusions.
- Do not infer support from a neighboring card, stale card, or generated resume.
- Resume generation alone is not proof that the application is supported.
- Do not start the 100-second stuck timer during resume generation.

### Blocklist

- The blocklist is enabled unless the user explicitly turns it off.
- Local sync storage and `shared_blocklist.json` are merged.
- Manual additions must persist and propagate to the helper.
- Do not clear, shrink, or replace the list implicitly.
- Cancellation-history capture may add companies, but must not remove entries.

### Stuck Screenshot and Skip

- Start the 100-second timer only after the active job reaches an application
  form or action-required state.
- At 70 seconds without progress, show one native browser notification for the
  active job. Its sound follows the operating system and browser notification
  settings.
- At timeout, capture first and wait for a successful save response.
- Skip only after capture/save completion or a clearly handled fallback.
- Do not save timeout screenshots for jobs skipped for another reason.
- Do not learn or add a company to the blocklist when the cancellation was
  caused by the 100-second timeout path.
- Keep the active job locked while screenshot capture is pending.
- The preferred path is `Desktop/SS` through the local helper.
- Browser-download fallback saves under `Downloads/SS`; Chromium extensions
  cannot directly choose arbitrary Desktop paths without the helper.

### Submission Success

- Positive terminal text in the ATS frame should trigger JobRight's
  `I've Applied` and advance to the next job.
- Some Greenhouse application pages embed their future confirmation message in
  hydration data before submission. Success text must not count while a visible
  Submit control remains, unless the URL is already a confirmation route.
- Built-in and user-configured success phrases are both used.
- Examples include `Thank you for applying`, `application received`,
  `successfully submitted`, and equivalent configured phrases.
- A Lever application must not be skipped before confirmed submission.
- Negative terminal states such as rate limits, duplicate applications, or
  application caps must not be treated as successful submission.

### ATS Form Repair

- When an ATS reports a required field as missing even though a value appears
  selected, interact with that exact field and re-emit the selected value.
- Retry submission at most once for this repair path.
- Do not choose random dropdown values.
- School, discipline, and other profile fields must use known profile data or
  remain for manual review, never the first arbitrary option.

## Current Answer Rules

- Current company/employer: `Georgia Tech`.
- Referral name: `NA - I applied directly`.
- Previous employee/employed previously: `No`.
- Work authorization in the United States: `Yes`.
- Future sponsorship requirement: `No`.
- Onsite, hybrid, commuting, relocation, or stated in-person schedule works:
  `Yes`, including free-text fields.
- Recruiting, email, SMS, or marketing communications: `Yes`.
- Acknowledgment/consent: prefer `I agree`, then `Yes`.
- Accuracy, truthful-information, and falsification acknowledgments: `Yes`.
- FINRA registration questions: `NA` when available.
- Country and phone country code: `United States +1`.
- Location (City): `Atlanta, Georgia, United States`, selecting the exact
  autocomplete option when present.
- Source/how heard: `LinkedIn`.

## Fallback File Rules

- Upload the fallback resume only to a resume/CV field.
- Upload the generic cover letter only to a cover-letter field that is required
  or explicitly reported missing.
- Both PDFs are web-accessible extension resources.
- Do not substitute the cover letter for the resume or vice versa.

## Screenshot Helper

Run the helper before starting a JobRight batch:

### macOS or Linux

```bash
node blocklist_server.mjs
```

### Windows

Double-click:

```text
start_jobright_helper_windows.cmd
```

The helper:

- Serves the shared blocklist.
- Accepts screenshot data from the extension.
- Creates `Desktop/SS` when needed.
- Writes screenshots before returning success.

If the helper is unavailable, the extension uses the browser downloads API and
saves to `Downloads/SS`.

## Secure OAuth Setup

`oauth_config.js` is intentionally ignored and must not be uploaded.

On each new machine:

1. Copy `oauth_config.example.js` to `oauth_config.js`.
2. Add the Google OAuth client ID and client secret for that machine/setup.
3. Load the extension unpacked.
4. Use the popup to connect Gmail.

Gmail access and refresh tokens are stored in browser extension storage. They
must be recreated by signing in on the new machine. Do not transfer them through
GitHub.

GitHub CLI authentication is stored in the operating-system keychain and must
also be configured separately with `gh auth login`.

## Installation

1. Clone the repository.
2. Create `oauth_config.js` from the example if Gmail OTP is needed.
3. Start the local helper.
4. Open `brave://extensions` or `chrome://extensions`.
5. Enable Developer mode.
6. Choose Load unpacked and select the repository directory.
7. Reload the extension after every code change.
8. Reload the open JobRight tab after reloading the extension.

## Validation Commands

Run these before publishing:

```bash
node --check content.js
node --check ats_content.js
node --check background.js
node --check popup.js
node --check blocklist_server.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('shared_blocklist.json','utf8'))"
```

Also inspect:

```bash
git diff --check
git status --short
```

## Git and Safety Notes

- The remote is `PrabhjotAhluwalia/jobright-autoskip`.
- The GitHub repository is private as of June 12, 2026.
- Do not commit `oauth_config.js`, logs, `.DS_Store`, browser profiles, or local
  token stores.
- The generated Navjeet PDF and DOCX are intended repository assets.
- Legacy setup files were deliberately replaced by Navjeet-named versions.
- Existing user changes are broad and interconnected. Do not mass-revert files
  to `HEAD`; make surgical patches against the live working tree.

## Recommended Next Engineering Task

Fix the blocklist initialization race and exact-card association described in
Important Known Issue. Then verify in Brave with:

1. A known blocklisted company visible in fresh matches.
2. A non-blocklisted Autofill-supported company.
3. A non-Autofill company.
4. A live application reaching the form stage.
5. A forced 100-second timeout confirming screenshot save occurs before skip.
