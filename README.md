# JobRight Auto-Skip

Private Chrome extension for JobRight queue automation, ATS completion recovery,
Gmail OTP support, and configurable application handling.

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
