'use strict';

try { importScripts('oauth_config.js'); } catch (_) {}

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const GMAIL_MESSAGES_URL    = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const OTP_SEARCH_QUERY      = 'newer_than:1d (from:greenhouse-mail.io OR "security code" OR "verification code" OR otp OR "one-time" OR passcode)';
const OTP_WINDOW_MS         = 60 * 60 * 1000;
const OTP_PATTERN           = /(?<!\d)\d{4,8}(?!\d)/;
const OTP_ALPHANUM_PATTERN  = /\b([A-Za-z0-9]{4,8}|[A-Za-z0-9]{3,4}[-\s][A-Za-z0-9]{3,4})\b/;
const OTP_CONTEXT_PATTERN   = /\b(otp|one[-\s]?time|verification|verify|security|auth|authentication|passcode|code)\b/i;
const MESSAGE_FIELDS        = 'id,snippet,internalDate,payload(headers(name,value),mimeType,body/data,parts(mimeType,body/data,parts(mimeType,body/data,parts(mimeType,body/data))))';
const AUTH_TIMEOUT_MS       = 20 * 1000;
const TOKEN_REFRESH_ALARM   = 'gmailTokenRefresh';   // proactive silent refresh
const JOBRIGHT_PROMPT_FILE  = 'jobright_system_prompt.txt';
const JOBRIGHT_MORE_JOBS_PROMPT_FILE = 'jobright_more_jobs_prompt.txt';

const SHARED_BLOCKLIST_URL  = 'http://127.0.0.1:17373/blocklist';
const GMAIL_SCOPES          = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const jobrightFormCompleteByTab = new Map();
const jobrightActiveContextByTab = new Map();
const atsFrameIdsByTab = new Map();
const jobrightMissingFieldsByTab = new Map();
const OTP_COMPANY_HINT_MAX  = 10;
const JOBRIGHT_CONTEXT_FRESH_MS = 2 * 60 * 1000;
const JOBRIGHT_CONTEXT_STALE_MS = 10 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════════
// PART 1 — JobRight Auto-Skip broker
// ═════════════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://jobright.ai/*' });
  for (const tab of tabs) {
    await ensureJobrightContentScript(tab.id);
  }
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  // Proactively refresh token on browser start so first OTP request is instant
  silentTokenRefresh().catch(() => {});
});

function setupAlarms() {
  // Proactive token refresh — every 45 minutes (access tokens last 60 min)
  chrome.alarms.get(TOKEN_REFRESH_ALARM, (e) => {
    if (!e) chrome.alarms.create(TOKEN_REFRESH_ALARM, { periodInMinutes: 45 });
  });

}

function sendTabMessage(tabId, message, callback = () => {}) {
  try {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      callback(chrome.runtime.lastError || null, res);
    });
  } catch (err) {
    callback(err, null);
  }
}

async function injectScript(tabId, file) {
  if (!tabId) return false;
  try {
    if (file === 'content.js') {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => { globalThis.__jobrightForceContentReload = true; },
      });
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureJobrightContentScript(tabId) {
  return injectScript(tabId, 'content.js');
}

async function ensureAtsContentScript(tab) {
  const host = (() => {
    try { return new URL(tab?.url || '').hostname; } catch (_) { return ''; }
  })();
  if (!/\b(lever\.co|greenhouse\.io|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|oraclecloud\.com|successfactors\.(?:com|eu)|applytojob\.com|recruitee\.com|teamtailor\.com|ultipro\.com|breezy\.hr|rippling\.com|pinpointhq\.com|comeet\.com|taleo\.net)$/i.test(host)) {
    return false;
  }
  return injectScript(tab.id, 'ats_content.js');
}

function sendJobrightTabMessage(tabId, message, callback = () => {}) {
  sendTabMessage(tabId, message, async (err, res) => {
    if (!err) {
      callback(null, res);
      return;
    }
    const injected = await ensureJobrightContentScript(tabId);
    if (!injected) {
      callback(err, null);
      return;
    }
    sendTabMessage(tabId, message, callback);
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TOKEN_REFRESH_ALARM) {
    silentTokenRefresh().catch(() => {});
  }
});

setupAlarms();

async function loadExtensionTextFile(file) {
  const res = await fetch(chrome.runtime.getURL(file));
  if (!res.ok) throw new Error(`Unable to load ${file}`);
  return (await res.text()).trim();
}

async function sendJobrightChatPrompt(file, targetTabId = null) {
  const prompt = await loadExtensionTextFile(file);
  if (!prompt) return;

  const tabs = targetTabId
    ? [{ id: targetTabId }]
    : await chrome.tabs.query({ url: 'https://jobright.ai/*' });
  for (const tab of tabs) {
    if (!tab.id) continue;
    sendJobrightTabMessage(tab.id, {
      type: 'SEND_JOBRIGHT_SYSTEM_PROMPT',
      prompt,
    }, () => {});
  }
}

async function sendJobrightSystemPrompt() {
  return sendJobrightChatPrompt(JOBRIGHT_PROMPT_FILE);
}

async function sendJobrightMoreJobsPrompt(targetTabId = null) {
  return sendJobrightChatPrompt(JOBRIGHT_MORE_JOBS_PROMPT_FILE, targetTabId);
}



function cleanOtpCompanyHint(value = '') {
  let text = String(value)
    .replace(/\s+/g, ' ')
    .replace(/[|•]+/g, ' ')
    .trim();

  const companyPatterns = [
    /\bsecurity\s+code\s+for\s+your\s+application\s+to\s+(.+)$/i,
    /\bapplication\s+(?:to|for|at)\s+(.+)$/i,
    /\bapplying\s+to\s+(.+)$/i,
    /\bthank you(?:\s+\w+){0,6}\s+for applying\s+to\s+(.+)$/i,
    /\bview more jobs at\s+(.+)$/i,
  ];
  for (const re of companyPatterns) {
    const match = text.match(re);
    if (match?.[1]) {
      text = match[1];
      break;
    }
  }

  const titleAtCompany = text.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 .,&'’:+-]{2,80})$/i);
  if (titleAtCompany && /\b(product|program|project|manager|owner|lead|director|engineer|analyst|role|position|household)\b/i.test(text)) {
    text = titleAtCompany[1];
  }

  return text
    .replace(/^\s*(?:for|at)\s*,?\s*/i, ' ')
    .replace(/\s+-\s+gmail$/i, ' ')
    .replace(/\s+inbox\s*$/i, ' ')
    .replace(/\b(?:job application started|autofill|skip|senior|sr\.?|technical|data|ai|product|program|project|manager|owner|lead|director|remote|hybrid|onsite|full-time|application site)\b/gi, ' ')
    .replace(/\b(?:incorporated|inc\.?|llc|l\.l\.c\.|corp\.?|corporation|company)\b$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function normalizeOtpSearchText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeOtpCompany(value = '') {
  return normalizeOtpSearchText(cleanOtpCompanyHint(value));
}

function normalizeOtpCompanyHints(values = []) {
  const out = [];
  for (const value of values || []) {
    const cleaned = cleanOtpCompanyHint(value);
    const norm = normalizeOtpCompany(cleaned);
    if (!cleaned || norm.length < 3) continue;
    if (/^(greenhouse|greenhouse recruiting|security code|verification code|application site|lever|ashby|jobright|bubble)$/i.test(cleaned)) continue;
    const tokens = String(cleaned).split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (tokens.length === 1 && OTP_TOKEN_STOP_WORDS.has(tokens[0].toLowerCase())) continue;
    if (!out.some(existing => normalizeOtpCompany(existing) === norm)) out.push(cleaned);
    if (out.length >= OTP_COMPANY_HINT_MAX) break;
  }
  return out;
}

function getCachedActiveJobContext(tabId, maxAge = JOBRIGHT_CONTEXT_FRESH_MS) {
  const cached = tabId ? jobrightActiveContextByTab.get(tabId) : null;
  if (!cached || Date.now() - cached.at > maxAge) return [];
  return cached.hints || [];
}

function getActiveJobContextFromTab(tabId) {
  return new Promise(resolve => {
    if (!tabId) return resolve([]);
    const freshCached = getCachedActiveJobContext(tabId);
    if (freshCached.length) return resolve(freshCached);

    try {
      chrome.tabs.sendMessage(tabId, { type: 'GET_ACTIVE_JOB_CONTEXT' }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          return resolve(getCachedActiveJobContext(tabId, JOBRIGHT_CONTEXT_STALE_MS));
        }
        const hints = normalizeOtpCompanyHints([res.company, res.title, ...(res.hints || [])]);
        if (hints.length) jobrightActiveContextByTab.set(tabId, { hints, at: Date.now() });
        resolve(hints);
      });
    } catch (_) {
      resolve(getCachedActiveJobContext(tabId, JOBRIGHT_CONTEXT_STALE_MS));
    }
  });
}

async function resolveOtpCompanyHints(sender, explicitHints = []) {
  const tabHints = await getActiveJobContextFromTab(sender?.tab?.id);
  return normalizeOtpCompanyHints([...tabHints, ...(explicitHints || [])]);
}

async function sharedBlocklistFetch(path = '', options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${SHARED_BLOCKLIST_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`shared blocklist ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ATS submission → JobRight "I've Applied" broker
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ATS_FRAME_READY') {
    const tabId = _sender?.tab?.id;
    const frameId = _sender?.frameId;
    if (tabId !== undefined && frameId !== undefined) {
      const frames = atsFrameIdsByTab.get(tabId) || new Set();
      frames.add(frameId);
      atsFrameIdsByTab.set(tabId, frames);
      const pendingFields = jobrightMissingFieldsByTab.get(tabId) || [];
      if (pendingFields.length) {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'NUDGE_JOBRIGHT_MISSING_FIELDS', fields: pendingFields },
          { frameId },
          () => void chrome.runtime.lastError,
        );
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'JOBRIGHT_NUDGE_MISSING_FIELDS') {
    const tabId = _sender?.tab?.id;
    const fields = Array.isArray(msg.fields) ? msg.fields.filter(Boolean).slice(0, 12) : [];
    if (tabId !== undefined) {
      if (fields.length) jobrightMissingFieldsByTab.set(tabId, fields);
      else jobrightMissingFieldsByTab.delete(tabId);
    }
    const frames = tabId !== undefined ? [...(atsFrameIdsByTab.get(tabId) || [])] : [];
    if (!tabId || !fields.length || !frames.length) {
      sendResponse({ ok: false, delivered: 0 });
      return true;
    }
    let delivered = 0;
    let pending = frames.length;
    frames.forEach(frameId => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'NUDGE_JOBRIGHT_MISSING_FIELDS', fields },
        { frameId },
        (res) => {
          if (!chrome.runtime.lastError && res?.ok) delivered++;
          if (--pending === 0) sendResponse({ ok: delivered > 0, delivered });
        },
      );
    });
    return true;
  }

  if (msg.type === 'ATS_SUBMISSION_DETECTED') {
    chrome.tabs.query({ url: 'https://jobright.ai/*' }, (tabs) => {
      if (!tabs?.length) return;
      const senderTabId = _sender?.tab?.id;
      const target = tabs.find(t => t.id === senderTabId) ||
        tabs.find(t => t.active) ||
        tabs[0];
      const payload = {
        type: 'TRIGGER_IVE_APPLIED',
        atsOrigin: msg.origin,
        atsUrl: msg.url,
        confirmedSuccess: !!msg.confirmedSuccess,
        confirmedFailure: !!msg.confirmedFailure,
      };
      let attempts = 0;
      const send = async () => {
        attempts++;
        sendJobrightTabMessage(target.id, payload, (err, res) => {
          if ((err || !res?.ok) && attempts < 8) setTimeout(send, 750);
        });
      };
      send();
    });
    return false;
  }

  if (msg.type === 'JOBRIGHT_FORM_COMPLETE_STATE') {
    const tabId = _sender?.tab?.id;
    if (tabId) jobrightFormCompleteByTab.set(tabId, { complete: !!msg.complete, at: Date.now() });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'JOBRIGHT_ACTIVE_JOB_CONTEXT') {
    const tabId = _sender?.tab?.id;
    const hints = normalizeOtpCompanyHints([msg.company, msg.title, ...(msg.hints || [])]);
    if (tabId && hints.length) jobrightActiveContextByTab.set(tabId, { hints, at: Date.now() });
    sendResponse({ ok: true, companyHints: hints });
    return true;
  }

  if (msg.type === 'CHECK_JOBRIGHT_FORM_COMPLETE') {
    const tabId = _sender?.tab?.id;
    const state = tabId ? jobrightFormCompleteByTab.get(tabId) : null;
    sendResponse({ ok: true, complete: !!state?.complete && Date.now() - state.at < 2 * 60 * 1000 });
    return true;
  }

  if (msg.type === 'SHARED_BLOCKLIST_GET') {
    sharedBlocklistFetch()
      .then(data => sendResponse({ ok: true, blocklist: Array.isArray(data.blocklist) ? data.blocklist : [] }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SHARED_BLOCKLIST_ADD') {
    sharedBlocklistFetch('/add', { method: 'POST', body: JSON.stringify({ company: msg.company || '' }) })
      .then(data => sendResponse({ ok: true, blocklist: Array.isArray(data.blocklist) ? data.blocklist : [] }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SHARED_BLOCKLIST_REMOVE') {
    sharedBlocklistFetch('/remove', { method: 'POST', body: JSON.stringify({ company: msg.company || '' }) })
      .then(data => sendResponse({ ok: true, blocklist: Array.isArray(data.blocklist) ? data.blocklist : [] }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SHARED_BLOCKLIST_REPLACE') {
    sharedBlocklistFetch('/replace', { method: 'POST', body: JSON.stringify({ blocklist: msg.blocklist || [] }) })
      .then(data => sendResponse({ ok: true, blocklist: Array.isArray(data.blocklist) ? data.blocklist : [] }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'CHECK_GMAIL_AUTH') {
    // For Chrome-native path: first check if we've stored a successful connection flag.
    // This avoids a race where getAuthToken(false) hasn't cached the token yet.
    storageGet(['gmailNativeConnected', 'gmailConnectedEmail']).then(stored => {
      const verifyToken = (token) =>
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }).then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)));

      if (stored.gmailNativeConnected) {
        // Verify the cached auth is still valid
        getAuthToken(false)
          .then(token => verifyToken(token))
          .then(data => sendResponse({ ok: true, sub: data.emailAddress || stored.gmailConnectedEmail || '' }))
          .catch(() => {
            // Token expired or revoked — clear stored flag
            storageSet({ gmailNativeConnected: false, gmailConnectedEmail: '' }).catch(() => {});
            sendResponse({ ok: false, error: 'Session expired — please reconnect' });
          });
      } else {
        // No stored flag — try a fresh silent probe (handles tab-level or PKCE sessions)
        getAuthToken(false)
          .then(token => verifyToken(token))
          .then(data => {
            // Opportunistically store the flag if silent auth works
            storageSet({ gmailNativeConnected: true, gmailConnectedEmail: data.emailAddress || '' }).catch(() => {});
            sendResponse({ ok: true, sub: data.emailAddress || '' });
          })
          .catch(() => sendResponse({ ok: false }));
      }
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'REVOKE_GMAIL_AUTH') {
    storageSet({ gmailNativeConnected: false, gmailConnectedEmail: '' }).catch(() => {});
    clearAccessToken().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'LOGIN') {
    getAuthToken(true)
      .then(async (token) => {
        // Verify the token actually works with the Gmail API
        try {
          const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.ok) {
            const data = await r.json();
            // Store a connection flag so checkGmailStatus() can detect Chrome-native auth
            await storageSet({
              gmailNativeConnected: true,
              gmailConnectedEmail: data.emailAddress || '',
              gmailLastAuthError: null,
            });
            sendResponse({ ok: true, email: data.emailAddress || '' });
          } else {
            const body = await r.text().catch(() => '');
            sendResponse({ ok: false, error: `Gmail API rejected token (${r.status})${body ? ': ' + body.slice(0, 120) : ''}` });
          }
        } catch (verifyErr) {
          // Network hiccup — token may still be valid; treat as connected
          await storageSet({ gmailNativeConnected: true, gmailConnectedEmail: '' }).catch(() => {});
          sendResponse({ ok: true, email: '' });
        }
      })
      .catch(async (e) => {
        const msg = e.message;
        console.error('[JobRight] LOGIN failed:', msg);
        await storageSet({
          gmailNativeConnected: false,
          gmailLastAuthError: msg,
          gmailLastAuthErrorAt: Date.now(),
        }).catch(() => {});
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }

  if (msg.type === 'FETCH_OTP') {
    handleFetchOtp({ interactive: true }).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'AUTO_FETCH_OTP') {
    resolveOtpCompanyHints(_sender, msg.companyHints || [])
      .then(companyHints => {
        if (!companyHints.length) {
          return {
            ok: false,
            seenMessageIds: [],
            companyHints,
            error: 'No company context available for safe OTP matching.',
          };
        }
        return handleFetchOtp({
          interactive: false,
          deliverToActiveTab: false,
          ignoreMessageIds: msg.ignoreMessageIds || [],
          baselineTimestamp: msg.baselineTimestamp || 0,
          companyHints,
        }).then(res => ({ ...res, companyHints }));
      })
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'PLACE_OTP_IN_JOBRIGHT_CHAT') {
    const tabId = _sender?.tab?.id;
    if (tabId) {
      sendTabMessage(tabId, {
        type: 'PLACE_OTP_IN_JOBRIGHT_CHAT',
        otp: msg.otp,
      }, () => {});
    }
    sendResponse({ ok: true });
    return true;
  }



  if (msg.type === 'RUN_JOBRIGHT_SYSTEM_PROMPT_NOW') {
    sendJobrightChatPrompt(JOBRIGHT_PROMPT_FILE, _sender?.tab?.id || null)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'RUN_JOBRIGHT_MORE_JOBS_PROMPT_NOW') {
    sendJobrightMoreJobsPrompt(_sender?.tab?.id || null)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  return false;
});

// ═════════════════════════════════════════════════════════════════════════════
// PART 2 — Auth: browser-aware OAuth
// Google Chrome  → chrome.identity.getAuthToken (native, uses manifest oauth2 client)
// Brave / Comet / all other Chromium builds → PKCE via launchWebAuthFlow
// ═════════════════════════════════════════════════════════════════════════════

// navigator.vendor === 'Google Inc.' only in genuine Google Chrome.
// Brave, Comet, Edge, etc. return '' or something else.
const IS_GOOGLE_CHROME = (() => { try { return /Google Inc/i.test(navigator.vendor); } catch { return false; } })();

// ── PKCE client — Web Application type in Google Cloud Console ───────────────
// Steps to create:
//   1. Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
//   2. Application type: Web application
//   3. Authorized redirect URIs: add  https://hnhddomfeckgphepjjhkaighacdmhdco.chromiumapp.org/
//   4. Copy the Client ID and paste below
const PKCE_CLIENT_ID = globalThis.JOBRIGHT_OAUTH_CONFIG?.clientId || '';
const PKCE_CLIENT_SECRET = globalThis.JOBRIGHT_OAUTH_CONFIG?.clientSecret || '';
const PKCE_REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;

// ── Utility helpers ──────────────────────────────────────────────────────────

function withTimeout(promise, ms, msg) {
  let id;
  const t = new Promise((_, rej) => { id = setTimeout(() => rej(new Error(msg)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(id));
}

function storageGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

function storageSet(items) {
  return new Promise((res, rej) => chrome.storage.local.set(items, () =>
    chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res()
  ));
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── PKCE login (interactive popup — Brave/Comet/others) ──────────────────────

async function pkceLogin() {
  if (!PKCE_CLIENT_ID || !PKCE_CLIENT_SECRET) {
    throw new Error('Missing oauth_config.js. Copy oauth_config.example.js and add the Google OAuth credentials locally.');
  }
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',             PKCE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',          PKCE_REDIRECT_URI);
  authUrl.searchParams.set('response_type',         'code');
  authUrl.searchParams.set('scope',                 GMAIL_SCOPES);
  authUrl.searchParams.set('code_challenge',        challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type',           'offline');
  authUrl.searchParams.set('prompt',                'consent');

  const resultUrl = await withTimeout(
    new Promise((res, rej) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (url) => {
        if (chrome.runtime.lastError || !url)
          rej(new Error(chrome.runtime.lastError?.message || 'Auth cancelled'));
        else res(url);
      });
    }),
    AUTH_TIMEOUT_MS,
    'Google sign-in did not finish.'
  );

  const code = new URL(resultUrl).searchParams.get('code');
  if (!code) throw new Error('No auth code in redirect URL');

  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: PKCE_CLIENT_ID, redirect_uri: PKCE_REDIRECT_URI,
        client_secret: PKCE_CLIENT_SECRET,
        grant_type: 'authorization_code', code, code_verifier: verifier,
      }),
    });
  } catch (err) {
    throw new Error(`Google token endpoint fetch failed: ${err.message}`);
  }
  const json = await r.json();
  if (json.error || !json.access_token)
    throw new Error(json.error_description || json.error || 'Token exchange failed');

  await storageSet({
    gmailOtpOAuthToken:   { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 },
    gmailOtpRefreshToken: json.refresh_token,
  });
  return json.access_token;
}

// ── PKCE get token with silent refresh ───────────────────────────────────────

async function pkceGetToken(interactive = true) {
  const { gmailOtpOAuthToken: access, gmailOtpRefreshToken: refresh } =
    await storageGet(['gmailOtpOAuthToken', 'gmailOtpRefreshToken']);

  if (access?.accessToken && access.expiresAt > Date.now() + 60_000) return access.accessToken;

  if (refresh) {
    try {
      let r;
      try {
        r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: PKCE_CLIENT_ID,
            client_secret: PKCE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refresh,
          }),
        });
      } catch (err) {
        throw new Error(`Google refresh endpoint fetch failed: ${err.message}`);
      }
      const json = await r.json();
      if (json.access_token) {
        await storageSet({ gmailOtpOAuthToken: { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 } });
        return json.access_token;
      }
    } catch (_) {}
  }

  if (!interactive) throw new Error('No valid token — user must re-authenticate');
  return pkceLogin();
}

// ── Main auth entry point ─────────────────────────────────────────────────────

async function getAuthToken(interactive = true) {
  if (IS_GOOGLE_CHROME) {
    return withTimeout(
      new Promise((res, rej) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          const err = chrome.runtime.lastError;
          if (err || !token) rej(new Error(err?.message || 'Unable to retrieve OAuth token.'));
          else res(token);
        });
      }),
      AUTH_TIMEOUT_MS,
      'Google sign-in did not finish.'
    );
  }
  return pkceGetToken(interactive);
}

function clearAccessToken() {
  if (IS_GOOGLE_CHROME) {
    return new Promise(res => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) chrome.identity.removeCachedAuthToken({ token }, res);
        else res();
      });
    });
  }
  return storageSet({ gmailOtpOAuthToken: null });
}

async function silentTokenRefresh() {
  try {
    await getAuthToken(false);
    console.log('[JobRight Auto-Skip] Token refreshed silently');
  } catch (err) {
    console.warn('[JobRight Auto-Skip] Silent refresh failed (will retry next alarm):', err.message);
  }
}

// ── Auto-refresh wrapper for gmailFetch ──────────────────────────────────────
// If a 401 comes back mid-session (e.g. token was revoked), clears the cache
// and retries once with a fresh token before giving up.

async function gmailFetch(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });

  if (res.status === 401) {
    // Token rejected — clear cached access token and try once more with a fresh one
    await clearAccessToken();
    try {
      const freshToken = await getAuthToken(false); // silent refresh using refresh token
      const retry = await fetch(url, { headers: { Authorization: `Bearer ${freshToken}`, Accept: 'application/json' } });
      if (!retry.ok) {
        const t = await retry.text();
        throw new Error(`Gmail API error after refresh (${retry.status}): ${t}`);
      }
      return retry.json();
    } catch (refreshErr) {
      throw new Error(`Gmail auth expired and silent refresh failed: ${refreshErr.message}`);
    }
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error('Gmail rate limit — retrying shortly');
    throw new Error(`Gmail API error (${res.status})`);
  }
  return res.json();
}

// ═════════════════════════════════════════════════════════════════════════════
// PART 3 — Gmail helpers, OTP extraction, fetch pipeline
// ═════════════════════════════════════════════════════════════════════════════

function base64UrlDecode(value = '') {
  const n = value.replace(/-/g, '+').replace(/_/g, '/');
  const p = n.padEnd(Math.ceil(n.length / 4) * 4, '=');
  return new TextDecoder('utf-8').decode(Uint8Array.from(atob(p), c => c.charCodeAt(0)));
}

function getHeader(headers = [], name) {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function collectBodyParts(payload, out = []) {
  if (!payload) return out;
  if (payload.body?.data) out.push({ mimeType: payload.mimeType || '', data: payload.body.data });
  for (const part of payload.parts || []) collectBodyParts(part, out);
  return out;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c))).replace(/\s+/g, ' ').trim();
}

function extractMessageText(message) {
  const parts = collectBodyParts(message.payload);
  return [...parts.filter(p => p.mimeType.includes('text/plain')),
          ...parts.filter(p => p.mimeType.includes('text/html')),
          ...parts.filter(p => !p.mimeType.includes('text/plain') && !p.mimeType.includes('text/html'))]
    .map(p => { const d = base64UrlDecode(p.data); return p.mimeType.includes('text/html') ? stripHtml(d) : d; })
    .join('\n');
}

const OTP_TOKEN_STOP_WORDS = new Set([
  'code', 'copy', 'paste', 'after', 'enter', 'submit', 'security', 'verify',
  'inbox', 'greenhouse', 'recruiting', 'application', 'manufacturing',
  'linkedin', 'youtube', 'facebook', 'build',
  // Common words from OTP email subjects that could be mistaken for codes
  'your', 'this', 'that', 'with', 'from', 'into', 'over', 'once', 'more',
  'team', 'here', 'also', 'done', 'sent', 'role', 'site', 'next', 'step',
  'form', 'link', 'back', 'open', 'just', 'them', 'they', 'when', 'what',
  // Short/common words that appear in subjects near company names
  'to2k', 'for2k', 'the2k',
]);

function normalizeOtpToken(raw = '') {
  return String(raw).replace(/[-\s]/g, '').trim();
}

function isLikelyOtpToken(raw, companyHints = []) {
  const token = normalizeOtpToken(raw);
  if (!/^[A-Za-z0-9]{4,8}$/.test(token)) return false;
  const lower = token.toLowerCase();
  if (OTP_TOKEN_STOP_WORDS.has(lower)) return false;
  if (/^(19|20)\d{2}$/.test(token) || /^\d{10,}$/.test(token)) return false;

  const normalizedToken = normalizeOtpCompany(token);
  // Reject if token matches any company hint (whole or token-level)
  if (normalizedToken && companyHints.length) {
    if (companyHints.some(h => {
      const normHint = normalizeOtpCompany(h);
      // Reject if hint contains this token, or token contains hint
      if (normHint.includes(normalizedToken) || normalizedToken.includes(normHint)) return true;
      // Also reject on per-word level: any hint word >= 3 chars that matches this token
      return String(h).split(/[^A-Za-z0-9]+/)
        .map(t => normalizeOtpSearchText(t))
        .some(t => t.length >= 3 && t === normalizedToken);
    })) return false;
  }

  const hasDigit = /\d/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const titleCaseWord = /^[A-Z][a-z]{3,7}$/.test(token);

  if (/^\d+$/.test(token)) return token.length >= 4 && token.length <= 8;
  if (titleCaseWord) return false;
  // Pure-alpha tokens without digits: only accept if they look like a real code.
  // - All-uppercase 6-8 chars: e.g. ABCXYZ — plausible code
  // - Mixed-case exactly 8 chars: e.g. OZiancJR (Greenhouse 8-char OTP format) — allow
  // - Mixed-case 4-7 chars (e.g. 'toFlip', 'Lever'): reject — too likely a word/company name
  if (!hasDigit) {
    if (token.length === 8 && hasUpper && hasLower) return true; // Greenhouse 8-char mixed-case OTPs
    if (token.length >= 6 && /^[A-Z]{6,8}$/.test(token)) return true; // all-caps codes
    return false;
  }
  return hasUpper || hasLower || token.length >= 4;
}

function firstOtpCandidateFromText(text, companyHints = []) {
  const alphanumG = new RegExp(OTP_ALPHANUM_PATTERN.source, 'g');
  for (const match of text.matchAll(alphanumG)) {
    const cand = match[1] || match[0];
    if (isLikelyOtpToken(cand, companyHints)) return normalizeOtpToken(cand);
  }
  const num = text.match(OTP_PATTERN)?.[0];
  return num && isLikelyOtpToken(num, companyHints) ? num : null;
}

function extractOtp(text, companyHints = []) {
  if (!OTP_CONTEXT_PATTERN.test(text)) return null;
  const cleaned = text
    .replace(/(?:©|\(c\)|copyright)\s*\d{4}/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\d{10,}/g, '');

  const lines = cleaned
    .split(/\r?\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const triggerMatch = lines[i].match(/\b(copy\s+and\s+paste\s+this\s+code|security\s+code|verification\s+code|enter\s+the\s+code|your\s+code)\b/i);
    if (!triggerMatch) continue;
    const windowText = lines.slice(i, i + 7).join('\n');
    // Strip only the trigger phrase (not the entire line) so the OTP that
    // follows the phrase on the same line is preserved.  Greenhouse HTML
    // emails collapse to a single line after stripHtml, so the OTP sits
    // right after the phrase on lines[i].
    const afterTrigger = windowText.slice(windowText.indexOf(triggerMatch[0]) + triggerMatch[0].length);
    const candidate = firstOtpCandidateFromText(afterTrigger, companyHints) ||
      firstOtpCandidateFromText(windowText, companyHints);
    if (candidate) return candidate;
  }


  const explicitWindows = [
    /\bcopy\s+and\s+paste\s+this\s+code\b[\s\S]{0,220}/i,
    /\bsecurity\s+code\b[\s\S]{0,220}/i,
    /\bverification\s+code\b[\s\S]{0,220}/i,
    /\byour\s+code\b[\s\S]{0,160}/i,
  ];
  for (const re of explicitWindows) {
    const win = cleaned.match(re)?.[0];
    const candidate = win && firstOtpCandidateFromText(win, companyHints);
    if (candidate) return candidate;
  }

  const windows = [];
  let m;
  const re = /\b(otp|one[-\s]?time|verification|verify|security|auth|authentication|passcode|code)\b/gi;
  while ((m = re.exec(text)) !== null) {
    const s = Math.max(0, m.index - 80), e = Math.min(text.length, m.index + 250);
    windows.push({ raw: text.slice(s, e), cleaned: cleaned.slice(s, e) });
  }

  for (const { raw, cleaned: win } of windows) {
    const candidate = firstOtpCandidateFromText(raw, companyHints) ||
      firstOtpCandidateFromText(win, companyHints);
    if (candidate) return candidate;
  }
  const fallback = cleaned.match(OTP_PATTERN)?.[0];
  return fallback && isLikelyOtpToken(fallback, companyHints) ? fallback : null;
}

function isRecentMessage(msg) {
  const d = Number(msg.internalDate || 0);
  return d > 0 && Date.now() - d <= OTP_WINDOW_MS;
}

function otpMessageMatchesCompanyHints(messageText, companyHints = []) {
  const hints = normalizeOtpCompanyHints(companyHints);
  if (!hints.length) return true;
  const normalizedMessage = normalizeOtpSearchText(messageText);
  if (!normalizedMessage) return false;
  return hints.some(hint => {
    const normalizedHint = normalizeOtpCompany(hint);
    const tokens = String(hint)
      .split(/[^A-Za-z0-9]+/)
      .map(normalizeOtpSearchText)
      .filter(token => token.length >= 4 && !/^(product|manager|senior|technical|remote|hybrid|onsite|fulltime|household)$/.test(token));
    return normalizedHint.length >= 3 &&
      (normalizedMessage.includes(normalizedHint) || tokens.some(token => normalizedMessage.includes(token)));
  });
}

async function fetchLatestOtp({ interactive = true, ignoreMessageIds = [], baselineTimestamp = 0, companyHints = [] } = {}) {
  const token = await getAuthToken(interactive);
  const listUrl = new URL(GMAIL_MESSAGES_URL);
  listUrl.searchParams.set('q', OTP_SEARCH_QUERY);
  listUrl.searchParams.set('maxResults', '25');
  listUrl.searchParams.set('fields', 'messages(id)');

  const { messages = [] } = await gmailFetch(token, listUrl.toString());
  const ignoreSet = new Set(ignoreMessageIds);
  let stale = 0, codeMissing = 0, companyMismatch = 0;

  const detailed = await Promise.all(
    messages.map(({ id }) => {
      const u = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(id)}`);
      u.searchParams.set('format', 'full');
      u.searchParams.set('fields', MESSAGE_FIELDS);
      return gmailFetch(token, u.toString());
    })
  );
  detailed.sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

  for (const message of detailed) {
    if (ignoreSet.has(message.id)) continue;
    if (baselineTimestamp > 0 && Number(message.internalDate || 0) < baselineTimestamp - 60_000) continue;
    if (!isRecentMessage(message)) { stale++; continue; }
    const subject = getHeader(message.payload?.headers, 'Subject');
    const bodyText = extractMessageText(message);
    if (!otpMessageMatchesCompanyHints(`${subject}\n${bodyText}`, companyHints)) {
      companyMismatch++;
      continue;
    }
    const otp = extractOtp(`${bodyText}\n${subject}`, companyHints);
    if (otp) return { otp, messageId: message.id, subject, seenMessageIds: messages.map(m => m.id) };
    codeMissing++;
  }
  return {
    otp: null,
    seenMessageIds: messages.map(m => m.id),
    staleCandidateCount: stale,
    codeMissingCandidateCount: codeMissing,
    companyMismatchCandidateCount: companyMismatch,
  };
}

async function handleFetchOtp({ interactive = true, deliverToActiveTab = true, ignoreMessageIds = [], baselineTimestamp = 0, companyHints = [] } = {}) {
  let persistedIgnore = [];
  try {
    const { usedOtpMessageIds = [] } = await storageGet(['usedOtpMessageIds']);
    const cutoff = Date.now() - OTP_WINDOW_MS;
    persistedIgnore = usedOtpMessageIds.filter(e => e.ts > cutoff).map(e => e.id);
  } catch (_) {}

  const combined = [...new Set([...ignoreMessageIds, ...persistedIgnore])];
  const result = await fetchLatestOtp({ interactive, ignoreMessageIds: combined, baselineTimestamp, companyHints });

  if (result?.otp) {
    try {
      const { usedOtpMessageIds = [] } = await storageGet(['usedOtpMessageIds']);
      const cutoff = Date.now() - OTP_WINDOW_MS;
      const fresh = usedOtpMessageIds.filter(e => e.ts > cutoff);
      fresh.push({ id: result.messageId, ts: Date.now() });
      await storageSet({ usedOtpMessageIds: fresh });
    } catch (_) {}

    if (deliverToActiveTab) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await ensureAtsContentScript(tab);
        sendTabMessage(tab.id, { type: 'OTP_FOUND', otp: result.otp, messageId: result.messageId, subject: result.subject });
      }
    }
    return { ok: true, otp: result.otp, messageId: result.messageId, seenMessageIds: result.seenMessageIds || [result.messageId] };
  }

  return {
    ok: false,
    seenMessageIds: result?.seenMessageIds || [],
    error: result?.companyMismatchCandidateCount > 0
        ? `Found ${result.companyMismatchCandidateCount} recent OTP email(s), but none matched this company.`
      : result?.staleCandidateCount > 0
        ? `Found ${result.staleCandidateCount} candidate email(s) but none were recent enough.`
      : result?.codeMissingCandidateCount > 0
        ? `Found ${result.codeMissingCandidateCount} recent email(s) but no OTP detected.`
        : 'No recent OTP email found.'
  };
}
