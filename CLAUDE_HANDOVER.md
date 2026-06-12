# Claude Handover: JobRight Auto-Skip Chrome Extension

This document maps what the extension currently does, where each feature lives, and the exact line ranges to inspect before changing behavior.

## Repository Shape

- `manifest.json`: Chrome extension registration, permissions, content-script injection, OAuth scopes, and web-accessible files.
- `background.js`: service worker, Gmail OAuth/Gmail API, OTP extraction, JobRight tab coordination, alarms, shared blocklist proxying.
- `content.js`: JobRight page automation, prompt injection, blocklist, auto-skip, auto queue builder, chat handling, status watchers.
- `ats_content.js`: ATS iframe/page automation, OTP field detection/fill, submission detection, validation retry, terms checkbox handling, fallback resume upload.
- `popup.html` and `popup.js`: popup UI for toggles, Gmail status, skip count, blocklist management.
- `blocklist_server.mjs`: local shared blocklist server for multiple browser instances.
- `jobright_system_prompt.txt`: configurable JobRight system prompt pushed after every 10 newly confirmed successful submissions.
- `jobright_more_jobs_prompt.txt`: configurable prompt sent when JobRight asks whether to pull more jobs.
- `jobright_excluded_job_titles.txt`: configurable excluded title phrases for queue building.
- `jobright_excluded_job_title_regexes.txt`: configurable excluded title regexes for queue building.
- `assets/Prabhjot_Ahluwalia_PM_Resume_US_Citizen.pdf`: fallback resume file exposed to ATS pages.
- `shared_blocklist.json`: persistent local blocklist backing the local server.

## Extension Registration

`manifest.json`

- Manifest metadata: lines 1-5.
- Permissions: `storage`, `tabs`, `scripting`, `identity`, `alarms`: lines 7-13.
- Host permissions for JobRight, Gmail/Google OAuth, localhost blocklist, and ATS domains: lines 14-33.
- Background service worker: lines 35-37.
- Content security policy: lines 38-40.
- JobRight content script injection for `content.js`: lines 41-50.
- ATS content script injection for `ats_content.js`, including `all_frames: true`: lines 51-72.
- Web-accessible resources for fallback resume and title exclusion text files: lines 74-98.
- OAuth2 client/scopes: lines 99-105.
- Popup/action/icons: lines 106-119.

## Background Worker Features

`background.js`

### Startup, Injection, and Alarms

- Injects `content.js` into already-open JobRight tabs on extension install/update: lines 33-39.
- On browser startup, sets alarms and silently refreshes Gmail auth: lines 41-45.
- Creates recurring alarms:
  - iCIMS reset polling every 45 seconds.
  - Gmail token refresh every 45 minutes.
  - Explicitly clears the legacy unscoped `jobrightSystemPromptKeepalive` alarm.
  - Lines 46-56.
- Alarm dispatcher calls Gmail silent refresh and tab-specific system prompt cycles.
- Calls `setupAlarms()` immediately on service worker load: line 67.

### Configurable Prompt Loading and JobRight Prompt Dispatch

- Reads extension-bundled text files through `chrome.runtime.getURL`: lines 69-73.
- Sends prompt text to every open `jobright.ai` tab via `SEND_JOBRIGHT_SYSTEM_PROMPT`; `force` bypasses content-side recent-send suppression for rejection recovery: lines 75-89.
- Tab-specific system prompt helpers load `jobright_system_prompt.txt` and target only the originating JobRight tab.
- Wrapper for more-jobs prompt from `jobright_more_jobs_prompt.txt`: lines 95-97.

### Active Job Context and OTP Company Matching

- Cleans company hints from ATS/page/title strings and filters generic tokens: lines 99-134.
- Normalizes company names for matching: lines 136-145.
- Normalizes and filters active company hints; explicitly rejects provider/generic hints like Greenhouse, JobRight, Bubble, and `Build`: lines 147-160.
- Maintains per-tab active JobRight context with a 15-minute freshness window: lines 162-187.
- Merges active JobRight context with explicit ATS page company hints before Gmail lookup: lines 189-191.

### Shared Blocklist Bridge

- Fetches, adds, removes, and replaces the shared blocklist by calling `http://127.0.0.1:17373`: lines 194-211.
- Runtime messages:
  - `SHARED_BLOCKLIST_GET`: lines 306-311.
  - `SHARED_BLOCKLIST_ADD`: lines 313-318.
  - `SHARED_BLOCKLIST_REMOVE`: lines 320-325.
  - `SHARED_BLOCKLIST_REPLACE`: lines 327-332.

### Runtime Message Broker

- `ATS_SUBMISSION_DETECTED`: finds a JobRight tab and retries `TRIGGER_IVE_APPLIED` up to 8 times: lines 213-230.
- `JOBRIGHT_FORM_COMPLETE_STATE`: stores JobRight left-panel form-complete state by tab: lines 232-236.
- `JOBRIGHT_ACTIVE_JOB_CONTEXT`: stores active company/title hints by sender tab: lines 239-244.
- `CHECK_JOBRIGHT_FORM_COMPLETE`: queried by ATS fallback resume upload: lines 247-251.
- Gmail auth status, revoke, login, manual OTP, auto OTP, JobRight chat OTP, iCIMS reset, and prompt run messages: lines 282-427.

### Gmail OAuth

- Browser/vendor detection: line 441.
- PKCE client ID/client secret/redirect config: lines 449-451.
- Storage helper functions: lines 461-467.
- PKCE verifier/challenge: lines 471-480.
- PKCE login flow through `chrome.identity.launchWebAuthFlow`: lines 484-536.
- Refresh-token based PKCE token retrieval: lines 540-573.
- Main `getAuthToken()` branch:
  - Google Chrome uses native `chrome.identity.getAuthToken`.
  - Other Chromium browsers use PKCE.
  - Lines 577-592.
- Token clearing and silent refresh: lines 594-613.
- Gmail API fetch wrapper with one retry after 401: lines 619-640.

### Gmail OTP Fetching

- MIME/body/html extraction from Gmail message payloads: lines 646-676.
- OTP stop words and candidate extraction: lines 679-718.
- Extracts OTP from context windows around security-code phrases: lines 720-767.
- Rejects messages older than the one-hour freshness window: lines 769-772.
- Company substring/token matching for OTP emails: lines 774-788.
- Searches Gmail for recent Greenhouse security-code emails, sorts newest first, rejects stale/ignored/company-mismatched/no-code messages, and returns candidate counts: lines 790-832.
- Handles `FETCH_OTP` / `AUTO_FETCH_OTP`, persists used OTP message IDs for one hour, optionally delivers `OTP_FOUND` to active tab, and returns debug detail: lines 834-873.

### iCIMS Reset Polling

- Extracts reset links from iCIMS emails: lines 879-894.
- Polls Gmail for unread iCIMS reset-password emails and opens the reset URL: lines 896-929.

## JobRight Page Automation

`content.js`

### Configuration and State

- Skip trigger config and company selector constants: lines 3-21.
- Feature flags/state for auto-skip, blocklist, auto-applied, auto-queue, prompt timers, and caches: lines 24-60.
- More-jobs question text, prompt interval, queue limit, and config filenames: lines 62-66.
- Built-in fallback title exclusion phrases/regexes: lines 67-84.

### Active Job Context

- Invalidation-safe Chrome helper functions: lines 86-105.
- Extracts active job card company/title from JobRight left panel: lines 110-156.
- Builds active job context `{ company, title, hints }`: lines 158-181.
- Publishes active context to the background service worker with `JOBRIGHT_ACTIVE_JOB_CONTEXT`: lines 183-194.
- Extracts company name from JobRight chat/status bubbles: lines 197-214.

### Company Blocklist

- Normalizes and persists blocklist in `chrome.storage.sync`, then broadcasts updates: lines 216-230.
- Pulls and merges shared blocklist from the local server: lines 232-254.
- Substring-style blocklist matching: lines 256-260.
- Adds companies to local storage and the shared server: lines 262-275.
- Uses blocklist during skip and auto-queue decisions: lines 1349-1429 and 982-1018.

### JobRight Chat Automation

- Native value setting and synthetic click/input helpers: lines 277-304.
- Legacy helper for placing OTP into JobRight chat: lines 306-333.
- Finds the JobRight chat input while avoiding the Filters control: lines 335-354.
- Finds/wakes the chat composer shell: lines 356-407.
- Writes text into the chat composer and dispatches input events: lines 409-441.
- Submits chat text with Enter and nearby send-button fallback: lines 443-476.
- Extracts page text and last visible chat message; exact-matches the more-jobs question: lines 478-518.
- Detects `misleading`, `false`, or `sorry` only in the newest visible bot message.
- Deduplicates system prompt and more-jobs prompt sends using recent message/history checks; forced system-prompt sends bypass recent-send suppression: lines 552-567.
- Sends prompts into JobRight chat:
  - More-jobs prompt is gated by queue count `0` and the exact latest JobRight question.
  - System prompt is deduped unless forced.
  - Lines 558-601.
- Starts the tab-specific prompt cycle only when the live queue count reaches 40.

### Auto “I’ve Applied”

- Finds and clicks the left-panel `I've Applied` button: lines 618-637.
- Detects terminal right-pane states like thank-you, submitted, received, sent, limit reached, and retry-window messages: lines 639-666.
- Generic button-click helper for `Try Again`, `Try Now`, and `Continue`: lines 668-678.
- Main status automation:
  - Sends more-jobs prompt only when latest chat message is the exact pull-more-jobs question and queue is zero.
  - Replays the system prompt when the newest bot reply contains `misleading`, `false`, or `sorry`.
  - Clicks retry/continue buttons.
  - Clicks `I've Applied` when ATS page shows terminal success/limit states.
  - Lines 680-729.

### Auto Queue Builder

- Feature-flag purpose comment: lines 720-723.
- Reads queue count from the JobRight header: lines 724-728.
- Finds the top `Start` button: lines 730-739.
- Extracts company/title from right-side queue cards: lines 741-788.
- Loads configurable title exclusion phrases from `jobright_excluded_job_titles.txt`: lines 790-829.
- Loads configurable title exclusion regexes from `jobright_excluded_job_title_regexes.txt`: lines 831-847.
- Applies phrase/regex title filtering: lines 849-854.
- Finds the left-side `View All` button without confusing it with other controls: lines 856-879.
- Finds the right-pane `Top Matches` root: lines 881-906.
- Identifies individual queue cards while avoiding broad containers: lines 912-925.
- Requires an `Autofill` badge inside the same card: lines 927-947.
- Maps each `+ Add` button to its same-card Autofill job: lines 949-980.
- Candidate selection requires:
  - right-pane Add button,
  - same-card Autofill badge,
  - not blocklisted,
  - not title-excluded.
  - Lines 982-1018.
- Finds right-pane `Show Me More Matches`: lines 1020-1034.
- Uses batch signatures so `Show Me More Matches` is not clicked repeatedly on the same visible batch: lines 1036-1062.
- Detects loading state: lines 1064-1068.
- Schedules queue builder work: lines 1070-1074.
- Main queue-builder loop:
  - Syncs shared blocklist.
  - Clicks Start at queue >= 40.
  - Clicks `View All` when needed.
  - Adds eligible Autofill jobs one at a time with throttling.
  - Clicks `Show Me More Matches` once per stable batch.
  - Lines 1076-1140.

### JobRight Form-Complete State

- Detects left-panel form-complete text like `Form complete` and `x/x required fields filled`: lines 1142-1156.
- Publishes this state to background so `ats_content.js` can decide whether fallback resume upload is allowed: lines 1142-1156 and `background.js` lines 232-251.

### Feedback Modal and Filters Panel Closing

- Closes JobRight feedback modal: lines 1158-1182.
- Closes accidental Filters panel using close/back controls: lines 1184-1235.

### Auto-Skip

- Detects and skips JobRight prompts using small same-card text matching plus an inner `Skip` control for:
  - `This job supports application autofill only on the application site`.
  - `This job requires manual application`.
  - Lines 1246-1300.
- Detects green Analyze/Application Site style prompts and clicks card-level Skip: lines 1302-1347.
- Pre-skips blocklisted companies: lines 1349-1389.
- Core `tryClickSkip()`:
  - Syncs shared blocklist.
  - Applies blocklist/manual/autofill-only/analyze-site strategies.
  - Clicks Skip.
  - Increments skip count.
  - Adds skipped company to blocklist.
  - Lines 1391-1429.

### Observers, Initialization, and Popup Messages

- MutationObserver runs close-modal, close-filters, status automation, form/context publishing, queue scheduling, and debounced auto-skip: lines 1431-1458.
- Initial actions after load: lines 1460-1464.
- No page-load or time-based system prompt timer exists.
- Runtime message handlers for popup/background:
  - `GET_STATUS`, `SET_ENABLED`, `RESET_COUNT`.
  - `SET_BLOCKLIST_ENABLED`, blocklist add/remove/clear.
  - `SET_AUTO_APPLIED_ENABLED`, `SET_AUTO_QUEUE_ENABLED`.
  - `PLACE_OTP_IN_JOBRIGHT_CHAT`.
  - `SEND_JOBRIGHT_SYSTEM_PROMPT`.
  - `TRIGGER_IVE_APPLIED`.
  - `GET_ACTIVE_JOB_CONTEXT`.
  - Lines 1467-1515.
- Restores local settings/count/auto-applied/auto-queue: lines 1520-1530.
- Restores sync blocklist/blocklistEnabled and syncs shared blocklist: lines 1531-1538.
- Handles storage changes: lines 1540-1548.
- Periodic loops:
  - Shared blocklist sync every 15 seconds: line 1522.
  - Close filters/status/form/context every 1.5 seconds: line 1523.
  - Auto queue builder every 2 seconds: line 1524.

## ATS Page / Iframe Automation

`ats_content.js`

### Configuration and State

- Guard to load script only once per frame: lines 3-6.
- Submission success/terminal phrases and regex patterns: lines 12-40.
- OTP field/section/invalid-code patterns: lines 42-51.
- OTP polling intervals and retry limits: lines 44-48.
- Fallback resume asset path/name: lines 52-53.
- Profile correction constants (name, email, phone, LinkedIn): lines 54-61.
- Runtime state for OTP, validation retry, required checkbox checks, fallback resume, ignored OTPs, profile correction, and verified JobRight repair submission: near the top of the file.
- Reads feature flags from storage (including `atsProfileCorrectionEnabled`) and syncs popup changes: lines 90-129.

### OTP Field Detection

- Visibility helper: lines 102-105.
- OTP-compatible input/contenteditable detection: lines 107-113.
- Input hint extraction from labels/ids/aria/placeholder: lines 115-123.
- OTP-likely field detection:
  - `autocomplete=one-time-code`,
  - label/aria matches,
  - numeric/tiny single-char input heuristics.
  - Lines 125-147.
- Detects OTP section text even before field focus: lines 149-151.
- Finds visible OTP field from OTP section or input scan: lines 153-166.
- Finds OTP input near section labels/text: lines 168-210.
- Detects split single-character OTP boxes: lines 212-223.
- DOM sort helper: lines 226-228.
- Groups split OTP inputs near active field: lines 230-252.

### OTP Fill and Submit

- Native value setter and event dispatch: lines 291-303.
- Profile field hint extraction and stale value correction: lines 305-368.
- Fills OTP into split boxes or a single field: lines 370-396.
- Records filled OTP/message id: lines 398-401.
- Finds submit buttons: lines 403-411.
- Clicks submit after OTP with retry until button enabled: lines 413-433.
- Immediate submit-click helper: lines 435-445.

### Company Hints for OTP Matching

- Text normalization: lines 349-351.
- Cleans company hints from page title/body/title strings: lines 353-386.
- Collects company hints from title, meta title, logo alt text, headings, company elements, and body text: lines 388-417.

### Verified Repair and Submission for “Required Field Missing”

- Finds validation/error elements: lines 419-430.
- Extracts impacted field text from an error element: lines 432-441.
- Detects validation alert containers: lines 443-450.
- Finds the actual field container for a missing required field: lines 452-490.
- `nudgeField()`:
  - Avoids file chooser controls.
  - Re-dispatches events for already selected choices and populated text/select values without clicking toggles.
  - Never chooses an unanswered radio, checkbox, button, or option.
- Label text helper locates the field associated with JobRight's missing-field label.
- ATS validation errors alone never trigger Submit.
- A repair submission is considered only after JobRight explicitly reports missing fields.
- The extension waits up to 30 seconds and repeatedly verifies that every reported field is resolved and enabled.
- Submit is clicked at most once for the same missing-field set within 30 seconds.
- Relocation/in-person answers, SMS opt-out, checkbox repair, profile correction, and resume upload never submit by themselves.

### Required Terms / Privacy / Consent Checkboxes

- Finds visible checkboxes and checks only mandatory consent/terms/privacy/confirm/acknowledge/certify-style boxes: lines 569-595.
- Collects checkbox context text: lines 597-607.
- Native checked setter: lines 609-618.
- Schedules checkbox scans: lines 620-623.

### Fallback Resume Upload

- Detects required/missing Resume/CV states: lines 625-633.
- Finds resume file input while excluding cover-letter upload controls: lines 635-649.
- Uploads bundled fallback resume only when:
  - Resume/CV is required/missing on ATS page,
  - or JobRight explicitly lists Resume/CV as a missing field,
  - a resume file input exists.
- Does not replace a file already attached to the selected Resume/CV input.
- Supports hidden native inputs and inputs inside open shadow roots and verifies the file remains attached.
- Resume upload does not submit by itself. It can participate only in the verified JobRight missing-field repair flow after every reported field is resolved.
- Runs on the manifest's explicit ATS host allowlist, including Lever, Greenhouse, Ashby, Workday, SmartRecruiters, iCIMS, Jobvite, Workable, BambooHR, Oracle Recruiting, SuccessFactors, JazzHR, Recruitee, Teamtailor, UKG, Breezy, Rippling, Pinpoint, Comeet, and Taleo.
- Schedules fallback resume upload: lines 690-693.

### OTP Status Badge and Polling

- Removes inline OTP status badge: lines 727-730.
- Shows inline field status near OTP input: lines 732-753.
- Stops polling and handles extension-context invalidation: lines 761-770.
- Sends `AUTO_FETCH_OTP` to background with ignored message IDs, baseline timestamp, and company hints: lines 772-788.
- Normalizes ignored OTP values and filters repeated invalid OTPs: lines 791-803.
- Formats polling status messages: lines 805-815.
- `startOtpPolling()`:
  - First poll snapshots/fetches Gmail.
  - Subsequent polls retry up to 12 attempts.
  - Uses company hints.
  - Fills OTP and submits when found.
  - Lines 817-908.
- Detects invalid OTP text, clears fields, ignores previous OTP/message, and repolls newer OTP: lines 910-955.

### OTP Banner and Auto-Start

- Shows top orange OTP banner: lines 961-970.
- Starts polling on OTP field focus: lines 994-1001.
- Starts polling automatically when page text says a verification/security code was sent, even before focus: lines 1003-1010.

### Submission Detection and Auto “I’ve Applied”

- Detects terminal ATS success/limit/submission text and sends `ATS_SUBMISSION_DETECTED` to background: lines 976-988.
- MutationObserver watches for submission text, profile correction, validation errors, checkboxes, fallback resume, invalid OTP, and OTP sections: lines 1114-1128.
- Initial page-load checks: lines 1138-1157.
- SPA URL-change reset and rechecks: lines 1159-1181.
- Profile correction runs on a 2-second interval: line 1183.

## Popup UI

`popup.html`

- Popup layout/CSS reset/header/body/toggles/cards: lines 1-106.
- Blocklist section styling: lines 107-167.
- Gmail status card styling: lines 171-205.
- Header and main UI shell: lines 210-224.
- Auto-skip toggle: lines 225-234.
- Skip count card: lines 236-240.
- Explanation of skip triggers: lines 242-248.
- Reset button: line 250.
- Gmail connection card: lines 252-266.
- Auto `I've Applied` toggle: lines 268-282.
- Auto queue builder toggle: lines 284-298.
- Company blocklist section, toggle, add-company row, list: lines 301-327.
- Loads `popup.js`: line 333.

`popup.js`

- Element references: lines 3-18.
- `setUI()` and blocklist rendering: lines 24-70.
- Wrong-page handling: lines 72-75.
- Gmail UI state handling: lines 79-101.
- Gmail status check with persisted last auth error display: lines 103-145.
- Gmail connect/disconnect/retry button behavior: lines 147-177.
- Popup init and active JobRight tab status request: lines 181-194.
- Auto-skip toggle: lines 198-208.
- Auto `I've Applied` toggle: lines 212-224.
- Auto queue builder toggle: lines 228-240.
- Blocklist toggle: lines 244-254.
- Manual add company: lines 258-276.
- Remove company: lines 280-287.
- Reset skip count: lines 291-296.
- Live updates for skip count and blocklist: lines 300-307.

## Local Shared Blocklist Server

`blocklist_server.mjs`

- Port and data-file configuration: lines 6-8.
- Company/list normalization: lines 10-16.
- Reads and writes `shared_blocklist.json`: lines 18-31.
- Reads JSON POST bodies: lines 33-38.
- CORS JSON responses: lines 40-48.
- Routes:
  - `GET /health`: line 55.
  - `GET /blocklist`: lines 57-59.
  - `POST /blocklist/add`: lines 61-65.
  - `POST /blocklist/remove`: lines 67-72.
  - `POST /blocklist/replace`: lines 74-77.
  - 404/500 handling: lines 79-82.
- Starts on `127.0.0.1:${PORT}`: lines 85-88.

## Config Files

`jobright_more_jobs_prompt.txt`

- The prompt sent when the latest JobRight message exactly asks whether to pull more jobs: line 1.
- Current value: `Product manager jobs`.

`jobright_system_prompt.txt`

- Configurable JobRight system prompt.
- Current file length: 141 lines.
- Loaded by `background.js` lines 69-73 and sent by `content.js` lines 558-601.

`jobright_excluded_job_titles.txt`

- Comments/instructions: lines 1-3.
- Phrase exclusions:
  - product marketing manager: line 4.
  - product manager, marketing: line 5.
  - product marketing lead: line 6.
  - product marketing: line 7.
  - marketing product manager: line 8.
  - pmm: line 9.
  - growth marketing: line 10.
  - brand marketing: line 11.
  - content marketing: line 12.
  - engineer: line 13.

`jobright_excluded_job_title_regexes.txt`

- Comments/instructions: lines 1-5.
- Senior/sr role exclusion: line 6.
- VP / vice president exclusion: line 7.
- Director exclusion: line 8.
- Head of exclusion: line 9.
- Principal exclusion: line 10.
- Staff exclusion: line 11.
- Group Product Manager exclusion: line 12.
- Lead exclusion: line 13.
- 5+ years or higher experience exclusion: line 14.

## Runtime Message Contracts

Background-handled messages:

- `ATS_SUBMISSION_DETECTED`: ATS page tells background to click JobRight `I've Applied`.
- `JOBRIGHT_FORM_COMPLETE_STATE`: JobRight content script publishes form-complete status for fallback resume decisions.
- `JOBRIGHT_ACTIVE_JOB_CONTEXT`: JobRight content script publishes current company/title hints for OTP matching.
- `CHECK_JOBRIGHT_FORM_COMPLETE`: ATS script asks if JobRight currently says form complete.
- `SHARED_BLOCKLIST_GET`, `SHARED_BLOCKLIST_ADD`, `SHARED_BLOCKLIST_REMOVE`, `SHARED_BLOCKLIST_REPLACE`: shared blocklist server bridge.
- `CHECK_GMAIL_AUTH`, `REVOKE_GMAIL_AUTH`, `LOGIN`: Gmail connection flow.
- `FETCH_OTP`, `AUTO_FETCH_OTP`: Gmail OTP retrieval.
- `PLACE_OTP_IN_JOBRIGHT_CHAT`: legacy chat-placement OTP path.
- `START_ICIMS_RESET_POLL`: starts iCIMS reset polling.
- `RUN_JOBRIGHT_SYSTEM_PROMPT_NOW`, `RUN_JOBRIGHT_MORE_JOBS_PROMPT_NOW`: manual prompt dispatch.

JobRight `content.js`-handled messages:

- `GET_STATUS`.
- `SET_ENABLED`.
- `RESET_COUNT`.
- `SET_BLOCKLIST_ENABLED`.
- `REMOVE_FROM_BLOCKLIST`.
- `CLEAR_BLOCKLIST`.
- `ADD_TO_BLOCKLIST`.
- `SET_AUTO_APPLIED_ENABLED`.
- `SET_AUTO_QUEUE_ENABLED`.
- `PLACE_OTP_IN_JOBRIGHT_CHAT`.
- `SEND_JOBRIGHT_SYSTEM_PROMPT`.
- `TRIGGER_IVE_APPLIED`.
- `GET_ACTIVE_JOB_CONTEXT`.

ATS `ats_content.js`-handled messages:

- `SET_AUTO_APPLIED_ENABLED`.
- `SET_PROFILE_CORRECTION_ENABLED`.
- `SET_VALIDATION_RETRY_ENABLED`.
- `OTP_FOUND`.

## Storage Keys

Local storage keys:

- `enabled`: main auto-skip flag.
- `skipCount`: skipped prompts counter.
- `autoAppliedEnabled`: auto-click `I've Applied`.
- `autoQueueEnabled`: auto-build job queue.
- `atsValidationRetryEnabled`: ATS validation retry/nudge behavior.
- `atsProfileCorrectionEnabled`: ATS stale profile field correction.
- `gmailOtpOAuthToken`: PKCE OAuth access token object.
- `gmailOtpRefreshToken`: PKCE refresh token.
- `gmailNativeConnected`: native Chrome auth path flag.
- `gmailConnectedEmail`: connected Gmail address.
- `gmailLastAuthError`: last Gmail auth error.
- `gmailLastAuthErrorAt`: timestamp for surfacing stored auth error.
- `usedOtpMessageIds`: recent used Gmail OTP message IDs.
- `icimsOpenedIds`: iCIMS reset polling state (previously opened message IDs).

Sync storage keys:

- `blocklist`: local extension company blocklist.
- `blocklistEnabled`: whether blocklist skipping is active.

External local JSON:

- `shared_blocklist.json`: shared blocklist used across browser instances through `blocklist_server.mjs`.

## Operational Notes for Claude

- The auto-queue builder is behind `autoQueueEnabled`; default shown in popup is OFF.
- The queue builder must only add jobs with a same-card `Autofill` badge. The relevant guard is in `content.js` lines 927-980 and the candidate filter is lines 982-1018.
- The queue builder should not click the JobRight Filters button. The explicit Filters-panel closer is in `content.js` lines 1184-1235, and chat input detection avoids `Filters` text in lines 335-354.
- The system prompt is sent only after each group of 10 newly confirmed successful submissions.
- `content.js` persists the counter and observed submission signatures across reloads.
- Failed, limited, and unsubmitted application states do not advance the counter.
- Page load, tab focus, visibility changes, and bot replies do not trigger the system prompt.
- A terminal ATS page first triggers JobRight's `I've Applied` control. If the
  active card exposes only `Skip`, the extension clicks that instead.
- When that Skip fallback follows an explicit ATS success page, it counts as
  one confirmed success because JobRight will not emit its normal submitted
  chat status. Terminal failures and application limits do not count.
- While JobRight is executing, the active application card is watched for
  progress. The same job is skipped after 1 minute 20 seconds without a visible step
  change, and the timer resets when the job or its progress text changes.
- More-jobs prompt should only send when:
  - queue count is zero,
  - the latest visible JobRight message exactly matches `All jobs application have been completed. Do you want me to pull more jobs to apply now ?`,
  - recent duplicate suppression allows it.
  - See `content.js` lines 478-601 and 680-729.
- OTP matching depends on active JobRight context plus ATS hints. Inspect `content.js` lines 158-194, `ats_content.js` lines 353-417, and `background.js` lines 147-191 and 774-832 together.
- Fallback resume upload is gated by explicit Resume/CV-missing evidence from JobRight or the ATS and will not replace a file already attached to the selected input.
- Required checkbox handling is intentionally limited to mandatory consent/terms/privacy/confirm-style checkboxes. See `ats_content.js` lines 569-595.
- Hybrid, onsite, in-office, commuting, and relocation questions are corrected
  to Yes. Selected custom radio buttons are detected by accessibility state,
  common selected classes, or a colored selected background.
- In-office matching includes combined location/attendance wording such as
  "located in Utah and able to come into our Lehi office Mon-Fri," office-day
  schedules, reporting to an office, and local/commuting questions. Closed
  custom dropdowns are opened once and their visible Yes option is selected once.
- Sponsorship questions are explicitly corrected to No, while affirmative work
  authorization questions are explicitly corrected to Yes. These predicates
  are mutually exclusive from relocation handling.
- Eligibility classification reads only the question prompt. Answer labels and
  explanations such as "I would require sponsorship" are excluded so a No
  option cannot make an authorization question look like a sponsorship prompt.
- Each eligibility answer has a per-question click lock. The extension clicks
  the intended answer at most once per application URL, even if DOM mutations
  occur before the ATS paints its selected state.
- Validation repair never clicks an already-selected radio/toggle because some
  ATS components interpret a second click as clearing the answer.
- Validation repair also never chooses an unanswered radio, checkbox, button,
  or option. It can only re-emit events for an existing selected choice or an
  already-populated text/select value.
