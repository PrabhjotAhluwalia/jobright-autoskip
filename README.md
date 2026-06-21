# JobRight Auto-Skip

Private Chrome extension for JobRight queue automation, ATS completion recovery,
Gmail OTP support, and configurable application handling.

## What it automates

- Skips the active JobRight card when it visibly says
  `This job supports application autofill only on the application site`.
- Completes supported ATS forms, repairs reported required fields, uploads the
  bundled fallback resume/cover letter only when appropriate, and returns to
  JobRight after a confirmed submission.
- Retrieves fresh Gmail OTPs, including new messages added to an existing email
  thread. If an extension reload invalidates an ATS polling context, open ATS
  tabs are reinjected automatically.
- Saves a screenshot before a genuinely stuck application is skipped.

## Answering safeguards

The extension applies only the profile rules configured in `ats_content.js`.
Review every application before submission. In particular, it answers the
configured work-authorization, sponsorship, office/relocation, employment
restriction, familiarity/capability, contact, and profile-name questions; it
does not invent salary, credentials, or unknown profile details.

## Local setup

### Screenshot helper

The 100-second stuck-job workflow captures the visible JobRight tab, saves the
PNG, and then skips the job. Screenshots are saved to `Desktop/SS` by the local
helper in `blocklist_server.mjs`.

- macOS/Linux: run `node blocklist_server.mjs` from this folder.
- Windows: double-click `start_jobright_helper_windows.cmd`.

Node.js must be installed and the helper must remain running. If the helper is
unavailable, the extension falls back to the browser's `Downloads/SS` folder.

1. Copy `oauth_config.example.js` to `oauth_config.js`.
2. Add the Google OAuth client ID and secret used by non-Chrome Chromium browsers.
3. Load this directory as an unpacked extension.

`oauth_config.js` is intentionally excluded from Git.

## Shared-user setup

Start with the illustrated
[`Navjeet Mac setup PDF`](docs/Navjeet_JobRight_Mac_Guide.pdf).

The detailed text version is in
[`docs/NAVJEET_MAC_SETUP.md`](docs/NAVJEET_MAC_SETUP.md).
