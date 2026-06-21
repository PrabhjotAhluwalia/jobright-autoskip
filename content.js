'use strict';

// Reuse a healthy instance, but replace stale instances left behind when an
// unpacked extension is reloaded in an already-open JobRight tab.
var existingJobrightContentAlive = false;
var forceJobrightContentReload = globalThis.__jobrightForceContentReload === true;
try { delete globalThis.__jobrightForceContentReload; } catch (_) {}
try {
  existingJobrightContentAlive = !forceJobrightContentReload &&
    globalThis.__jobrightContentPing?.() === true;
} catch (_) {}

if (existingJobrightContentAlive) { /* already running */ }
else {
try { globalThis.__jobrightContentCleanup?.(); } catch (_) {}

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const CONFIG = {
  CONFIRM_BUBBLE_CLASS:  'confirm-bubble',
  CONFIRM_TRIGGER_TEXTS: [
    'this job supports application autofill only on the application site',
    'this job requires manual application',
  ],
  CONFIRM_SKIP_CLASS:    'ant-btn-text',

  ANALYZE_TRIGGER_TEXT:  'apply manually to open the application site',
  ANALYZE_BTN_TEXT:      'apply manually',

  DEBOUNCE_MS:  1200,
  COOLDOWN_MS:  3000,

  // ── Company selector (from inspect element) ─────────────────────────────────
  // Matches <span class="ant-typography ...">Company Name</span> inside a job card
  COMPANY_SELECTOR: 'span.ant-typography',
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let enabled              = true;
let blocklistEnabled     = true;   // flag: auto-skip known bad companies
let autoAppliedEnabled   = true;   // flag: auto-click "I've Applied" on ATS submission
let autoQueueEnabled     = false;  // flag: auto-build JobRight queue from right pane
let skipCount            = 0;
let blocklist            = [];     // normalized lowercase company names
let debounceTimer        = null;
let lastClickTime        = 0;
let alive                = true;
let lastMoreJobsPromptAt = 0;
let lastRetryClickAt     = 0;
let lastTerminalAppliedAt = 0;
let atsValidationHoldUntil = 0;
let atsFailureGraceSignature = '';
let atsFailureGraceStartedAt = 0;
let appliedTransitionTimer = null;
let appliedTransitionSignature = '';
let leverProtectedJobSignature = '';
let leverConfirmedSuccessSignature = '';
let stuckJobSignature = '';
let stuckJobProgressSignature = '';
let stuckJobLastProgressAt = 0;
let stuckJobSkipSignature = '';
let stuckJobScreenshotSignature = '';
let stuckJobWarningSignature = '';
let pendingStuckScreenshotSignature = '';
let timeoutCancellationLearningSuppressedUntil = 0;
let lastStuckScreenshotAttemptAt = 0;
let submissionCountSincePrompt = 0;
let submissionSeenCounts = new Map();
let submissionCounterReady = false;
let pendingChatPromptTimer = null;
let lastSharedBlocklistSyncAt = 0;
let lastFormCompleteState = null;
let lastJobrightSubmitNowSignature = '';
let lastJobrightSubmitNowAt = 0;
let lastMissingFieldsSignature = '';
let lastMissingFieldsPublishedAt = 0;
const processedCancellationSignatures = new Set();
let lastPublishedJobContextSignature = '';
let lastPublishedJobContextAt = 0;
let autoQueueTimer = null;
let autoQueueTimerDueAt = 0;
let autoQueueBusy = false;
let autoQueuePendingAdd = null;
let lastShowMoreMatchesAt = 0;
let lastAutoQueueStartAt = 0;
let lastAutoQueueAddAt = 0;
let lastViewAllClickAt = 0;
let lastAutoQueueActiveRunLogAt = 0;
let moreJobsPromptInFlight = false;
let moreJobsPromptArmed = true;
let autoQueueWaitingForMoreMatches = false;
let autoQueueLastShowMoreSignature = '';
let autoQueueRequestedBatchSignature = '';
let autoQueueNewBatchSeenAt = 0;
let titleExclusionCache = null;
let titleExclusionLoading = false;
let titleRegexExclusionCache = null;
let titleRegexExclusionLoading = false;
let terminalSuccessPhraseCache = [];
let builtInTerminalSuccessPhrases = [];
let customTerminalSuccessPhrases = [];
let terminalSuccessPhraseLoading = false;
const managedIntervalIds = [];
const autoQueueAddedKeys = new Set();
const timeoutSkippedCompanies = new Map();
const INVALID_BLOCKLIST_COMPANIES = new Set([
  'application',
  'applications',
  'autofill',
  'company',
  'job',
  'jobs',
  'position',
  'role',
  'skip',
  'start',
  'unknown',
  'va',
]);
const BLOCKLIST_COMPANY_MIGRATION_REMOVALS = new Set([
  'airbn',
  'airbnb',
  'braintrust',
  'delta dental of new jersey and connecticut',
  'lyft',
  'mutual of omaha mortgage',
  'zynga',
]);

globalThis.__jobrightContentPing = () => {
  try { return alive && !!chrome.runtime?.id; } catch (_) { return false; }
};

const MORE_JOBS_QUESTION = 'all jobs application have been completed. do you want me to pull more jobs to apply now ?';
const JOBRIGHT_QUEUE_LIMIT = 40;
const JOB_STUCK_WARNING_MS = 70 * 1000;
const JOB_STUCK_TIMEOUT_MS = 100 * 1000;
const STUCK_SCREENSHOT_RETRY_MS = 10 * 1000;
const TIMEOUT_BLOCKLIST_SUPPRESSION_MS = 5 * 60 * 1000;
const TIMEOUT_GLOBAL_BLOCKLIST_SUPPRESSION_MS = 10 * 60 * 1000;
const SYSTEM_PROMPT_SUBMISSION_INTERVAL = 10;
const SUBMISSION_COUNT_STORAGE_KEY = 'jobrightSubmissionCountSincePrompt';
const SUBMISSION_SEEN_STORAGE_KEY = 'jobrightSubmissionSeenCounts';
const MAX_STORED_SUBMISSION_SIGNATURES = 200;
const AUTO_QUEUE_DEFAULT_DELAY_MS = 300;
const AUTO_QUEUE_ADD_COOLDOWN_MS = 700;
const AUTO_QUEUE_POST_CLICK_DELAY_MS = 750;
const AUTO_QUEUE_WAIT_POLL_MS = 750;
const AUTO_QUEUE_BATCH_STABLE_MS = 1_000;
const AUTO_QUEUE_SCAN_INTERVAL_MS = 750;
const AUTO_QUEUE_SHOW_MORE_COOLDOWN_MS = 3_000;
const AUTO_QUEUE_ADD_CONFIRM_MS = 2_500;
const AUTO_QUEUE_ADD_MAX_ATTEMPTS = 2;
const MORE_JOBS_PROMPT_RETRY_GUARD_MS = 3_000;
const JOBRIGHT_EXCLUDED_TITLES_FILE = 'jobright_excluded_job_titles.txt';
const JOBRIGHT_EXCLUDED_TITLE_REGEXES_FILE = 'jobright_excluded_job_title_regexes.txt';
const JOBRIGHT_TERMINAL_SUCCESS_PHRASES_FILE = 'jobright_terminal_success_phrases.txt';
const CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY = 'customTerminalSuccessPhrases';
const JOBRIGHT_TITLE_EXCLUSION_FALLBACKS = [
  'product marketing manager',
  'product manager, marketing',
  'product marketing lead',
  'product marketing',
  'marketing product manager',
  'designer',
  'leader',
];
const JOBRIGHT_TITLE_REGEX_EXCLUSION_FALLBACKS = [
  '\\b(?:vp|vice president)\\b',
  '\\b(?:director|senior director|sr\\.? director)\\b',
  '\\bhead of\\b',
  '\\bprincipal\\b',
  '\\b(?:senior|sr\\.?)\\b',
  '\\bstaff\\b',
  '\\bgroup\\s+product\\s+manager\\b',
  '\\blead\\b',
  '\\b(?:[5-9]|\\d{2,})\\+?\\s*years?\\s+exp\\b',
];

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
function shutdown(reason) {
  if (!alive) return;
  alive = false;
  clearTimeout(debounceTimer);
  clearTimeout(pendingChatPromptTimer);
  clearTimeout(autoQueueTimer);
  clearTimeout(appliedTransitionTimer);
  managedIntervalIds.forEach(clearInterval);
  observer.disconnect();
  console.log(`[JobRight Auto-Skip] stopped (${reason})`);
}

function isInvalidated(err) {
  const message = String(err?.message || err || '');
  return message.includes('Extension context invalidated') ||
    message.includes('Cannot access a chrome');
}

function safeChrome(fn) {
  try { fn(); } catch (err) {
    if (isInvalidated(err)) shutdown('chrome API error');
  }
}

function getExtensionResourceUrl(file) {
  if (!alive) return '';
  try {
    return chrome.runtime.getURL(file);
  } catch (err) {
    if (isInvalidated(err)) shutdown('extension resource lookup');
    return '';
  }
}

// ─── COMPANY NAME EXTRACTION ──────────────────────────────────────────────────
// Reads the active job card's company name from the DOM.
// JobRight renders it as the first ant-typography span inside the card header area.
function getActiveCardCompanyName() {
  try {
    const activeCards = [...document.querySelectorAll('section, article, div')]
      .filter(el => {
        if (!isVisibleElement(el)) return false;
        const r = el.getBoundingClientRect();
        const text = normalizeText(el.textContent);
        return r.left < window.innerWidth * 0.55 &&
          r.height > 80 &&
          r.height < 700 &&
          text.includes('job application started') &&
          text.includes('autofill');
      })
      .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);

    for (const card of activeCards) {
      const lines = (card.innerText || card.textContent || '')
        .split(/\n+/)
        .map(t => t.trim())
        .filter(Boolean);
      const fromLine = lines.find(line => /[·•]/.test(line))?.split(/[·•]/)[0]?.trim();
      if (fromLine && fromLine.length > 1 && fromLine.length < 80) return fromLine;
    }

    // The job card in the left panel — find all ant-typography spans,
    // pick the one that looks like a company name (short, no newlines, near top of card)
    const spans = document.querySelectorAll(CONFIG.COMPANY_SELECTOR);
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      // Company names are typically short (< 60 chars), no bullet points,
      // and the span has the css-var classes shown in the inspect element screenshot
      if (text.length > 1 && text.length < 60 && !text.includes('\n') && !text.includes('•')) {
        // Must be inside a job card container (has index_simple-job-card in ancestor)
        let ancestor = span.parentElement;
        let depth = 0;
        while (ancestor && depth < 10) {
          if ((ancestor.className || '').includes('index_simple-job-card')) {
            return text;
          }
          ancestor = ancestor.parentElement;
          depth++;
        }
      }
    }
  } catch (_) {}
  return null;
}

function getActiveJobContext() {
  const company = getActiveCardCompanyName() || '';
  const startedCards = [...document.querySelectorAll('section, article, div')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const r = el.getBoundingClientRect();
      const text = normalizeText(el.textContent);
      return r.left < window.innerWidth * 0.55 &&
        r.height > 80 &&
        text.includes('job application started') &&
        text.includes('autofill');
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const cardText = startedCards[0]?.innerText || startedCards[0]?.textContent || '';
  const lines = cardText.split(/\n+/).map(t => t.trim()).filter(Boolean);
  const companyFromLine = lines.find(line => /[·•]/.test(line))?.split(/[·•]/)[0]?.trim() || '';
  const title = lines.find(line =>
    /product|manager|owner|lead|director|analyst|engineer/i.test(line) &&
    !/job application started|autofill|skip|generate|confirm|analyze|fill out|submit/i.test(line)
  ) || '';

  const hints = [company, companyFromLine, title].filter(Boolean);
  return { company: company || companyFromLine, title, hints };
}

function getActiveApplicationCard() {
  const headings = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    if (normalizeText(textNode.nodeValue) !== 'job application started') continue;
    const heading = textNode.parentElement;
    if (heading && hasRenderedBox(heading)) headings.push(heading);
  }
  headings
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  for (const heading of headings) {
    let node = heading.parentElement;
    for (let depth = 0; depth < 10 && node; depth++, node = node.parentElement) {
      const r = node.getBoundingClientRect();
      const text = normalizeText(node.innerText || node.textContent || '');
      if (r.left >= window.innerWidth * 0.62 || r.width < 250) continue;
      if (text.length > 2_500 || r.height > window.innerHeight * 0.9) break;
      if (/job application started/.test(text) &&
          /(?:autofill|fill out application form|analyze application site)/.test(text) &&
          findSkipControlInContainer(node)) {
        return node;
      }
    }
  }
  return null;
}

function getActiveApplicationSnapshot() {
  const card = getActiveApplicationCard();
  if (!card) return null;

  const context = getActiveJobContext();
  const cardText = normalizeText(card.innerText || card.textContent || '');
  const lines = (card.innerText || card.textContent || '')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const companyLineIndex = lines.findIndex(line => /[·•]/.test(line));
  const companyLineText = companyLineIndex >= 0 ? lines[companyLineIndex] : '';
  const companyLine = companyLineIndex >= 0
    ? (
        companyLineText.replace(/\b\d+\s+(?:minutes?|hours?|days?)\s+ago\b/gi, '').replace(/[·•]/g, '').trim() ||
        lines[companyLineIndex - 1] ||
        ''
      )
    : '';
  const titleLine = companyLineIndex >= 0
    ? lines.slice(companyLineIndex + 1).find(line =>
        !/^(?:\d+\s+(?:minutes?|hours?|days?)\s+ago|autofill|skip|generate custom resume|confirm custom resume|analyze application site|fill out application form|submit application)$/i.test(line)
      ) || ''
    : '';
  const signature = normalizeText(
    `${companyLine || context.company || ''}|${titleLine || context.title || ''}`,
  );
  const requiredCount = cardText.match(/\b\d+\s*\/\s*\d+\s+required fields filled\b/)?.[0] || '';
  const stage = [
    'generate custom resume',
    'confirm custom resume',
    'analyze application site',
    'fill out application form',
    'submit application',
  ].filter(label => cardText.includes(label)).join('|');
  const state = [
    /\baction required\b/.test(cardText) ? 'action-required' : '',
    /\bform complete\b/.test(cardText) ? 'form-complete' : '',
    /\bapplication submitted\b/.test(cardText) ? 'submitted' : '',
  ].filter(Boolean).join('|');
  const progressSignature = `${stage}|${requiredCount}|${state}`;
  const timeoutEligible = cardText.includes('fill out application form') && (
    !!requiredCount ||
    /\bplease fill in (?:these )?\d+ missing fields?\b/.test(cardText) ||
    /\bform complete\b/.test(cardText) ||
    /\bsubmit now\b/.test(cardText) ||
    /\bi['\u2019]ve applied\b/.test(cardText)
  );
  const snapshotContext = {
    company: companyLine || context.company || '',
    title: titleLine || context.title || '',
    hints: [
      companyLine || context.company || '',
      titleLine || context.title || '',
    ].filter(Boolean),
  };

  return {
    card,
    signature,
    progressSignature,
    timeoutEligible,
    context: snapshotContext,
  };
}

function publishActiveJobContext(force = false) {
  const ctx = getActiveJobContext();
  if (!ctx.company && !ctx.hints?.length) return;
  const signature = JSON.stringify(ctx);
  const now = Date.now();
  if (!force && signature === lastPublishedJobContextSignature && now - lastPublishedJobContextAt < 15_000) return;
  lastPublishedJobContextSignature = signature;
  lastPublishedJobContextAt = now;
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'JOBRIGHT_ACTIVE_JOB_CONTEXT', ...ctx }).catch(() => {}),
  );
}

function captureCancelledApplicationCompanies() {
  const candidates = [...document.querySelectorAll('div, section, article, p, span')]
    .map(el => ({
      el,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(({ el, text }) =>
      text.length >= 20 &&
      text.length <= 320 &&
      /application has been cancel(?:led|ed)\s+for\b/i.test(text) &&
      ![...el.children].some(child =>
        /application has been cancel(?:led|ed)\s+for\b/i.test(
          (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    );

  for (const { text } of candidates) {
    const match = text.match(/application has been cancel(?:led|ed)\s+for\s+(.{2,180}?)\s*@\s*(.{2,100})$/i);
    if (!match) continue;
    const title = String(match[1] || '').trim();
    const company = String(match[2] || '')
      .replace(/\s+(?:job application|application|autofill|skip|generate custom resume|confirm custom resume).*$/i, '')
      .trim();
    const signature = normalizeText(`${title}@${company}`);
    if (!isValidBlocklistCompany(company) || processedCancellationSignatures.has(signature)) continue;
    const companyKey = canonicalCompany(company);
    const suppressedUntil = getBlocklistSuppressionUntil(company);
    if (suppressedUntil > Date.now() || timeoutCancellationLearningSuppressedUntil > Date.now()) {
      processedCancellationSignatures.add(signature);
      console.log(`[JobRight Auto-Skip] ignored timeout cancellation for blocklist: ${company}`);
      continue;
    }
    if (suppressedUntil) timeoutSkippedCompanies.delete(companyKey);
    processedCancellationSignatures.add(signature);
    addToBlocklist(company);
    console.log(`[JobRight Auto-Skip] learned cancelled application company: ${company}`);
  }
}

// Also extract company from the bubble/confirm area itself (more reliable when bubble is open)
function getCompanyFromBubbleContext(bubbleEl) {
  try {
    let ancestor = bubbleEl.parentElement;
    for (let depth = 0; depth < 20 && ancestor; depth++) {
      const spans = ancestor.querySelectorAll(CONFIG.COMPANY_SELECTOR);
      for (const span of spans) {
        // Skip if it's inside the bubble itself
        if (bubbleEl.contains(span)) continue;
        const text = (span.textContent || '').trim();
        if (text.length > 1 && text.length < 60 && !text.includes('\n') && !text.includes('•')) {
          return text;
        }
      }
      ancestor = ancestor.parentElement;
    }
  } catch (_) {}
  return null;
}

function normalizeCompany(name) {
  return (name || '').toLowerCase().trim();
}

function canonicalCompany(name) {
  return normalizeCompany(name)
    .replace(/&/g, ' and ')
    .replace(/\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidBlocklistCompany(name) {
  const norm = normalizeCompany(name);
  return norm.length >= 2 &&
    /[a-z0-9]/i.test(norm) &&
    !INVALID_BLOCKLIST_COMPANIES.has(norm);
}

function normalizeBlocklist(list) {
  return [...new Set((list || [])
    .map(normalizeCompany)
    .filter(company =>
      isValidBlocklistCompany(company) &&
      !BLOCKLIST_COMPANY_MIGRATION_REMOVALS.has(company),
    ))].sort();
}

function persistBlocklist() {
  blocklist = normalizeBlocklist(blocklist);
  safeChrome(() => chrome.storage.sync.set({ blocklist }));
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'BLOCKLIST_UPDATED', blocklist }).catch(() => {}),
  );
}

function mergeSharedBlocklist(list) {
  const merged = normalizeBlocklist([...blocklist, ...(list || [])]);
  if (merged.length === blocklist.length && merged.every((v, i) => v === blocklist[i])) return;
  blocklist = merged;
  persistBlocklist();
}

function syncSharedBlocklist() {
  const now = Date.now();
  if (now - lastSharedBlocklistSyncAt < 10_000) return;
  lastSharedBlocklistSyncAt = now;
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'SHARED_BLOCKLIST_GET' }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) return;
      const remote = normalizeBlocklist(res.blocklist);
      const merged = normalizeBlocklist([...blocklist, ...remote]);
      mergeSharedBlocklist(remote);
      if (merged.length !== remote.length || merged.some((v, i) => v !== remote[i])) {
        chrome.runtime.sendMessage({ type: 'SHARED_BLOCKLIST_REPLACE', blocklist: merged }).catch(() => {});
      }
    }),
  );
}

function isBlocklisted(companyName) {
  if (!blocklistEnabled || !companyName) return false;
  const norm = normalizeCompany(companyName);
  const canonical = canonicalCompany(companyName);
  return blocklist.some(entry =>
    entry === norm ||
    (canonical.length >= 4 && canonicalCompany(entry) === canonical),
  );
}

function getBlocklistSuppressionUntil(companyName) {
  const canonical = canonicalCompany(companyName);
  if (!canonical) return 0;
  const direct = timeoutSkippedCompanies.get(canonical) || 0;
  if (direct) return direct;

  for (const [suppressedCompany, suppressedUntil] of timeoutSkippedCompanies) {
    if (
      suppressedUntil > Date.now() &&
      canonical.length >= 5 &&
      suppressedCompany.length >= 5 &&
      (canonical.startsWith(suppressedCompany) || suppressedCompany.startsWith(canonical))
    ) {
      return suppressedUntil;
    }
  }

  return 0;
}

function addToBlocklist(companyName) {
  if (!isValidBlocklistCompany(companyName)) return;
  const norm = normalizeCompany(companyName);
  if (blocklist.includes(norm)) return;
  blocklist.push(norm);
  persistBlocklist();
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'SHARED_BLOCKLIST_ADD', company: norm }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) return;
      mergeSharedBlocklist(res.blocklist);
    }),
  );
  console.log(`[JobRight Auto-Skip] blocklisted: "${companyName}"`);
}

function setNativeValue(el, value) {
  if (el.isContentEditable) {
    el.textContent = value;
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  try { setter?.call(el, value); } catch { try { el.value = value; } catch {} }
}

function clickLikeUser(el) {
  if (!el) return false;
  try {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  } catch (_) {}
  const r = el.getBoundingClientRect();
  const x = Math.max(1, Math.floor(r.left + Math.min(r.width - 1, r.width / 2)));
  const y = Math.max(1, Math.floor(r.top + Math.min(r.height - 1, r.height / 2)));
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  } catch {
    try { el.click(); return true; } catch { return false; }
  }
}

function readChatInputValue(el) {
  if (!el) return '';
  return el.isContentEditable ? (el.textContent || '') : (el.value || el.textContent || '');
}

function placeOtpInJobrightChat(otp) {
  const promptText = 'Tell me what jobs';
  const candidates = [
    ...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'),
  ];
  const target = candidates.find(el =>
    (el.getAttribute('placeholder') || '').includes(promptText) ||
    (el.getAttribute('aria-label') || '').includes(promptText) ||
    (el.textContent || '').includes(promptText)
  ) || candidates.find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 250 && r.height > 20 && r.bottom > window.innerHeight * 0.65;
  });

  if (!target) return false;
  const value = `OTP: ${otp}`;
  target.focus();
  setNativeValue(target, value);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`[JobRight Auto-Skip] OTP placed in JobRight chat: ${otp}`);
  return true;
}

function findJobrightChatInput() {
  const promptText = 'Tell me what jobs';
  const candidates = [
    ...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'),
  ].filter(el => {
    const r = el.getBoundingClientRect();
    const text = normalizeText(`${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
      return r.width > 100 && r.height > 10 &&
        r.bottom > window.innerHeight * 0.45 &&
        r.left < window.innerWidth * 0.58 &&
      !/^filters\b/.test(text) &&
      !el.closest?.('[role="dialog"], [class*="drawer"], [class*="modal"]');
  });

  return candidates.find(el =>
    (el.getAttribute('placeholder') || '').includes(promptText) ||
    (el.getAttribute('aria-label') || '').includes(promptText) ||
    (el.textContent || '').includes(promptText)
  ) || candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
}

function findJobrightChatComposerShell() {
  const promptText = 'tell me what jobs';
  return [...document.querySelectorAll('form, section, div')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const r = el.getBoundingClientRect();
      const text = normalizeText(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
      return r.width > 300 &&
        r.height > 45 &&
        r.left < window.innerWidth * 0.58 &&
        r.bottom > window.innerHeight * 0.58 &&
        text.includes(promptText) &&
        !el.closest?.('[role="dialog"], [class*="drawer"], [class*="modal"]');
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.height - br.height || br.bottom - ar.bottom;
    })[0] || null;
}

function wakeJobrightChatComposer() {
  const input = findJobrightChatInput();
  if (input) {
    clickLikeUser(input);
    input.focus();
    return true;
  }
  const shell = findJobrightChatComposerShell();
  if (shell) {
    const r = shell.getBoundingClientRect();
    const x = Math.floor(r.left + r.width * 0.5);
    const y = Math.floor(r.top + r.height * 0.45);
    const target = document.elementFromPoint(x, y) || shell;
    if (normalizeText(target.textContent || target.getAttribute?.('aria-label') || '').startsWith('filters')) {
      return false;
    }
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      target.focus?.();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function dispatchChatInputEvents(el, value) {
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function writeJobrightChatInput(input, value) {
  input.focus();
  clickLikeUser(input);

  if (input.isContentEditable) {
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } catch {
      setNativeValue(input, value);
    }
  } else {
    setNativeValue(input, '');
    dispatchChatInputEvents(input, '');
    setNativeValue(input, value);
  }

  if (readChatInputValue(input).trim() !== value.trim()) {
    setNativeValue(input, value);
  }
  dispatchChatInputEvents(input, value);
  return readChatInputValue(input).trim() === value.trim();
}

function submitJobrightChat(input) {
  clickLikeUser(input);
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }));
  input.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }));

  setTimeout(() => {
    const buttons = [...document.querySelectorAll('button')].filter(btn => {
      const r = btn.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const text = normalizeText(`${btn.getAttribute('aria-label') || ''} ${btn.title || ''} ${btn.textContent || ''}`);
      return !btn.disabled && r.width > 0 && r.height > 0 &&
        r.left < window.innerWidth * 0.58 &&
        Math.abs((r.top + r.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2) < Math.max(90, inputRect.height * 2) &&
        r.left > inputRect.left - 20 &&
        r.right < inputRect.right + 80 &&
        !/^filters\b/.test(text) &&
        !btn.closest?.('[role="dialog"], [class*="drawer"], [class*="modal"]');
    });
    const sendButton = buttons.find(btn =>
      /send|submit/i.test(btn.getAttribute('aria-label') || btn.title || btn.textContent || '')
    ) || buttons.find(btn => !normalizeText(btn.textContent || '') && btn.querySelector('svg'));
    if (sendButton) clickLikeUser(sendButton);
  }, 150);
}

function getJobrightPageText() {
  return (document.body?.innerText || document.body?.textContent || '').toLowerCase();
}

function normalizeText(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isVisibleElement(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

function hasRenderedBox(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 0 &&
    r.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden';
}

function playStuckJobWarningSound() {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return false;
    const ctx = new AudioContextCtor();
    const start = ctx.currentTime + 0.02;
    [0, 0.22, 0.44].forEach((offset) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
    return true;
  } catch (err) {
    console.warn('[JobRight Auto-Skip] stuck-job warning sound failed', err);
    return false;
  }
}

function isInsideUserChatBubble(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor || '';
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) continue;
    const [, rRaw, gRaw, bRaw] = match;
    const r = Number(rRaw);
    const g = Number(gRaw);
    const b = Number(bRaw);
    if (g > 200 && b > 160 && r < 210) return true;
  }
  return false;
}

function getVisibleLeftChatMessageCandidates() {
  const input = findJobrightChatInput();
  const inputRect = input?.getBoundingClientRect();
  const inputTop = inputRect?.top || window.innerHeight;
  const leftPaneRight = inputRect?.right || window.innerWidth * 0.5;
  return [...document.querySelectorAll('div, p, span')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      if (isInsideUserChatBubble(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.bottom >= inputTop) return false;
      if (r.left > leftPaneRight + 40 || r.right > leftPaneRight + 80) return false;
      const text = normalizeText(el.textContent);
      return text.length >= 20 && text.length <= 220 &&
        !/^(filters|view all|show me more matches|i want to adjust job matches|product manager jobs)$/i.test(text) &&
        !/\b(job application started|job application cancelled|application has been cancelled|application submitted for|autofill|generate custom resume|confirm custom resume|fill out application form)\b/i.test(text);
    })
    .map(el => ({ text: normalizeText(el.textContent), rect: el.getBoundingClientRect() }))
    .sort((a, b) => b.rect.bottom - a.rect.bottom || b.rect.right - a.rect.right);
}

function getLastVisibleChatMessageText() {
  const candidates = getVisibleLeftChatMessageCandidates();
  return candidates[0]?.text || '';
}

function hasCompletedMoreJobsQuestionAsLatestChatMessage() {
  const text = getLastVisibleChatMessageText();
  return text === MORE_JOBS_QUESTION ||
    (
      /(?:all|your)\s+jobs?\s+applications?\s+(?:have\s+been|are)\s+completed/.test(text) &&
      /(?:pull|find|show|get)\s+(?:you\s+)?more\s+jobs?/.test(text)
    ) ||
    /do you want me to\s+(?:pull|find|show|get)\s+(?:you\s+)?more\s+jobs?/.test(text);
}

function hasRecentMoreJobsPullActivity() {
  const text = getVisibleLeftChatMessageCandidates()
    .slice(0, 5)
    .map(candidate => candidate.text)
    .join(' ');
  return /pulling up more matches|matching your skills and preferences|scanning fresh openings|searching for fresh openings|finding more matches|loading more matches/.test(text);
}

function isJobrightSystemPrompt(prompt) {
  return /jobright system prompt|follow every rule below|standing instructions/i.test(prompt || '');
}

function isMoreJobsSearchPrompt(prompt) {
  return !!prompt && !isJobrightSystemPrompt(prompt);
}

function sendJobrightSystemPrompt(prompt, attempt = 0) {
  if (isMoreJobsSearchPrompt(prompt) &&
      (getJobrightQueueCount() !== 0 || !hasCompletedMoreJobsQuestionAsLatestChatMessage())) {
    moreJobsPromptInFlight = false;
    clearTimeout(pendingChatPromptTimer);
    console.log('[JobRight Auto-Skip] cancelled stale more-jobs prompt');
    return false;
  }

  const input = findJobrightChatInput();
  if (!prompt) return false;
  if (!input) {
    wakeJobrightChatComposer();
    if (attempt < 30) {
      clearTimeout(pendingChatPromptTimer);
      pendingChatPromptTimer = setTimeout(() => sendJobrightSystemPrompt(prompt, attempt + 1), 300);
      return true;
    }
    return false;
  }

  clearTimeout(pendingChatPromptTimer);
  if (!writeJobrightChatInput(input, prompt)) {
    wakeJobrightChatComposer();
    if (attempt < 30) {
      pendingChatPromptTimer = setTimeout(() => sendJobrightSystemPrompt(prompt, attempt + 1), 300);
      return true;
    }
    return false;
  }
  submitJobrightChat(input);
  console.log(isJobrightSystemPrompt(prompt)
    ? '[JobRight Auto-Skip] system prompt keepalive sent'
    : '[JobRight Auto-Skip] more-jobs prompt sent');
  return true;
}

function requestSystemPromptCycleAtQueueLimit(queueCount) {
  // No-op: keepalive is now purely submission-count-based (every 10 submissions).
  void queueCount;
}

function isSubmissionStatusText(text) {
  if (/\b(couldn['’]?t|could not|failed|failure|unsuccessful|not submitted|limit reached|application limit)\b/i.test(text)) {
    return false;
  }
  return /\bapplication\s+(?:was\s+|has\s+been\s+)?(?:successfully\s+)?submitted(?:\s+successfully)?(?:\s+for\b|[.!:]|$)/i.test(text) ||
    /\bsuccessfully\s+submitted\s+(?:your|the)\s+application\b/i.test(text);
}

function getSubmissionStatusCounts() {
  const candidates = [...document.querySelectorAll('div, p, span, li')]
    .map(el => ({ el, text: normalizeText(el.textContent) }))
    .filter(({ el, text }) =>
      isVisibleElement(el) &&
      text.length >= 15 &&
      text.length <= 300 &&
      isSubmissionStatusText(text)
    );

  const leafCandidates = candidates.filter(({ el, text }) =>
    !candidates.some(candidate =>
      candidate.el !== el &&
      el.contains(candidate.el) &&
      candidate.text === text
    )
  );

  const counts = new Map();
  for (const { text } of leafCandidates) {
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  return counts;
}

function persistSubmissionCounter() {
  const seenEntries = [...submissionSeenCounts.entries()]
    .slice(-MAX_STORED_SUBMISSION_SIGNATURES);
  submissionSeenCounts = new Map(seenEntries);
  safeChrome(() => chrome.storage.local.set({
    [SUBMISSION_COUNT_STORAGE_KEY]: submissionCountSincePrompt,
    [SUBMISSION_SEEN_STORAGE_KEY]: Object.fromEntries(seenEntries),
  }));
}

function requestSubmissionKeepalive() {
  persistSubmissionCounter();
  safeChrome(() => chrome.runtime.sendMessage({
    type: 'RUN_JOBRIGHT_SYSTEM_PROMPT_NOW',
  }).catch(() => {}));
  console.log(`[JobRight Auto-Skip] system prompt keepalive fired after ${SYSTEM_PROMPT_SUBMISSION_INTERVAL} submissions`);
}

function recordConfirmedSuccessfulSubmissions(count = 1, source = 'JobRight status') {
  const added = Math.max(0, Number(count) || 0);
  if (!added) return;

  submissionCountSincePrompt += added;
  console.log(
    `[JobRight Auto-Skip] confirmed submission count: ${submissionCountSincePrompt}/${SYSTEM_PROMPT_SUBMISSION_INTERVAL} (${source})`,
  );

  while (submissionCountSincePrompt >= SYSTEM_PROMPT_SUBMISSION_INTERVAL) {
    submissionCountSincePrompt -= SYSTEM_PROMPT_SUBMISSION_INTERVAL;
    requestSubmissionKeepalive();
  }
  persistSubmissionCounter();
}

function countNewSubmissionStatuses() {
  if (!submissionCounterReady) return;

  const currentCounts = getSubmissionStatusCounts();
  let added = 0;
  for (const [text, count] of currentCounts) {
    const previousCount = submissionSeenCounts.get(text) || 0;
    if (count > previousCount) added += count - previousCount;
    submissionSeenCounts.set(text, Math.max(previousCount, count));
  }
  if (!added) return;
  recordConfirmedSuccessfulSubmissions(added);
}

function isIveAppliedLabel(text = '') {
  return /^(?:i['\u2019]ve|i have|i) applied[.!]?$/i.test(
    String(text).trim().replace(/\s+/g, ' '),
  );
}

function findIveAppliedButton(forceClick = false) {
  return [...document.querySelectorAll('button, [role="button"]')]
    .filter(btn => {
      const r = btn.getBoundingClientRect();
      const labels = [
        btn.textContent || '',
        btn.getAttribute('aria-label') || '',
        btn.getAttribute('title') || '',
      ];
      return r.width > 0 && r.height > 0 &&
        (forceClick || !btn.disabled) &&
        labels.some(isIveAppliedLabel);
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
}

function triggerIveApplied(forceClick = false) {
  if (!autoAppliedEnabled) return false;
  const btn = findIveAppliedButton(forceClick);
  if (!btn) return false;
  // ATS already submitted — remove disabled attr so JobRight processes the click
  if (btn.disabled) {
    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-disabled');
  }
  btn.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  btn.click();
  console.log('[JobRight Auto-Skip] clicked I’ve Applied after ATS submission');
  return true;
}

function ensureIveAppliedTransition(confirmedSuccess = false) {
  const initial = getActiveApplicationSnapshot();
  const signature = initial?.signature || '';
  if (appliedTransitionTimer && signature && appliedTransitionSignature === signature) return true;

  clearTimeout(appliedTransitionTimer);
  appliedTransitionSignature = signature;
  let attempts = 0;

  const attempt = () => {
    const current = getActiveApplicationSnapshot();
    if (!current || (signature && current.signature !== signature)) {
      clearTimeout(appliedTransitionTimer);
      appliedTransitionTimer = null;
      appliedTransitionSignature = '';
      return;
    }

    attempts++;
    triggerIveApplied(true);
    if (attempts < 20) {
      appliedTransitionTimer = setTimeout(attempt, 750);
      return;
    }

    appliedTransitionTimer = null;
    appliedTransitionSignature = '';
    if (confirmedSuccess) {
      const visibleApplyCandidates = [...document.querySelectorAll('button, [role="button"]')]
        .filter(btn => {
          const r = btn.getBoundingClientRect();
          const text = normalizeText(`${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`);
          return r.width > 0 && r.height > 0 && /\bappl(?:y|ied|ication)\b/.test(text);
        })
        .map(btn => normalizeText(`${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`))
        .slice(0, 12);
      console.log('[JobRight Auto-Skip] ATS submitted; no I’ve Applied control appeared after 15 seconds. Card left unskipped.', {
        activeJob: getActiveJobContext(),
        visibleApplyCandidates,
      });
    }
  };

  attempt();
  return true;
}

function findActiveApplicationCardSkip() {
  const card = getActiveApplicationCard();
  return card ? findSkipControlInContainer(card) : null;
}

function skipActiveApplication(
  reason,
  { afterScreenshot = false, suppressBlocklistLearning = false } = {},
) {
  if (/ATS (?:confirmed )?success/i.test(reason)) {
    console.warn(`[JobRight Auto-Skip] blocked Skip for confirmed ATS success (${reason})`);
    return false;
  }

  const snapshot = getActiveApplicationSnapshot();
  if (!afterScreenshot &&
      snapshot?.signature &&
      pendingStuckScreenshotSignature === snapshot.signature) {
    console.log(`[JobRight Auto-Skip] blocked Skip while screenshot is pending (${reason})`);
    return false;
  }
  if (snapshot?.signature && snapshot.signature === leverProtectedJobSignature) {
    console.log(`[JobRight Auto-Skip] blocked Skip for active Lever application (${reason})`);
    return false;
  }
  const skip = snapshot?.card ? findSkipControlInContainer(snapshot.card) : null;
  if (!skip) return false;
  if (suppressBlocklistLearning && snapshot?.context?.company) {
    timeoutCancellationLearningSuppressedUntil = Math.max(
      timeoutCancellationLearningSuppressedUntil,
      Date.now() + TIMEOUT_GLOBAL_BLOCKLIST_SUPPRESSION_MS,
    );
    timeoutSkippedCompanies.set(
      canonicalCompany(snapshot.context.company),
      Date.now() + TIMEOUT_BLOCKLIST_SUPPRESSION_MS,
    );
    processedCancellationSignatures.add(normalizeText(
      `${snapshot.context.title || ''}@${snapshot.context.company}`,
    ));
  }
  clickLikeUser(skip);
  stuckJobSkipSignature = snapshot.signature;
  console.log(`[JobRight Auto-Skip] skipped active application (${reason})`);
  return true;
}

function requestStuckJobScreenshot(snapshot, skipAfterCapture = true) {
  if (!snapshot?.signature ||
      pendingStuckScreenshotSignature === snapshot.signature ||
      Date.now() - lastStuckScreenshotAttemptAt < STUCK_SCREENSHOT_RETRY_MS) {
    return;
  }

  pendingStuckScreenshotSignature = snapshot.signature;
  lastStuckScreenshotAttemptAt = Date.now();
  try {
    snapshot.card.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  } catch (_) {}

  // Give Brave two paints after scrolling so captureVisibleTab records the
  // active application card, not the previous scroll position.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    setTimeout(() => safeChrome(() => {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STUCK_JOB_SCREENSHOT',
        context: snapshot.context || {},
      }, response => {
        pendingStuckScreenshotSignature = '';
        if (chrome.runtime.lastError || !response?.saved) {
          console.warn(
            '[JobRight Auto-Skip] stuck-job screenshot failed; automatic skip will retry',
            chrome.runtime.lastError?.message || response?.error || '',
          );
          return;
        }

        const current = getActiveApplicationSnapshot();
        if (!current || current.signature !== snapshot.signature ||
            current.progressSignature !== snapshot.progressSignature) {
          return;
        }

        stuckJobScreenshotSignature = snapshot.signature;
        console.log(`[JobRight Auto-Skip] saved stuck-job screenshot to ${response.location}`);
        if (!skipAfterCapture) {
          console.log('[JobRight Auto-Skip] Lever application remains protected from timeout skip');
          return;
        }
        if (skipActiveApplication(
          'no progress for 100 seconds after screenshot',
          { afterScreenshot: true, suppressBlocklistLearning: true },
        )) {
          stuckJobSkipSignature = snapshot.signature;
        }
      });
    }), 250);
  }));
}

function handleTerminalApplicationState(forceIveApplied = false) {
  if (!autoAppliedEnabled) return false;
  const signature = getActiveApplicationSnapshot()?.signature || '';
  if (signature && signature === leverProtectedJobSignature) {
    leverConfirmedSuccessSignature = signature;
    leverProtectedJobSignature = '';
  }
  if (findIveAppliedButton(forceIveApplied)) return ensureIveAppliedTransition(true);
  return skipActiveApplication('terminal application state');
}

function handleAtsTerminalApplicationState(confirmedSuccess = false) {
  if (!autoAppliedEnabled) return false;
  if (confirmedSuccess) {
    leverConfirmedSuccessSignature = getActiveApplicationSnapshot()?.signature || '';
    leverProtectedJobSignature = '';
    return ensureIveAppliedTransition(true);
  }
  if (findIveAppliedButton(true)) return ensureIveAppliedTransition(false);

  return skipActiveApplication('ATS terminal state');
}

function handleAtsTerminalFailureState() {
  if (!autoAppliedEnabled) return false;
  if (Date.now() < atsValidationHoldUntil) {
    console.log('[JobRight Auto-Skip] kept active application open for ATS field correction');
    return true;
  }
  const snapshot = getActiveApplicationSnapshot();
  const signature = snapshot?.signature || '';
  if (signature && signature !== atsFailureGraceSignature) {
    atsFailureGraceSignature = signature;
    atsFailureGraceStartedAt = Date.now();
    console.log('[JobRight Auto-Skip] waiting briefly for ATS validation repair before cancellation');
    return true;
  }
  if (signature && Date.now() - atsFailureGraceStartedAt < 2_500) return true;
  if (snapshot?.signature && snapshot.signature === leverProtectedJobSignature) {
    console.log('[JobRight Auto-Skip] ignored Lever failure until confirmed submission');
    return true;
  }
  return skipActiveApplication('ATS submission failure or application limit');
}

function watchForStuckApplication() {
  if (!enabled || !isJobrightApplicationRunActive()) {
    stuckJobSignature = '';
    stuckJobProgressSignature = '';
    stuckJobLastProgressAt = 0;
    stuckJobSkipSignature = '';
    stuckJobScreenshotSignature = '';
    stuckJobWarningSignature = '';
    pendingStuckScreenshotSignature = '';
    return;
  }

  const snapshot = getActiveApplicationSnapshot();
  if (!snapshot?.signature) {
    stuckJobSignature = '';
    stuckJobProgressSignature = '';
    stuckJobLastProgressAt = 0;
    stuckJobSkipSignature = '';
    stuckJobScreenshotSignature = '';
    stuckJobWarningSignature = '';
    pendingStuckScreenshotSignature = '';
    return;
  }

  // Resume generation and application-site analysis can legitimately take
  // longer than 100 seconds. Arm the timeout only after JobRight has reached
  // the form/action stage and has reported form progress or controls.
  if (!snapshot.timeoutEligible) {
    stuckJobSignature = snapshot.signature;
    stuckJobProgressSignature = snapshot.progressSignature;
    stuckJobLastProgressAt = 0;
    stuckJobSkipSignature = '';
    stuckJobScreenshotSignature = '';
    stuckJobWarningSignature = '';
    pendingStuckScreenshotSignature = '';
    return;
  }

  if (leverProtectedJobSignature &&
      snapshot.signature !== leverProtectedJobSignature) {
    leverProtectedJobSignature = '';
  }
  if (leverConfirmedSuccessSignature &&
      snapshot.signature !== leverConfirmedSuccessSignature) {
    leverConfirmedSuccessSignature = '';
  }

  const now = Date.now();
  if (snapshot.signature !== stuckJobSignature || !stuckJobLastProgressAt) {
    stuckJobSignature = snapshot.signature;
    stuckJobProgressSignature = snapshot.progressSignature;
    stuckJobLastProgressAt = now;
    stuckJobSkipSignature = '';
    stuckJobScreenshotSignature = '';
    stuckJobWarningSignature = '';
    pendingStuckScreenshotSignature = '';
    return;
  }

  if (snapshot.progressSignature !== stuckJobProgressSignature) {
    stuckJobProgressSignature = snapshot.progressSignature;
    stuckJobLastProgressAt = now;
    stuckJobSkipSignature = '';
    stuckJobScreenshotSignature = '';
    stuckJobWarningSignature = '';
    pendingStuckScreenshotSignature = '';
    return;
  }

  const elapsedMs = now - stuckJobLastProgressAt;
  if (elapsedMs >= JOB_STUCK_WARNING_MS &&
      stuckJobWarningSignature !== snapshot.signature) {
    stuckJobWarningSignature = snapshot.signature;
    safeChrome(() =>
      chrome.runtime.sendMessage({
        type: 'STUCK_JOB_WARNING',
        context: snapshot.context || {},
        secondsRemaining: Math.max(
          1,
          Math.ceil((JOB_STUCK_TIMEOUT_MS - elapsedMs) / 1000),
        ),
      }).catch(() => {}),
    );
  }

  if (stuckJobSkipSignature === snapshot.signature ||
      elapsedMs < JOB_STUCK_TIMEOUT_MS) {
    return;
  }

  if (stuckJobScreenshotSignature === snapshot.signature &&
      snapshot.signature !== leverProtectedJobSignature &&
      skipActiveApplication(
        'no progress for 100 seconds after screenshot',
        { suppressBlocklistLearning: true },
      )) {
    stuckJobSkipSignature = snapshot.signature;
    return;
  }

  requestStuckJobScreenshot(snapshot, snapshot.signature !== leverProtectedJobSignature);
}

function parseTerminalSuccessPhrases(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => normalizeText(line.replace(/#.*/, '')))
    .filter(Boolean);
}

function rebuildTerminalSuccessPhraseCache() {
  terminalSuccessPhraseCache = [
    ...new Set([
      ...builtInTerminalSuccessPhrases,
      ...customTerminalSuccessPhrases,
    ]),
  ];
}

function normalizeStoredTerminalSuccessPhrases(value) {
  const phrases = Array.isArray(value)
    ? value.map(item => normalizeText(item))
    : parseTerminalSuccessPhrases(value);
  return [...new Set(phrases.filter(Boolean))];
}

function loadCustomTerminalSuccessPhrases() {
  safeChrome(() => {
    chrome.storage.local.get([CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY], stored => {
      customTerminalSuccessPhrases = normalizeStoredTerminalSuccessPhrases(
        stored[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY]
      );
      rebuildTerminalSuccessPhraseCache();
      handleJobrightStatusPrompts();
    });
  });
}

function loadTerminalSuccessPhrases() {
  if (builtInTerminalSuccessPhrases.length || terminalSuccessPhraseLoading) {
    return terminalSuccessPhraseCache;
  }
  terminalSuccessPhraseLoading = true;
  const url = getExtensionResourceUrl(JOBRIGHT_TERMINAL_SUCCESS_PHRASES_FILE);
  if (!url) {
    terminalSuccessPhraseLoading = false;
    return terminalSuccessPhraseCache;
  }
  fetch(url)
    .then(res => res.ok ? res.text() : '')
    .then(text => {
      builtInTerminalSuccessPhrases = parseTerminalSuccessPhrases(text);
      rebuildTerminalSuccessPhraseCache();
    })
    .catch(() => {})
    .finally(() => { terminalSuccessPhraseLoading = false; });
  return terminalSuccessPhraseCache;
}

loadTerminalSuccessPhrases();
loadCustomTerminalSuccessPhrases();

function hasRightPaneApplicationSuccess() {
  const text = (document.body?.innerText || document.body?.textContent || '');
  const rightSideTexts = [...document.querySelectorAll('main, section, article, div, h1, h2, p')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const r = el.getBoundingClientRect();
      return r.left > window.innerWidth * 0.42 && r.width > 180;
    })
    .map(el => el.textContent || '')
    .join('\n') || text;

  const normalizedRightSideText = normalizeText(rightSideTexts);
  if (loadTerminalSuccessPhrases().some(phrase => normalizedRightSideText.includes(phrase))) {
    return true;
  }

  return [
    /\bthank you(?:\s+\w+){0,5}\s+for applying\b/i,
    /\bthank you(?:\s+\w+){0,8}\s+for your interest\b/i,
    /\bthank you(?:\s+\w+){0,8}\s+for your interest\b.{0,240}\b(?:we |we(?:'|’)ve )?received your application\b/is,
    /\byou did it\b/i,
    /\bofficially in review\b/i,
    /\byour application (has been |was )?(received|submitted|sent)\b/i,
    /\bapplication (received|submitted|sent|complete|successful)\b/i,
    /\bwe(?:'|’)ve received your application\b/i,
    /\bwe received your application\b/i,
    /\bone of our .*team .*will reach out\b/i,
    /\bone of our .*team members will reach out\b/i,
    /\bwe'?ll be back in touch soon\b/i,
    /\bwill get back to you soon\b/i,
    /\bthrilled that you are interested in joining us\b/i,
    /\bif there'?s? a fit\b/i,
    /\bwill get in touch if your background is a match\b/i,
    /\bkindly ask applicants to wait\b/i,
    /\balready applied to this position\b/i,
    /\bonly accept one application for the same role\b/i,
    /\bwithin a \d+[- ]day window\b/i,
  ].some(re => re.test(rightSideTexts));
}

function clickButtonByText(pattern) {
  const btn = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && pattern.test((el.textContent || '').trim());
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  if (!btn) return false;
  btn.click();
  return true;
}

function handleJobrightStatusPrompts() {
  const text = getJobrightPageText();
  const now = Date.now();
  const queueCount = getJobrightQueueCount();
  const hasMoreJobsQuestion = hasCompletedMoreJobsQuestionAsLatestChatMessage();

  requestSystemPromptCycleAtQueueLimit(queueCount);

  if (queueCount > 0) {
    moreJobsPromptArmed = true;
    moreJobsPromptInFlight = false;
  } else if (!hasMoreJobsQuestion && hasRecentMoreJobsPullActivity()) {
    moreJobsPromptArmed = false;
    moreJobsPromptInFlight = true;
  }

  if (queueCount === 0 &&
      hasMoreJobsQuestion &&
      !moreJobsPromptInFlight &&
      moreJobsPromptArmed &&
      now - lastMoreJobsPromptAt > MORE_JOBS_PROMPT_RETRY_GUARD_MS) {
    lastMoreJobsPromptAt = now;
    moreJobsPromptInFlight = true;
    moreJobsPromptArmed = false;
    safeChrome(() => chrome.runtime.sendMessage({ type: 'RUN_JOBRIGHT_MORE_JOBS_PROMPT_NOW' }).catch(() => {}));
    console.log('[JobRight Auto-Skip] requested configured more-jobs prompt');
  }

  countNewSubmissionStatuses();

  if (/(try (again|now)|another try|task took too long|click continue to proceed)/.test(text) &&
      now - lastRetryClickAt > 15_000 &&
      clickButtonByText(/^\s*(try again|try now|continue)\s*$/i)) {
    lastRetryClickAt = now;
    console.log('[JobRight Auto-Skip] clicked retry/continue prompt');
  }

  if (/(limit reached|application limit|couldn['’]?t submit your application|we couldn['’]?t submit|have reached your application limit|already applied to this position|only accept one application for the same role|within a \d+[- ]day window)/.test(text) &&
      now - lastTerminalAppliedAt > 15_000) {
    if (handleAtsTerminalFailureState()) lastTerminalAppliedAt = now;
  }

  if (hasRightPaneApplicationSuccess() && now - lastTerminalAppliedAt > 8_000) {
    if (handleTerminalApplicationState()) lastTerminalAppliedAt = now;
  }
}

// ─── FEATURE FLAG: Auto Queue Builder ────────────────────────────────────────
// Off by default. When enabled, scans the right-side recommendations pane,
// adds non-blocklisted Autofill jobs up to JobRight's 40-job queue limit,
// then starts the queue.
function getJobrightHeaderText() {
  return [...document.querySelectorAll('header, [class*="agent-header"], [class*="header"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < 160;
    })
    .map(el => el.innerText || el.textContent || '')
    .join(' ');
}

function isJobrightApplicationRunActive() {
  const topStatusText = [...document.querySelectorAll('div, span, p, button')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const r = el.getBoundingClientRect();
      const text = normalizeText(el.textContent);
      return r.top >= 0 &&
        r.bottom <= 170 &&
        r.left < window.innerWidth * 0.6 &&
        text.length > 0 &&
        text.length < 120;
    })
    .map(el => normalizeText(el.textContent))
    .join(' ');
  const text = normalizeText(`${getJobrightHeaderText()} ${topStatusText}`);
  return /\bexecuting\b|\b\d+\s+jobs?\s+remaining\b|\bfill in missing fields\b|\bconfirm resume to proceed\b/.test(text);
}

function getJobrightQueueCount() {
  const headerText = getJobrightHeaderText();
  let match = /(\d+)\s+jobs?\s+added/i.exec(headerText);
  if (!match) {
    const topStatusText = [...document.querySelectorAll('div, span, p')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 &&
          r.height > 0 &&
          r.height < 100 &&
          r.top >= 0 &&
          r.bottom <= 160;
      })
      .map(el => normalizeText(el.textContent))
      .find(text => /^\d+\s+jobs?\s+added\b/.test(text));
    match = /(\d+)\s+jobs?\s+added/i.exec(topStatusText || '');
  }
  return match ? Number(match[1]) || 0 : 0;
}

function findJobrightStartButton() {
  return [...document.querySelectorAll('button, [role="button"]')]
    .find(btn => {
      const r = btn.getBoundingClientRect();
      const text = normalizeText(btn.textContent);
      return r.width > 0 && r.height > 0 && !btn.disabled &&
        r.top < 140 &&
        /^start$/.test(text);
    }) || null;
}

function extractQueueCardCompany(card) {
  const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
  const beforeDot = text.match(/^(.{2,80}?)\s*[·•]\s*/);
  if (beforeDot) return beforeDot[1].trim();

  const snippets = [...card.querySelectorAll('span, div, strong, b')]
    .map(el => (el.textContent || '').trim())
    .filter(t => t.length > 1 && t.length < 80 && !/autofill|add|applicant|years exp|full-time|remote|onsite|hybrid|level|company|stage|\d+%/i.test(t));
  return snippets[0] || '';
}

function cleanQueueCardTitle(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .replace(/\b\d+\s*(minutes?|hours?|days?)\s+ago\b/gi, ' ')
    .replace(/\b\d+\+?\s*years?\s+exp\b/gi, ' ')
    .replace(/\b\d+\s+applicants?\b/gi, ' ')
    .replace(/\b(be an early applicant|full-time|part-time|contract|internship|remote|onsite|hybrid|senior level|mid level|entry level|lead\/staff|public company|growth stage|late stage|early stage|autofill|\+?\s*add)\b/gi, ' ')
    .replace(/\b\d+%\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQueueCardTitle(card) {
  const lines = (card.innerText || card.textContent || '')
    .split(/\n+/)
    .map(t => t.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\b(minutes?|hours?|days?)\s+ago\b/i.test(line)) {
      const next = cleanQueueCardTitle(lines[i + 1] || '');
      if (next && next.length < 140) return next;
    }
  }

  const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
  const afterAge = text.match(/\b(?:\d+\s+)?(?:minutes?|hours?|days?)\s+ago\s+(.+?)(?:\s+(?:Be an early applicant|\d+\s+applicants?|United States|Full-time|Part-time|Contract|Remote|Onsite|Hybrid|Senior Level|Mid Level|Entry Level|\d+\+?\s+years?\s+exp|\d+%|Autofill|\+\s*Add)\b|$)/i);
  if (afterAge?.[1]) return cleanQueueCardTitle(afterAge[1]).slice(0, 140);

  return cleanQueueCardTitle(lines.find(line =>
    line.length > 8 &&
    line.length < 140 &&
    !/[·•]/.test(line) &&
    !/autofill|add|applicant|years exp|full-time|remote|onsite|hybrid|level|company|stage|\d+%/i.test(line)
  ) || '');
}

function parseTitleExclusions(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/#.*/, '').trim().toLowerCase())
    .filter(Boolean);
}

function parseTitleRegexExclusions(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map(pattern => {
      try { return new RegExp(pattern, 'i'); }
      catch {
        console.warn(`[JobRight Auto-Skip] ignored invalid title exclusion regex: ${pattern}`);
        return null;
      }
    })
    .filter(Boolean);
}

function loadTitleExclusions() {
  if (titleExclusionCache) return titleExclusionCache;
  const fallback = [...JOBRIGHT_TITLE_EXCLUSION_FALLBACKS];
  titleExclusionCache = fallback;
  if (titleExclusionLoading) return titleExclusionCache;
  titleExclusionLoading = true;

  const url = getExtensionResourceUrl(JOBRIGHT_EXCLUDED_TITLES_FILE);
  if (!url) {
    titleExclusionLoading = false;
    return titleExclusionCache;
  }
  fetch(url)
    .then(res => res.ok ? res.text() : '')
    .then(text => {
      const parsed = parseTitleExclusions(text);
      if (parsed.length) titleExclusionCache = parsed;
    })
    .catch(() => {})
    .finally(() => { titleExclusionLoading = false; });

  return titleExclusionCache;
}

function loadTitleRegexExclusions() {
  if (titleRegexExclusionCache) return titleRegexExclusionCache;
  titleRegexExclusionCache = parseTitleRegexExclusions(JOBRIGHT_TITLE_REGEX_EXCLUSION_FALLBACKS.join('\n'));
  if (titleRegexExclusionLoading) return titleRegexExclusionCache;
  titleRegexExclusionLoading = true;

  const url = getExtensionResourceUrl(JOBRIGHT_EXCLUDED_TITLE_REGEXES_FILE);
  if (!url) {
    titleRegexExclusionLoading = false;
    return titleRegexExclusionCache;
  }
  fetch(url)
    .then(res => res.ok ? res.text() : '')
    .then(text => {
      const parsed = parseTitleRegexExclusions(text);
      if (parsed.length) titleRegexExclusionCache = parsed;
    })
    .catch(() => {})
    .finally(() => { titleRegexExclusionLoading = false; });

  return titleRegexExclusionCache;
}

function isExcludedQueueTitle(title) {
  const normalized = normalizeText(title);
  if (!normalized) return false;
  return loadTitleExclusions().some(phrase => normalized.includes(phrase)) ||
    loadTitleRegexExclusions().some(re => re.test(title));
}

function findViewAllJobResultsButton() {
  return [...document.querySelectorAll('button, [role="button"]')]
    .filter(btn => {
      if (!isVisibleElement(btn) || btn.disabled) return false;
      const r = btn.getBoundingClientRect();
      if (r.left > window.innerWidth * 0.58 || r.bottom < 120 || r.top > window.innerHeight - 120) return false;
      if (normalizeText(btn.textContent) !== 'view all') return false;

      let node = btn.parentElement;
      for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
        const nr = node.getBoundingClientRect();
        const text = normalizeText(node.textContent);
        if (nr.left > window.innerWidth * 0.6) break;
        if (/\+\s*\d+\s+more jobs/.test(text) ||
            /\bhere are\s+\d+\b/.test(text) ||
            /\broles? matching your current search\b/.test(text)) {
          return true;
        }
      }

      return false;
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
}

function findTopMatchesRoot() {
  // Look for the "Top Matches" heading — accept it even if scrolled off screen
  // (isVisibleElement would reject it when scrolled up, breaking the queue).
  const headings = [...document.querySelectorAll('h1, h2, h3, div, span')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      // Must be in the right half of the page
      if (r.left < window.innerWidth * 0.48) return false;
      // Must exist in DOM with non-zero width (allow off-screen vertically)
      if (r.width === 0) return false;
      return /^top matches$/i.test(normalizeText(el.textContent));
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const heading = headings[0];
  if (!heading) return null;

  let node = heading.parentElement;
  for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
    const r = node.getBoundingClientRect();
    const text = normalizeText(node.textContent);
    if (r.left > window.innerWidth * 0.38 &&
        r.width > 420 &&
        r.height > 180 &&
        (text.includes('autofill') || text.includes('show me more matches') || text.includes('add all'))) {
      return node;
    }
  }

  return null;
}

function classText(el) {
  return String(el?.className || '');
}

function isQueueCardContainer(el, addButton = null) {
  if (!hasRenderedBox(el)) return false;
  const r = el.getBoundingClientRect();
  if (r.left < window.innerWidth * 0.42 || r.width < 420 || r.height < 80 || r.height > 500) return false;
  if (addButton && !el.contains(addButton)) return false;
  const cls = classText(el);
  const text = normalizeText(el.textContent);
  const pctCount = (text.match(/\d+%/g) || []).length;
  const addCount = (text.match(/\+\s*add/g) || []).length;
  const autofillCount = (text.match(/\bautofill\b/g) || []).length;
  if (pctCount > 1 || addCount > 1 || autofillCount > 1) return false;
  return /job-list-job-card-container|job-card/.test(cls) ||
    (/\b(?:add|autofill)\b/.test(text) && /\b(?:full-time|remote|onsite|hybrid|\d+\+?\s*years?\s+exp|\d+%)\b/.test(text));
}

function getQueueCardAutofillBadge(card) {
  if (!card) return null;
  return [...card.querySelectorAll('[class*="autofill"], img[alt*="autofill" i], span, div')]
    .filter(el => {
      if (!hasRenderedBox(el)) return false;
      const ownText = normalizeText(el.textContent || '');
      const ownHints = normalizeText(`${el.getAttribute?.('alt') || ''} ${el.getAttribute?.('aria-label') || ''} ${classText(el)}`);
      if (!ownHints.includes('autofill') && ownText !== 'autofill') return false;
      const r = el.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      return r.top >= cr.top - 8 &&
        r.bottom <= cr.bottom + 8 &&
        r.right >= cr.right - 160 &&
        r.left <= cr.right + 16;
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
}

function queueCardHasAutofillBadge(card) {
  return !!getQueueCardAutofillBadge(card);
}

function findQueueCardForAddButton(addButton) {
  const buttonRect = addButton.getBoundingClientRect();
  const ancestorCards = [];
  let node = addButton.parentElement;
  for (let depth = 0; depth < 14 && node; depth++, node = node.parentElement) {
    const r = node.getBoundingClientRect();
    if (isQueueCardContainer(node, addButton)) ancestorCards.push(node);
    if (r.left < window.innerWidth * 0.42 || r.width > window.innerWidth * 0.7) break;
  }

  const strictAncestor = ancestorCards
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)
    .find(queueCardHasAutofillBadge);
  if (strictAncestor) return strictAncestor;

  const fallback = [...document.querySelectorAll('div, section, article, li')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (!isQueueCardContainer(el, addButton)) return false;
      if (r.left < window.innerWidth * 0.42) return false;
      if (buttonRect.top < r.top - 8 || buttonRect.bottom > r.bottom + 8) return false;
      if (buttonRect.left < r.left || buttonRect.right > r.right + 20) return false;
      return queueCardHasAutofillBadge(el);
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.height - br.height || br.left - ar.left;
    })[0] || null;

  return fallback && queueCardHasAutofillBadge(fallback) ? fallback : null;
}

function findAutoQueueCandidate() {
  const root = findTopMatchesRoot();
  if (!root) return null;

  const addButtons = [...root.querySelectorAll('button, [role="button"]')]
    .filter(btn => {
      const r = btn.getBoundingClientRect();
      const text = normalizeText(btn.textContent);
      return r.width > 0 && r.height > 0 && !btn.disabled &&
        r.left > window.innerWidth * 0.55 &&
        /^\+?\s*add$/.test(text);
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  for (const btn of addButtons) {
    const card = findQueueCardForAddButton(btn);
    if (!card) continue;
    if (!queueCardHasAutofillBadge(card)) continue;
    const company = extractQueueCardCompany(card);
    const title = extractQueueCardTitle(card);
    const key = getQueueCardIdentity(card, company, title);
    if (!company || autoQueueAddedKeys.has(key)) continue;
    if (isBlocklisted(company)) {
      autoQueueAddedKeys.add(key);
      console.log(`[JobRight Auto-Skip] skipped blocklisted company: ${company}`);
      continue;
    }
    if (title && isExcludedQueueTitle(title)) {
      autoQueueAddedKeys.add(key);
      console.log(`[JobRight Auto-Skip] skipped excluded title: ${title}`);
      continue;
    }
    return { btn, card, company, title, key };
  }
  return null;
}

function getQueueCardIdentity(card, company = '', title = '') {
  const stableLink = [...card.querySelectorAll('a[href]')]
    .map(link => link.getAttribute('href') || '')
    .find(href => /(?:job|position|opening|career)/i.test(href));
  if (stableLink) return normalizeText(`href:${stableLink}`).slice(0, 500);

  const idElement = [card, ...card.querySelectorAll('[data-job-id], [data-position-id], [data-id], [id]')]
    .find(el =>
      el.getAttribute?.('data-job-id') ||
      el.getAttribute?.('data-position-id') ||
      el.getAttribute?.('data-id') ||
      /job|position|opening/i.test(el.id || ''),
    );
  if (idElement) {
    const id = idElement.getAttribute?.('data-job-id') ||
      idElement.getAttribute?.('data-position-id') ||
      idElement.getAttribute?.('data-id') ||
      idElement.id;
    if (id) return normalizeText(`id:${id}`).slice(0, 500);
  }

  const details = normalizeText(card.innerText || card.textContent || '')
    .replace(/\bautofill\b/g, ' ')
    .replace(/\+\s*add\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeText(`${company}|${title}|${details}`).slice(0, 500);
}

function confirmPendingAutoQueueAdd(queueCount) {
  const pending = autoQueuePendingAdd;
  if (!pending) return false;

  const buttonConnected = !!pending.btn?.isConnected;
  const buttonStillAdd = buttonConnected &&
    /^\+?\s*add$/.test(normalizeText(pending.btn.textContent));
  const succeeded = queueCount > pending.queueCountBefore ||
    (buttonConnected && !buttonStillAdd);

  if (succeeded) {
    autoQueueAddedKeys.add(pending.key);
    console.log(`[JobRight Auto-Skip] confirmed queued job: ${pending.title || '(unknown title)'} @ ${pending.company}`);
    autoQueuePendingAdd = null;
    return false;
  }

  if (Date.now() - pending.clickedAt < AUTO_QUEUE_ADD_CONFIRM_MS) return true;

  if (pending.attempts < AUTO_QUEUE_ADD_MAX_ATTEMPTS && pending.btn?.isConnected) {
    pending.attempts += 1;
    pending.clickedAt = Date.now();
    clickLikeUser(pending.btn);
    console.warn(`[JobRight Auto-Skip] retrying Add (${pending.attempts}/${AUTO_QUEUE_ADD_MAX_ATTEMPTS}): ${pending.title || '(unknown title)'} @ ${pending.company}`);
    return true;
  }

  console.warn(`[JobRight Auto-Skip] Add was not confirmed; leaving job eligible for a later retry: ${pending.title || '(unknown title)'} @ ${pending.company}`);
  autoQueuePendingAdd = null;
  return false;
}

function findShowMoreMatchesButton() {
  if (autoQueueWaitingForMoreMatches) return null;
  const root = findTopMatchesRoot();
  if (!root) return null;

  return [...root.querySelectorAll('button, [role="button"]')]
    .filter(btn => {
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !btn.disabled &&
        r.left > window.innerWidth * 0.42 &&
        r.right > window.innerWidth * 0.55 &&
        /^show me more matches$/.test(normalizeText(btn.textContent));
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
}

function getAutoQueueBatchSignature() {
  const root = findTopMatchesRoot();
  if (!root) return '';
  const cards = [...root.querySelectorAll('div, section, article, li')]
    .filter(el => isQueueCardContainer(el))
    .filter(el => ![...el.children].some(child => isQueueCardContainer(child)));

  return cards
    .map(card => getQueueCardIdentity(
      card,
      extractQueueCardCompany(card),
      extractQueueCardTitle(card),
    ))
    .filter(Boolean)
    .slice(0, 20)
    .join('|')
    .slice(0, 4_000);
}

function isJobrightLoadingMoreMatches() {
  const text = getVisibleLeftChatMessageCandidates()
    .slice(0, 3)
    .map(candidate => candidate.text)
    .join(' ');
  return /pulling up more matches|matching your skills and preferences|scanning fresh openings|searching for fresh openings|finding more matches|loading more matches/.test(text);
}

function updateShowMoreMatchesLock() {
  if (!autoQueueWaitingForMoreMatches) return;
  const currentSignature = getAutoQueueBatchSignature();
  const changed = currentSignature &&
    autoQueueRequestedBatchSignature &&
    currentSignature !== autoQueueRequestedBatchSignature;

  if (changed) {
    if (!autoQueueNewBatchSeenAt) autoQueueNewBatchSeenAt = Date.now();
    if (Date.now() - autoQueueNewBatchSeenAt >= AUTO_QUEUE_BATCH_STABLE_MS) {
      autoQueueWaitingForMoreMatches = false;
      autoQueueRequestedBatchSignature = '';
      autoQueueNewBatchSeenAt = 0;
      console.log('[JobRight Auto-Skip] new match batch loaded; Show Me More unlocked');
    }
    return;
  }

  autoQueueNewBatchSeenAt = 0;
}

function scheduleAutoQueueBuild(delay = AUTO_QUEUE_DEFAULT_DELAY_MS) {
  if (!autoQueueEnabled) return;
  const dueAt = Date.now() + delay;
  if (autoQueueTimer && autoQueueTimerDueAt <= dueAt) return;

  clearTimeout(autoQueueTimer);
  autoQueueTimerDueAt = dueAt;
  autoQueueTimer = setTimeout(() => {
    autoQueueTimer = null;
    autoQueueTimerDueAt = 0;
    runAutoQueueBuild();
  }, delay);
}

function runAutoQueueBuild() {
  if (!autoQueueEnabled || autoQueueBusy) return;
  autoQueueBusy = true;
  try {
    syncSharedBlocklist();
    if (isJobrightApplicationRunActive()) {
      if (Date.now() - lastAutoQueueActiveRunLogAt > 15_000) {
        lastAutoQueueActiveRunLogAt = Date.now();
        console.log('[JobRight Auto-Skip] auto-queue continuing while application run is active');
      }
    }

    updateShowMoreMatchesLock();
    const queueCount = getJobrightQueueCount();
    if (confirmPendingAutoQueueAdd(queueCount)) {
      scheduleAutoQueueBuild(250);
      return;
    }

    if (queueCount >= JOBRIGHT_QUEUE_LIMIT) {
      const startButton = findJobrightStartButton();
      if (startButton && Date.now() - lastAutoQueueStartAt > 10_000) {
        lastAutoQueueStartAt = Date.now();
        startButton.scrollIntoView({ block: 'center', inline: 'nearest' });
        startButton.click();
        console.log(`[JobRight Auto-Skip] auto-queue reached ${queueCount}; clicked Start`);
      }
      return;
    }

    const topMatchesRoot = findTopMatchesRoot();
    const viewAll = topMatchesRoot ? null : findViewAllJobResultsButton();
    if (!topMatchesRoot && viewAll && Date.now() - lastViewAllClickAt > 20_000) {
      lastViewAllClickAt = Date.now();
      clickLikeUser(viewAll);
      console.log('[JobRight Auto-Skip] clicked View All job results');
      scheduleAutoQueueBuild(500);
      return;
    }

    if (Date.now() - lastAutoQueueAddAt < AUTO_QUEUE_ADD_COOLDOWN_MS) {
      scheduleAutoQueueBuild(200);
      return;
    }

    const candidate = findAutoQueueCandidate();
    if (candidate) {
      lastAutoQueueAddAt = Date.now();
      autoQueuePendingAdd = {
        ...candidate,
        queueCountBefore: queueCount,
        clickedAt: Date.now(),
        attempts: 1,
      };
      clickLikeUser(candidate.btn);
      console.log(`[JobRight Auto-Skip] clicked Add; awaiting confirmation: ${candidate.title || '(unknown title)'} @ ${candidate.company}`);
      scheduleAutoQueueBuild(AUTO_QUEUE_POST_CLICK_DELAY_MS);
      return;
    }

    if (isJobrightLoadingMoreMatches()) {
      scheduleAutoQueueBuild(AUTO_QUEUE_WAIT_POLL_MS);
      return;
    }

    const showMore = findShowMoreMatchesButton();
    const batchSignature = getAutoQueueBatchSignature();
    if (showMore &&
        batchSignature &&
        batchSignature !== autoQueueLastShowMoreSignature &&
        Date.now() - lastShowMoreMatchesAt > AUTO_QUEUE_SHOW_MORE_COOLDOWN_MS) {
      lastShowMoreMatchesAt = Date.now();
      autoQueueLastShowMoreSignature = batchSignature;
      autoQueueRequestedBatchSignature = batchSignature;
      autoQueueNewBatchSeenAt = 0;
      autoQueueWaitingForMoreMatches = true;
      showMore.scrollIntoView({ block: 'center', inline: 'nearest' });
      clickLikeUser(showMore);
      console.log('[JobRight Auto-Skip] clicked Show Me More Matches for auto-queue');
      scheduleAutoQueueBuild(AUTO_QUEUE_WAIT_POLL_MS);
    }
  } finally {
    autoQueueBusy = false;
  }
}

function isJobrightApplicationFormComplete() {
  const text = getJobrightPageText();
  return /fill out application form/.test(text) &&
    /form complete/.test(text) &&
    /click submit now/.test(text);
}

function triggerJobrightSubmitNow() {
  const snapshot = getActiveApplicationSnapshot();
  const signature = snapshot?.signature || '';
  if (signature === lastJobrightSubmitNowSignature &&
      Date.now() - lastJobrightSubmitNowAt < 30_000) return false;
  const root = snapshot?.card || document;
  const button = [...root.querySelectorAll('button, [role="button"], a')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled &&
        /^submit now[.!]?$/i.test((el.textContent || '').trim());
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  if (!button) return false;
  clickLikeUser(button);
  lastJobrightSubmitNowSignature = signature;
  lastJobrightSubmitNowAt = Date.now();
  console.log('[JobRight Auto-Skip] clicked Submit Now after JobRight marked the form complete');
  return true;
}

function publishFormCompleteState() {
  const complete = isJobrightApplicationFormComplete();
  if (complete) triggerJobrightSubmitNow();
  if (complete === lastFormCompleteState) return;
  lastFormCompleteState = complete;
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'JOBRIGHT_FORM_COMPLETE_STATE', complete }).catch(() => {}),
  );
}

function getJobrightMissingFieldNames() {
  const candidates = [...document.querySelectorAll('div, section, article')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const text = normalizeText(el.innerText || el.textContent || '');
      return /\d+\s*\/\s*\d+\s+required fields filled/.test(text) &&
        /missing fields?/.test(text);
    })
    .sort((a, b) =>
      (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length
    );
  const text = candidates[0]?.innerText || candidates[0]?.textContent || '';
  if (!text) return [];

  const lines = text.split(/\n+/).map(line => line.replace(/^[\s•·*-]+/, '').trim()).filter(Boolean);
  const markerIndex = lines.findIndex(line => /missing fields?/i.test(line));
  if (markerIndex < 0) return [];
  return lines.slice(markerIndex + 1)
    .filter(line => !/^(i'?ve applied|start fixing|fixed|submit application)$/i.test(line))
    .filter(line => line.length >= 2 && line.length <= 100)
    .slice(0, 12);
}

function publishJobrightMissingFields() {
  const fields = getJobrightMissingFieldNames();
  if (!fields.length) {
    if (lastMissingFieldsSignature) {
      safeChrome(() =>
        chrome.runtime.sendMessage({ type: 'JOBRIGHT_NUDGE_MISSING_FIELDS', fields: [] }).catch(() => {}),
      );
    }
    lastMissingFieldsSignature = '';
    return;
  }
  const signature = fields.map(normalizeText).join('|');
  const now = Date.now();
  if (signature === lastMissingFieldsSignature && now - lastMissingFieldsPublishedAt < 15_000) return;
  lastMissingFieldsSignature = signature;
  lastMissingFieldsPublishedAt = now;
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'JOBRIGHT_NUDGE_MISSING_FIELDS', fields }).catch(() => {}),
  );
}

function closeFeedbackModal() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], .ant-modal, [class*="modal"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && /feedback/i.test(el.textContent || '');
    });

  for (const dialog of dialogs) {
    const closeBtn = [...dialog.querySelectorAll('button, [role="button"]')]
      .find(btn => {
        const text = `${btn.getAttribute('aria-label') || ''} ${btn.title || ''} ${btn.textContent || ''}`.trim();
        const r = btn.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (/close/i.test(text) || text === '×' || text === 'x');
      }) || [...dialog.querySelectorAll('button, [role="button"]')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
                      b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];

    if (closeBtn) {
      closeBtn.click();
      console.log('[JobRight Auto-Skip] closed feedback modal');
      return true;
    }
  }
  return false;
}

function closeFiltersPanel() {
  const directPanels = [...document.querySelectorAll('[role="dialog"], [class*="drawer"], [class*="modal"], div')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      const text = normalizeText(el.textContent);
      return r.width > window.innerWidth * 0.45 &&
        r.right > window.innerWidth * 0.75 &&
        r.height > window.innerHeight * 0.7 &&
        /^filters\b/.test(text);
    })
    .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);

  const headerPanels = [...document.querySelectorAll('h1, h2, h3, div, span')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const r = el.getBoundingClientRect();
      return r.left > window.innerWidth * 0.42 &&
        r.top < 140 &&
        /^filters\b/.test(normalizeText(el.textContent));
    })
    .map(header => {
      let node = header.parentElement;
      for (let depth = 0; depth < 10 && node; depth++, node = node.parentElement) {
        const r = node.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.45 &&
            r.right > window.innerWidth * 0.75 &&
            r.height > window.innerHeight * 0.55) return node;
      }
      return null;
    })
    .filter(Boolean);

  const panels = [...directPanels, ...headerPanels];

  for (const panel of panels) {
    const closeBtn = [...panel.querySelectorAll('button, [role="button"]')]
      .filter(btn => {
        const r = btn.getBoundingClientRect();
        const text = `${btn.getAttribute('aria-label') || ''} ${btn.title || ''} ${btn.textContent || ''}`.trim();
        return r.width > 0 && r.height > 0 &&
          (/close|back|collapse/i.test(text) || normalizeText(text) === '›' || normalizeText(text) === '>');
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
                      a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    if (closeBtn) {
      clickLikeUser(closeBtn);
      console.log('[JobRight Auto-Skip] closed accidentally opened Filters panel');
      return true;
    }
  }
  return false;
}

// ─── CASE 1 – Confirm-bubble Skip ─────────────────────────────────────────────
function findSkipControlInContainer(container) {
  return [...container.querySelectorAll('button, a, [role="button"], span')]
    .filter(el => {
      if (!hasRenderedBox(el) || el.disabled) return false;
      const text = normalizeText(el.textContent);
      const aria = normalizeText(el.getAttribute('aria-label') || '');
      const title = normalizeText(el.getAttribute('title') || '');
      if (![text, aria, title].some(value => value === 'skip')) return false;
      if (el.matches('button') && el.className?.includes?.('ant-btn-primary')) return false;
      return !el.matches('span') || getComputedStyle(el).cursor === 'pointer';
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    })[0] || null;
}

// JobRight sometimes changes the wrapper around the active application card.
// Keep this path anchored to the exact visible autofill-only message rather
// than requiring getActiveApplicationCard() to recognize that wrapper first.
// The Skip control must still be inside the same bounded left-pane card, which
// avoids clicking a Skip link from an older application in chat history.
function findExactAutofillOnlyPromptSkip() {
  const matches = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;

  while ((textNode = walker.nextNode())) {
    const message = normalizeText(textNode.nodeValue || '');
    if (!CONFIG.CONFIRM_TRIGGER_TEXTS.some(trigger => message.includes(trigger))) continue;

    const marker = textNode.parentElement;
    if (!marker || !isVisibleElement(marker)) continue;
    const markerRect = marker.getBoundingClientRect();
    if (markerRect.left >= window.innerWidth * 0.62) continue;

    let card = marker;
    for (let depth = 0; depth < 12 && card; depth++, card = card.parentElement) {
      const rect = card.getBoundingClientRect();
      if (rect.left >= window.innerWidth * 0.62 || rect.width < 200) continue;
      if (rect.width > window.innerWidth * 0.85 || rect.height > window.innerHeight * 0.9) break;

      const cardText = normalizeText(card.innerText || card.textContent || '');
      if (!CONFIG.CONFIRM_TRIGGER_TEXTS.some(trigger => cardText.includes(trigger))) continue;

      const btn = findSkipControlInContainer(card);
      if (!btn) continue;
      matches.push({
        marker,
        card,
        btn,
        textLength: cardText.length,
      });
      break;
    }
  }

  const match = matches.sort((a, b) =>
    a.textLength - b.textLength ||
    a.card.getBoundingClientRect().top - b.card.getBoundingClientRect().top,
  )[0];
  return match
    ? {
        btn: match.btn,
        label: 'exact autofill-only prompt',
        company: getCompanyFromBubbleContext(match.marker),
      }
    : null;
}

function findTriggeredSkipContainer({ confirmBubbleOnly = false } = {}) {
  const activeCard = getActiveApplicationCard();
  if (!activeCard) return null;
  const containers = [];
  const addContainer = (el, label) => {
    if (el !== activeCard && !activeCard.contains(el)) return;
    if (!isVisibleElement(el)) return;
    const text = normalizeText(el.innerText || el.textContent || '');
    if (!text || text.length > 1800) return;
    if (!CONFIG.CONFIRM_TRIGGER_TEXTS.some(trigger => text.includes(trigger))) return;

    // First try to find a Skip button inside this element
    let btn = findSkipControlInContainer(el);

    // If no Skip inside, walk up ancestors to find the card-level Skip link.
    if (!btn) {
      let ancestor = el.parentElement;
      for (let depth = 0; depth < 12 && ancestor; depth++) {
        const ar = ancestor.getBoundingClientRect();
        if (ar.height > window.innerHeight * 0.85 || ar.width > window.innerWidth * 0.8) break;
        if (ar.height >= 80 && ar.left < window.innerWidth * 0.62 && ar.width > 200) {
          const candidates = ancestor.querySelectorAll('a, button, [role="button"], span[tabindex]');
          for (const candidate of candidates) {
            if (el.contains(candidate)) continue;
            if (candidate.offsetParent === null || candidate.disabled) continue;
            const txt = normalizeText(candidate.textContent || candidate.getAttribute('aria-label') || '');
            if (txt !== 'skip') continue;
            const cr = candidate.getBoundingClientRect();
            if (cr.width === 0 || cr.height === 0) continue;
            btn = candidate;
            break;
          }
          if (btn) break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    if (!btn) return;
    containers.push({ el, btn, label, textLength: text.length });
  };

  for (const el of document.querySelectorAll('[class]')) {
    if (typeof el.className === 'string' && el.className.includes(CONFIG.CONFIRM_BUBBLE_CLASS)) {
      addContainer(el, 'confirm-bubble');
    }
  }

  if (confirmBubbleOnly) {
    return containers
      .sort((a, b) => a.textLength - b.textLength ||
        a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top)[0] || null;
  }

  for (const el of document.querySelectorAll('div, section, article, li')) {
    addContainer(el, 'autofill-only card');
  }

  return containers
    .sort((a, b) => a.textLength - b.textLength ||
      a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top)[0] || null;
}




function findConfirmBubbleSkip(options) {
  const match = findTriggeredSkipContainer(options);
  if (!match) return null;
  return {
    btn: match.btn,
    label: match.label,
    company: getCompanyFromBubbleContext(match.el),
  };
}

// ─── CASE 2 – Analyze-site bubble → card-level Skip ──────────────────────────
function findAnalyzeBubbleCardSkip() {
  const activeCard = getActiveApplicationCard();
  if (!activeCard) return null;
  const allElements = document.querySelectorAll('[class]');

  for (const el of allElements) {
    if (el !== activeCard && !activeCard.contains(el)) continue;
    if (el.children.length === 0) continue;

    const text = (el.innerText || el.textContent || '').toLowerCase();
    if (!text.includes(CONFIG.ANALYZE_TRIGGER_TEXT) &&
        !text.includes(CONFIG.ANALYZE_BTN_TEXT)) continue;

    const innerButtons = Array.from(el.querySelectorAll('button'));
    const hasApplyBtn = innerButtons.some(
      btn => (btn.textContent || '').toLowerCase().includes(CONFIG.ANALYZE_BTN_TEXT)
          && btn.offsetParent !== null,
    );
    if (!hasApplyBtn) continue;

    const hasInnerSkip = innerButtons.some(
      btn => (btn.textContent || '').trim().toLowerCase() === 'skip',
    );
    if (hasInnerSkip) continue;

    const company = getCompanyFromBubbleContext(el);

    let ancestor = el.parentElement;
    for (let depth = 0; depth < 15 && ancestor; depth++) {
      const candidates = ancestor.querySelectorAll(
        'a, button, [role="button"], span[tabindex]',
      );

      for (const candidate of candidates) {
        if (el.contains(candidate)) continue;
        const txt = (candidate.textContent || '').trim().toLowerCase();
        if (txt !== 'skip') continue;
        if (candidate.offsetParent === null) continue;
        if (candidate.disabled) continue;
        return { btn: candidate, label: 'analyze-site card-skip', company };
      }

      if (ancestor === activeCard) break;
      ancestor = ancestor.parentElement;
    }
  }

  return null;
}

// ─── CASE 3 – Blocklist pre-skip ─────────────────────────────────────────────
// When a new job card appears for a blocklisted company, click its Skip link
// immediately without waiting for the bubble to appear.
function findBlocklistSkip() {
  if (!blocklistEnabled || blocklist.length === 0) return null;
  const snapshot = getActiveApplicationSnapshot();
  const company = snapshot?.context?.company || '';
  if (!snapshot?.card || !company || !isBlocklisted(company)) return null;
  const btn = findSkipControlInContainer(snapshot.card);
  return btn
    ? { btn, label: `blocklist-skip (${company})`, company: null }
    : null;
}

// ─── CORE ─────────────────────────────────────────────────────────────────────
function tryClickSkip() {
  if (!alive || !enabled) return;
  const activeSnapshot = getActiveApplicationSnapshot();
  if (activeSnapshot?.signature &&
      pendingStuckScreenshotSignature === activeSnapshot.signature) return;
  if (activeSnapshot?.signature &&
      activeSnapshot.signature === leverProtectedJobSignature) return;
  syncSharedBlocklist();

  const now = Date.now();
  if (now - lastClickTime < CONFIG.COOLDOWN_MS) return;

  let result;
  try {
    // This is the explicit JobRight instruction to leave the in-app flow.
    // Check it before the structural active-card logic so a wrapper change
    // cannot leave the application stranded.
    result = findExactAutofillOnlyPromptSkip();

    // Once the active job reaches its form/action stage, stale prompt text must
    // not cancel it. Timeout and ATS terminal paths are handled separately.
    if (!result) {
      result = activeSnapshot?.timeoutEligible
        ? findConfirmBubbleSkip({ confirmBubbleOnly: true }) || findBlocklistSkip()
        : findConfirmBubbleSkip()
          || findAnalyzeBubbleCardSkip()
          || findBlocklistSkip();
    }
  } catch (err) {
    if (isInvalidated(err)) { shutdown('DOM scan error'); return; }
    return;
  }

  if (!result) return;


  lastClickTime = now;

  try {
    result.btn.click();
  } catch (_) { return; }

  skipCount++;
  console.log(`[JobRight Auto-Skip] ✓ ${result.label} (#${skipCount})`);

  // Auto-add company to blocklist when skipped via bubble
  if (result.company) {
    addToBlocklist(result.company);
  }

  safeChrome(() => chrome.storage.local.set({ skipCount }));
  safeChrome(() =>
    chrome.runtime.sendMessage({ type: 'SKIP_CLICKED', count: skipCount }).catch(() => {}),
  );
}

// ─── DOM WATCHER ─────────────────────────────────────────────────────────────
const observer = new MutationObserver((mutations) => {
  try {
    closeFeedbackModal();
    closeFiltersPanel();
    handleJobrightStatusPrompts();
    captureCancelledApplicationCompanies();
    publishFormCompleteState();
    publishJobrightMissingFields();
    publishActiveJobContext();
    scheduleAutoQueueBuild();
    if (!alive || !enabled) return;
    const hasAdditions = mutations.some(
      m => m.type === 'childList' && m.addedNodes.length > 0,
    );
    if (!hasAdditions) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        tryClickSkip();
      } catch (err) {
        if (isInvalidated(err)) shutdown('debounce callback');
      }
    }, CONFIG.DEBOUNCE_MS);

  } catch (err) {
    if (isInvalidated(err)) shutdown('observer callback');
  }
});

observer.observe(document.body, { childList: true, subtree: true });
globalThis.__jobrightContentCleanup = () => shutdown('replaced by a fresh content script');
setTimeout(() => { try { handleJobrightStatusPrompts(); captureCancelledApplicationCompanies(); publishFormCompleteState(); publishJobrightMissingFields(); publishActiveJobContext(true); scheduleAutoQueueBuild(); tryClickSkip(); } catch (_) {} }, 2500);
setTimeout(() => { try { closeFeedbackModal(); } catch (_) {} }, 1000);
setTimeout(() => { try { closeFiltersPanel(); } catch (_) {} }, 1000);

// ─── POPUP COMMUNICATION ─────────────────────────────────────────────────────
try {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'GET_STATUS') {
      reply({
        enabled,
        skipCount,
        blocklistEnabled,
        blocklist,
        autoAppliedEnabled,
        autoQueueEnabled,
        submissionCountSincePrompt,
      });
    } else if (msg.type === 'SET_ENABLED') {
      enabled = !!msg.enabled;
      safeChrome(() => chrome.storage.local.set({ enabled }));
      reply({ ok: true });
    } else if (msg.type === 'SET_BLOCKLIST_ENABLED') {
      blocklistEnabled = !!msg.blocklistEnabled;
      safeChrome(() => chrome.storage.sync.set({ blocklistEnabled }));
      reply({ ok: true });
    } else if (msg.type === 'RESET_COUNT') {
      skipCount = 0;
      safeChrome(() => chrome.storage.local.set({ skipCount: 0 }));
    } else if (msg.type === 'SET_AUTO_APPLIED_ENABLED') {
      autoAppliedEnabled = !!msg.autoAppliedEnabled;
      safeChrome(() => chrome.storage.local.set({ autoAppliedEnabled }));
      reply({ ok: true });
    } else if (msg.type === 'SET_AUTO_QUEUE_ENABLED') {
      autoQueueEnabled = !!msg.autoQueueEnabled;
      if (!autoQueueEnabled) {
        clearTimeout(autoQueueTimer);
        autoQueueTimer = null;
        autoQueueTimerDueAt = 0;
        autoQueuePendingAdd = null;
      }
      safeChrome(() => chrome.storage.local.set({ autoQueueEnabled }));
      if (autoQueueEnabled) scheduleAutoQueueBuild(300);
      reply({ ok: true });
    } else if (msg.type === 'REMOVE_FROM_BLOCKLIST') {
      blocklist = blocklist.filter(b => b !== msg.company);
      persistBlocklist();
      safeChrome(() => chrome.runtime.sendMessage({ type: 'SHARED_BLOCKLIST_REMOVE', company: msg.company }).catch(() => {}));
      reply({ ok: true });
    } else if (msg.type === 'CLEAR_BLOCKLIST') {
      blocklist = [];
      persistBlocklist();
      safeChrome(() => chrome.runtime.sendMessage({ type: 'SHARED_BLOCKLIST_REPLACE', blocklist: [] }).catch(() => {}));
      reply({ ok: true });
    } else if (msg.type === 'ADD_TO_BLOCKLIST') {
      if (msg.company) addToBlocklist(msg.company);
      reply({ ok: true });
    } else if (msg.type === 'PLACE_OTP_IN_JOBRIGHT_CHAT') {
      reply({ ok: placeOtpInJobrightChat(msg.otp) });
    } else if (msg.type === 'SEND_JOBRIGHT_SYSTEM_PROMPT') {
      reply({ ok: sendJobrightSystemPrompt(msg.prompt) });
    } else if (msg.type === 'PLAY_STUCK_JOB_WARNING_SOUND') {
      reply({ ok: playStuckJobWarningSound() });
    } else if (msg.type === 'ATS_FRAME_STATE') {
      let host = '';
      try { host = new URL(msg.atsUrl || msg.atsOrigin || '').hostname; } catch (_) {}
      if (/(^|\.)lever\.co$/i.test(host)) {
        const signature = getActiveApplicationSnapshot()?.signature || '';
        if (signature && signature !== leverConfirmedSuccessSignature) {
          leverProtectedJobSignature = signature;
        }
      }
      reply({ ok: true, protected: !!leverProtectedJobSignature });
    } else if (msg.type === 'ATS_VALIDATION_ERROR') {
      // Give the ATS frame time to re-trigger the field and retry submission.
      // A visible required-field error is never a reason to cancel or learn a
      // company blocklist entry.
      atsValidationHoldUntil = Math.max(atsValidationHoldUntil, Date.now() + 20_000);
      console.log('[JobRight Auto-Skip] ATS validation error received; cancellation paused for repair');
      reply({ ok: true });
    } else if (msg.type === 'TRIGGER_IVE_APPLIED') {
      let host = '';
      try { host = new URL(msg.atsUrl || msg.atsOrigin || '').hostname; } catch (_) {}
      const isLever = /(^|\.)lever\.co$/i.test(host);
      // Failed/limited applications must never be marked as applied.
      reply({
        ok: msg.confirmedFailure && isLever
          ? true
          : msg.confirmedFailure
          ? handleAtsTerminalFailureState()
          : handleAtsTerminalApplicationState(!!msg.confirmedSuccess),
      });
    } else if (msg.type === 'GET_ACTIVE_JOB_CONTEXT') {
      reply({ ok: true, ...getActiveJobContext() });
    } else if (msg.type === 'GET_STUCK_WATCH_STATE') {
      const snapshot = getActiveApplicationSnapshot();
      reply({
        ok: true,
        enabled,
        runActive: isJobrightApplicationRunActive(),
        snapshot: snapshot ? {
          signature: snapshot.signature,
          progressSignature: snapshot.progressSignature,
          timeoutEligible: snapshot.timeoutEligible,
        } : null,
        stuckJobSignature,
        stuckJobProgressSignature,
        stuckJobElapsedMs: stuckJobLastProgressAt
          ? Date.now() - stuckJobLastProgressAt
          : null,
        stuckJobScreenshotSignature,
        pendingStuckScreenshotSignature,
        leverProtectedJobSignature,
      });
    }
    return true;
  });
} catch (err) {
  if (isInvalidated(err)) shutdown('onMessage setup');
}

// ─── RESTORE PERSISTED STATE ─────────────────────────────────────────────────
// Per-browser state (local)
safeChrome(() =>
  chrome.storage.local.get([
    'enabled',
    'skipCount',
    'autoAppliedEnabled',
    'autoQueueEnabled',
    SUBMISSION_COUNT_STORAGE_KEY,
    SUBMISSION_SEEN_STORAGE_KEY,
  ], (stored) => {
    if (stored.enabled             !== undefined) enabled           = !!stored.enabled;
    if (stored.skipCount           !== undefined) skipCount         = Number(stored.skipCount) || 0;
    if (stored.autoAppliedEnabled  !== undefined) autoAppliedEnabled = !!stored.autoAppliedEnabled;
    if (stored.autoQueueEnabled    !== undefined) autoQueueEnabled  = !!stored.autoQueueEnabled;
    submissionCountSincePrompt = Math.max(
      0,
      Number(stored[SUBMISSION_COUNT_STORAGE_KEY]) || 0,
    ) % SYSTEM_PROMPT_SUBMISSION_INTERVAL;
    const storedSeenCounts = stored[SUBMISSION_SEEN_STORAGE_KEY];
    if (storedSeenCounts && typeof storedSeenCounts === 'object') {
      submissionSeenCounts = new Map(
        Object.entries(storedSeenCounts)
          .filter(([text, count]) => text && Number(count) > 0)
          .map(([text, count]) => [text, Number(count)]),
      );
    } else {
      // On first run after installing this counter, treat rendered history as
      // the baseline so old submissions are not replayed as new confirmations.
      submissionSeenCounts = getSubmissionStatusCounts();
      persistSubmissionCounter();
    }
    submissionCounterReady = true;
    if (autoQueueEnabled) scheduleAutoQueueBuild(500);
  }),
);
// Shared state across browsers (sync)
safeChrome(() =>
  chrome.storage.sync.get(['blocklistEnabled', 'blocklist'], (stored) => {
    if (stored.blocklistEnabled !== undefined) blocklistEnabled = !!stored.blocklistEnabled;
    if (Array.isArray(stored.blocklist)) {
      blocklist = normalizeBlocklist(stored.blocklist);
      if (blocklist.length !== stored.blocklist.length) persistBlocklist();
    }
    syncSharedBlocklist();
  }),
);

safeChrome(() =>
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.blocklistEnabled) blocklistEnabled = !!changes.blocklistEnabled.newValue;
    if (changes.blocklist && Array.isArray(changes.blocklist.newValue)) {
      blocklist = normalizeBlocklist(changes.blocklist.newValue);
    }
  }),
);

safeChrome(() =>
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY]) return;
    customTerminalSuccessPhrases = normalizeStoredTerminalSuccessPhrases(
      changes[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY].newValue
    );
    rebuildTerminalSuccessPhraseCache();
    handleJobrightStatusPrompts();
  }),
);

managedIntervalIds.push(
  setInterval(() => { try { syncSharedBlocklist(); } catch (_) {} }, 15_000),
  setInterval(() => {
    try {
      watchForStuckApplication();
    } catch (err) {
      console.warn('[JobRight Auto-Skip] stuck-job watcher failed', err);
    }
    try {
      closeFiltersPanel();
      handleJobrightStatusPrompts();
      captureCancelledApplicationCompanies();
      publishFormCompleteState();
      publishJobrightMissingFields();
      publishActiveJobContext();
      tryClickSkip();
    } catch (_) {}
  }, 1_500),
  setInterval(() => { try { if (autoQueueEnabled) runAutoQueueBuild(); } catch (_) {} }, AUTO_QUEUE_SCAN_INTERVAL_MS),
);
}
