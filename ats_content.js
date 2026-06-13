'use strict';

// ── Guard: only load once per page ───────────────────────────────────────────
if (globalThis.__jobrightAtsLoaded) { /* already running */ }
else {
globalThis.__jobrightAtsLoaded = true;

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════

const ATS_SUBMITTED_TEXTS = [
  'application submitted', 'application submitted!',
  'your application has been submitted', 'thanks for applying',
  'thank you for applying', 'successfully submitted',
  'you have successfully applied', 'application received',
  'we received your application', 'we’ve received your application',
  "we've received your application", 'your application is complete',
  'application complete', 'submission successful', 'you applied',
  'application sent', 'we couldn\'t submit your application',
  'couldn\'t submit your application', 'application limit',
  'reached your application limit', 'limit applications',
  'thank you for your interest', 'we\'ll be back in touch soon',
  'will get back to you soon', 'interested in joining us',
  'you did it', 'officially in review', 'background is a match',
];

const ATS_SUBMITTED_PATTERNS = [
  /\bthank you(?:\s+\w+){0,4}\s+for applying\b/i,
  /\bthanks(?:\s+\w+){0,4}\s+for applying\b/i,
  /\b(application|submission)\s+(sent|submitted|received|complete|successful)\b/i,
  /\byour application (has been |was )?(sent|submitted|received)\b/i,
  /\bwe(?:'|’)ve received your application\b/i,
  /\bwe received your application\b/i,
  /\bwe'?ll be back in touch soon\b/i,
  /\bwill get back to you soon\b/i,
  /\bthrilled that you are interested in joining us\b/i,
  /\bone of our .*team .*will reach out\b/i,
  /\byou did it\b/i,
  /\bofficially in review\b/i,
  /\bwill get in touch if your background is a match\b/i,
  /\bif there'?s? a fit\b/i,
];

const ATS_CONFIRMED_SUCCESS_PATTERNS = [
  /\bthank you(?:\s+\w+){0,5}\s+for applying\b/i,
  /\bthanks(?:\s+\w+){0,5}\s+for applying\b/i,
  /\bthank you(?:\s+\w+){0,8}\s+for your interest\b.{0,240}\b(?:we |we(?:'|’)ve )?received your application\b/is,
  /\bapplication\s+(?:was\s+|has\s+been\s+)?(?:successfully\s+)?submitted\b/i,
  /\byour application (?:has been |was )?(?:received|submitted|sent)\b/i,
  /\bwe(?:'|’)ve received your application\b/i,
  /\bwe received your application\b/i,
  /\bsuccessfully submitted (?:your|the) application\b/i,
  /\byou have successfully applied\b/i,
  /\bsubmission successful\b/i,
];

const ATS_CONFIRMED_FAILURE_PATTERNS = [
  /\bwe couldn['’]?t submit your application\b/i,
  /\bcould not submit your application\b/i,
  /\bapplication (?:was |is )?not submitted\b/i,
  /\bapplication (?:submission )?(?:failed|unsuccessful)\b/i,
  /\b(?:reached|reached your|have reached|application) (?:the )?application limit\b/i,
  /\blimit (?:the number of |your )?applications\b/i,
  /\balready applied to this position\b/i,
  /\bonly accept one application for the same role\b/i,
];

const OTP_FIELD_PATTERN = /\b(otp|one[-\s]?time\s*(code|password)?|verification\s*code|verify\s*code|security\s*code|passcode)\b/i;

const AUTO_POLL_INTERVAL_MS  = 4_000;   // poll every 4s
const AUTO_POLL_MAX_ATTEMPTS = 12;      // 48s total window
const AUTO_FETCH_COOLDOWN_MS = 15_000;  // don't re-trigger same field within 15s
const VALIDATION_RETRY_FLAG  = 'atsValidationRetryEnabled';
const PROFILE_CORRECTION_FLAG = 'atsProfileCorrectionEnabled';
const VALIDATION_RETRY_MAX   = 1;
const OTP_SECTION_PATTERN    = /\b(a verification code was sent|verification code was sent|code was sent to|enter the 8-character code|confirm you'?re a human|security code required|enter.*security code|enter.*verification code|your verification code)\b/i;
const OTP_EMAIL_SENT_PATTERN = /a verification code was sent to .{3,80}@.{3,80}\.|verification code was sent to your email|code was sent to your email/i;
const INVALID_OTP_PATTERN    = /\b(?:otp|code|security code|verification code).{0,100}\b(?:incorrect|invalid|wrong|expired|doesn'?t match|does not match)\b|\b(?:incorrect|invalid|wrong|expired).{0,100}\b(?:otp|code|security code|verification code)\b/i;
const FALLBACK_RESUME_PATH   = 'assets/Prabhjot_Ahluwalia_PM_Resume_US_Citizen.pdf';
const FALLBACK_RESUME_NAME   = 'Prabhjot_Ahluwalia_PM_Resume_US_Citizen.pdf';
const FALLBACK_COVER_LETTER_PATH = 'assets/Prabhjot_Ahluwalia_Cover_Letter.pdf';
const FALLBACK_COVER_LETTER_NAME = 'Prabhjot_Ahluwalia_Cover_Letter.pdf';
const TERMINAL_SUCCESS_PHRASES_FILE = 'jobright_terminal_success_phrases.txt';
const CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY = 'customTerminalSuccessPhrases';
const PROFILE_CORRECTIONS = {
  fullName: 'Prabhjot Singh Ahluwalia',
  firstName: 'Prabhjot Singh',
  lastName: 'Ahluwalia',
  currentCompany: 'Georgia Tech',
  email: 'ahluwaliaps@gmail.com',
  phone: '4044646692',
  locationCity: 'Atlanta, Georgia, United States',
  linkedin: 'https://www.linkedin.com/in/prabhjot-ahluwalia/',
  referralName: 'NA - I applied directly',
};

// ═════════════════════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════════════════════

let signalSent           = false;
let lastSubmissionSignalAt = 0;
let otpAlertShown        = false;
let autoAppliedEnabled   = true;
let autoPollingTimer     = null;
let lastAutoFetchAt      = 0;
let lastAutoFetchElement = null;
let otpStatusBadge       = null;
let validationRetryEnabled = true;
let validationRetryTimer   = null;
let validationRetryCounts  = new Map();
let termsCheckboxTimer     = null;
let smsOptOutTimer          = null;
let relocationAnswerTimer   = null;
let workEligibilityAnswerTimer = null;
let resumeFallbackTimer    = null;
let resumeFallbackUploaded = false;
let jobrightResumeMissingAt = 0;
let resumeFallbackAttempts = 0;
let coverLetterFallbackTimer = null;
let coverLetterFallbackUploaded = false;
let jobrightCoverLetterMissingAt = 0;
let coverLetterFallbackAttempts = 0;
let lastFilledOtp          = '';
let lastFilledOtpMessageId = '';
let ignoredOtpMessageIds   = [];
let ignoredOtpValues       = new Set();
let invalidOtpRetryTimer   = null;
let lastInvalidOtpRetryAt  = 0;
let lastSubmitAttemptAt    = 0;
let profileCorrectionTimer = null;
let profileCorrectionEnabled = true;
let profileCorrectionReady = false;
let manualEditSubmitTimer = null;
let lastManualEditSubmitSignature = '';
let lastManualEditSubmitAt = 0;
let lastJobrightNudgeSignature = '';
let lastJobrightNudgeAt = 0;
let lastJobrightRepairSubmitSignature = '';
let lastJobrightRepairSubmitAt = 0;
let latestJobrightMissingFields = [];
let latestJobrightMissingFieldsAt = 0;
let jobrightRepairSubmitTimer = null;
let terminalSuccessPhraseCache = [];
let builtInTerminalSuccessPhrases = [];
let customTerminalSuccessPhrases = [];
let terminalSuccessPhraseLoading = false;
let leverApplyClickUrl = '';
let leverApplyClickAt = 0;
const relocationAnswerAttempts = new Map();
const booleanAnswerClickLocks = new Set();
const manuallyEditedFields = new WeakSet();

function clickLeverApplyForThisJobOnce() {
  if (!/(^|\.)lever\.co$/i.test(location.hostname) ||
      /\/apply(?:[/?#]|$)/i.test(location.pathname)) {
    return false;
  }

  const currentUrl = location.href;
  if (leverApplyClickUrl === currentUrl) return false;

  const link = [...document.querySelectorAll('a[href], button, [role="button"]')]
    .find(el => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || el.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim();
      return rect.width > 0 &&
        rect.height > 0 &&
        /^apply for this job$/i.test(text);
    });
  if (!link) return false;

  leverApplyClickUrl = currentUrl;
  leverApplyClickAt = Date.now();
  try { link.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
  link.click();
  console.log('[JobRight Auto-Skip] opened Lever application form');
  return true;
}

// ── Read feature flag from storage ───────────────────────────────────────────
try {
  chrome.storage.local.get(['autoAppliedEnabled', VALIDATION_RETRY_FLAG, PROFILE_CORRECTION_FLAG], (stored) => {
    if (stored.autoAppliedEnabled !== undefined) autoAppliedEnabled = !!stored.autoAppliedEnabled;
    if (stored[VALIDATION_RETRY_FLAG] !== undefined) validationRetryEnabled = !!stored[VALIDATION_RETRY_FLAG];
    if (stored[PROFILE_CORRECTION_FLAG] !== undefined) {
      profileCorrectionEnabled = !!stored[PROFILE_CORRECTION_FLAG];
    }
    profileCorrectionReady = true;
    if (profileCorrectionEnabled) scheduleProfileCorrection(0);
  });
} catch (_) {}

// Keep flag in sync if popup toggles it mid-session
try {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SET_AUTO_APPLIED_ENABLED') autoAppliedEnabled = !!msg.autoAppliedEnabled;
    if (msg.type === 'SET_VALIDATION_RETRY_ENABLED') validationRetryEnabled = !!msg.validationRetryEnabled;
    if (msg.type === 'SET_PROFILE_CORRECTION_ENABLED') {
      profileCorrectionReady = true;
      profileCorrectionEnabled = !!msg.profileCorrectionEnabled;
      if (!profileCorrectionEnabled) clearTimeout(profileCorrectionTimer);
      else scheduleProfileCorrection(0);
    }
    if (msg.type === 'OTP_FOUND') {
      if (shouldIgnoreOtpResult(msg)) return;
      if (autofillOtp(msg.otp)) recordFilledOtp(msg);
    }
    if (msg.type === 'NUDGE_JOBRIGHT_MISSING_FIELDS') {
      const fields = Array.isArray(msg.fields) ? msg.fields.filter(Boolean).slice(0, 12) : [];
      const signature = fields.map(normalizeText).join('|');
      latestJobrightMissingFields = fields;
      latestJobrightMissingFieldsAt = Date.now();
      if (fields.some(field => isResumeFieldText(field))) {
        jobrightResumeMissingAt = Date.now();
        scheduleFallbackResumeUpload(0);
      }
      if (fields.some(field => isCoverLetterFieldText(field))) {
        jobrightCoverLetterMissingAt = Date.now();
        scheduleFallbackCoverLetterUpload(0);
      }
      if (!signature ||
          (signature === lastJobrightNudgeSignature && Date.now() - lastJobrightNudgeAt < 12_000)) {
        sendResponse?.({ ok: true, nudged: 0 });
        return true;
      }
      let nudged = 0;
      correctWorkEligibilityAnswers();
      chooseYesForRelocationQuestions();
      fields.forEach(field => {
        if (nudgeField(field, null)) nudged++;
      });
      if (nudged) {
        lastJobrightNudgeSignature = signature;
        lastJobrightNudgeAt = Date.now();
        scheduleSubmitAfterVerifiedJobrightRepair(fields);
        console.log(`[JobRight Auto-Skip] re-triggered ${nudged} JobRight missing field(s)`);
      }
      sendResponse?.({ ok: nudged > 0, nudged });
      return true;
    }
    return false;
  });
} catch (_) {}

function registerAtsFrame() {
  try {
    chrome.runtime.sendMessage({
      type: 'ATS_FRAME_READY',
      origin: location.origin,
      url: location.href,
    }, () => void chrome.runtime.lastError);
  } catch (_) {}
}

registerAtsFrame();
setInterval(registerAtsFrame, 15_000);

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
  try {
    chrome.storage.local.get([CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY], stored => {
      customTerminalSuccessPhrases = normalizeStoredTerminalSuccessPhrases(
        stored[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY]
      );
      rebuildTerminalSuccessPhraseCache();
      checkForSubmission();
    });
  } catch (_) {}
}

function loadTerminalSuccessPhrases() {
  if (builtInTerminalSuccessPhrases.length || terminalSuccessPhraseLoading) {
    return terminalSuccessPhraseCache;
  }
  terminalSuccessPhraseLoading = true;
  let url = '';
  try { url = chrome.runtime.getURL(TERMINAL_SUCCESS_PHRASES_FILE); }
  catch (_) {
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

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[PROFILE_CORRECTION_FLAG]) {
      profileCorrectionReady = true;
      profileCorrectionEnabled = changes[PROFILE_CORRECTION_FLAG].newValue !== false;
      if (!profileCorrectionEnabled) clearTimeout(profileCorrectionTimer);
      else scheduleProfileCorrection(0);
    }
    if (changes[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY]) {
      customTerminalSuccessPhrases = normalizeStoredTerminalSuccessPhrases(
        changes[CUSTOM_TERMINAL_SUCCESS_PHRASES_KEY].newValue
      );
      rebuildTerminalSuccessPhraseCache();
      checkForSubmission();
    }
  });
} catch (_) {}

// ═════════════════════════════════════════════════════════════════════════════
// OTP FIELD DETECTION
// ═════════════════════════════════════════════════════════════════════════════

function isVisibleElement(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function isOtpFillTarget(el) {
  if (!el) return false;
  const EDITABLE = new Set(['text','tel','number','password','search','email','url']);
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return EDITABLE.has((el.type || 'text').toLowerCase());
  return el.isContentEditable;
}

function getElementHints(el) {
  const labels = el.id
    ? [...document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)].map(l => l.textContent)
    : [];
  if (el.closest('label')) labels.push(el.closest('label').textContent);
  return [el.id, el.name, el.autocomplete, el.inputMode, el.placeholder,
          el.getAttribute('aria-label'), el.getAttribute('aria-describedby'),
          el.getAttribute('aria-labelledby'), ...labels].filter(Boolean).join(' ');
}

function isLikelyOtpField(el) {
  if (!isOtpFillTarget(el)) return false;
  if ((el.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code') return true;

  const hints = getElementHints(el);
  if (OTP_FIELD_PATTERN.test(hints)) return true;

  if (el instanceof HTMLInputElement) {
    const ml = Number(el.maxLength || 0);
    const numericMode = ['numeric','decimal','tel'].includes((el.inputMode||'').toLowerCase())
                     || ['tel','number'].includes((el.type||'').toLowerCase());
    if (numericMode && ml >= 4 && ml <= 8) return true;

    // Workday-style tiny single-char slots
    const rect = el.getBoundingClientRect();
    const tiny = rect.width > 0 && rect.width <= 90 && (ml === 1 || ml === 0);
    if (tiny) {
      const ctx = (document.title + ' ' + (document.querySelector('h1,h2,[class*="heading"],[class*="title"]')?.textContent || '')).toLowerCase();
      if (/confirm.*identity|verify.*identity|verification\s*code|enter.*code|security\s*code|one.time/i.test(ctx)) return true;
    }
  }
  return false;
}

function hasOtpSectionText() {
  return OTP_SECTION_PATTERN.test(document.body?.innerText || document.body?.textContent || '');
}

function findVisibleOtpField() {
  const sectionField = findOtpInputFromSection();
  if (sectionField) return sectionField;

  for (const el of document.querySelectorAll('input')) {
    if (isLikelyOtpField(el) && isVisibleElement(el) && !el.disabled && !el.readOnly) return el;
  }

  if (!hasOtpSectionText()) return null;
  const singleCharInputs = sortByDom([...document.querySelectorAll('input')]
    .filter(isSingleCharInput));
  if (singleCharInputs.length >= 4) return singleCharInputs[0];
  return null;
}

function findOtpInputFromSection() {
  if (!hasOtpSectionText()) return null;

  const textEls = [...document.querySelectorAll('label, legend, h1, h2, h3, p, div, span')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return text.length <= 500 && OTP_SECTION_PATTERN.test(text);
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });

  const labelRect = textEls[0]?.getBoundingClientRect();
  const candidates = sortByDom([...document.querySelectorAll('input')]
    .filter(el => {
      if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly || !isVisibleElement(el)) return false;
      const type = (el.type || 'text').toLowerCase();
      if (!['text', 'tel', 'number', 'password', 'search'].includes(type)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 140 || rect.height < 20) return false;
      if (labelRect && rect.top < labelRect.top - 20) return false;
      return true;
    }));

  const rows = new Map();
  for (const input of candidates) {
    const r = input.getBoundingClientRect();
    const key = Math.round(r.top / 24);
    const row = rows.get(key) || [];
    row.push(input);
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    const sorted = sortByDom(row);
    if (sorted.length >= 4) return sorted[0];
  }

  return candidates[0] || null;
}

function isSingleCharInput(el) {
  if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly || !isVisibleElement(el)) return false;
  const ml = Number(el.maxLength || 0);
  const type = (el.type || 'text').toLowerCase();
  const mode = (el.inputMode || '').toLowerCase();
  const rect = el.getBoundingClientRect();
  const visual = rect.width > 0 && rect.width <= 115;
  const numeric = ['numeric','decimal','tel'].includes(mode) || ['tel','number','password'].includes(type);
  if (numeric && (ml === 1 || el.size === 1 || visual)) return true;
  if (type === 'text' && ml === 1 && visual) return true;
  if (hasOtpSectionText() && ['text','tel','password','number'].includes(type) && visual && (ml === 0 || ml === 1)) return true;
  return false;
}

function sortByDom(els) {
  return els.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

function findSplitInputs(active, otp) {
  if (!(active instanceof HTMLInputElement) || !isSingleCharInput(active)) return [];
  const containers = [
    active.closest('form'), active.closest("[role='group']"), active.closest('fieldset'),
    active.parentElement, active.parentElement?.parentElement, active.parentElement?.parentElement?.parentElement
  ].filter(Boolean);

  for (const c of containers) {
    const cands = sortByDom([...c.querySelectorAll('input')].filter(isSingleCharInput));
    if (cands.length >= otp.length && cands.includes(active)) return cands.slice(0, otp.length);
  }

  const all = sortByDom([...document.querySelectorAll('input')].filter(isSingleCharInput));
  const idx = all.indexOf(active);
  if (idx === -1) return [];
  const nearby = all.slice(Math.max(0, idx - otp.length + 1), idx + otp.length);
  const activeRect = active.getBoundingClientRect();
  const sameRow = nearby.filter(c => {
    const r = c.getBoundingClientRect();
    return Math.abs(r.top - activeRect.top) < Math.max(activeRect.height, r.height) * 2.5;
  });
  return sameRow.length >= otp.length ? sortByDom(sameRow).slice(0, otp.length) : [];
}

// ═════════════════════════════════════════════════════════════════════════════
// OTP FILL
// ═════════════════════════════════════════════════════════════════════════════

function setNativeValue(el, value) {
  if (el.isContentEditable) { el.textContent = value; return; }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  try { setter?.call(el, value); } catch { try { el.value = value; } catch {} }
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertReplacementText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));
}

function getProfileFieldHints(el) {
  const associatedLabels = [];
  if (el.id) {
    associatedLabels.push(...[...document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)]
      .map(label => label.textContent || ''));
  }
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) associatedLabels.push(wrappingLabel.textContent || '');
  const labelledBy = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent || '')
    .join(' ');
  return normalizeText([
    el.id,
    el.name,
    el.type,
    el.autocomplete,
    el.placeholder,
    el.getAttribute('aria-label'),
    el.getAttribute('data-testid'),
    labelledBy,
    ...associatedLabels,
  ].filter(Boolean).join(' ')).replace(/\*/g, '');
}

function correctedProfileValue(el) {
  const current = String(el.value || el.textContent || '').trim();
  const hints = getProfileFieldHints(el);
  const staleName = /\bpradhan\b|\bsharma\b/i.test(current);
  const staleEmail = /pacerswithprettyfeet|prettyfeet/i.test(current);
  const staleLinkedin = /linkedin\.com\/in\/pradhan-sharma-a1b98a397/i.test(current);
  const stalePhone = current.replace(/\D/g, '') === '14049006692';

  if (/\b(?:current|present)\s+(?:company|employer|organization|organisation)\b/.test(hints) ||
      /\bwhat is your current company\b/.test(hints)) {
    return PROFILE_CORRECTIONS.currentCompany;
  }
  if (/\b(?:referral|referrer)\s*(?:name|full name)\b/.test(hints) ||
      /\bname of (?:your |the )?(?:referral|referrer|person who referred)\b/.test(hints) ||
      /\bwho referred you\b/.test(hints)) {
    return PROFILE_CORRECTIONS.referralName;
  }
  if (staleEmail || (/\bemail\b/.test(hints) && current && current !== PROFILE_CORRECTIONS.email)) {
    return PROFILE_CORRECTIONS.email;
  }
  if (staleLinkedin ||
      (/\blinkedin\b/.test(hints) && current && current !== PROFILE_CORRECTIONS.linkedin)) {
    return PROFILE_CORRECTIONS.linkedin;
  }
  if (stalePhone ||
      (/\b(phone|mobile|telephone|tel)\b/.test(hints) && current &&
       current.replace(/\D/g, '') !== PROFILE_CORRECTIONS.phone)) {
    return PROFILE_CORRECTIONS.phone;
  }
  if (staleName) {
    if (/\b(first|given)\s*name\b/.test(hints)) return PROFILE_CORRECTIONS.firstName;
    if (/\b(last|family|surname)\b/.test(hints)) return PROFILE_CORRECTIONS.lastName;
    return PROFILE_CORRECTIONS.fullName;
  }
  if (/\bfull\s*name\b/.test(hints) && current && current !== PROFILE_CORRECTIONS.fullName) {
    return PROFILE_CORRECTIONS.fullName;
  }
  return '';
}

function correctStaleProfileFields() {
  if (!profileCorrectionReady || !profileCorrectionEnabled) return;
  const controls = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
  )];
  for (const el of controls) {
    if (el.disabled || el.readOnly) continue;
    const corrected = correctedProfileValue(el);
    if (!corrected || String(el.value || el.textContent || '').trim() === corrected) continue;
    setNativeValue(el, corrected);
    dispatchInputEvents(el);
    console.log(`[JobRight Auto-Skip] corrected stale profile field: ${getProfileFieldHints(el)}`);
  }
}

function scheduleProfileCorrection(delay = 120) {
  if (!profileCorrectionReady || !profileCorrectionEnabled) return;
  clearTimeout(profileCorrectionTimer);
  profileCorrectionTimer = setTimeout(() => {
    correctStaleProfileFields();
    ensureUsCountryCode();
    ensureAtlantaLocation();
  }, delay);
}

function isGreenhousePage() {
  return /(^|\.)greenhouse\.io$/i.test(location.hostname);
}

function isEmptyCountryControl(control) {
  const text = normalizeText([
    control.value,
    control.textContent,
    control.getAttribute?.('aria-label'),
    control.getAttribute?.('data-value'),
  ].filter(Boolean).join(' '));
  return !text ||
    /^(select|select a country|country|choose country|please select)$/.test(text) ||
    /\bselect a country\b/.test(text);
}

function isPendingUsCountryControl(control) {
  const text = normalizeText([
    control.value,
    control.textContent,
    control.getAttribute?.('aria-label'),
    control.getAttribute?.('data-value'),
  ].filter(Boolean).join(' '));
  return /^united(?: s(?:t(?:a(?:t(?:e)?)?)?)?)?$/.test(text);
}

function getCountryOptionText(el) {
  return normalizeText([
    el.textContent,
    el.value,
    el.getAttribute?.('aria-label'),
    el.getAttribute?.('data-value'),
    el.getAttribute?.('title'),
  ].filter(Boolean).join(' '));
}

function scoreUsCountryOption(el) {
  const text = getCountryOptionText(el);
  if (!text ||
      /^(select|select a country|country|choose country|please select)$/.test(text)) {
    return -1;
  }

  const hasUnitedStates = /\bunited states(?: of america)?\b/.test(text);
  const hasUsa = /(?:^|[\s(,/-])u\.?s\.?a\.?(?:$|[\s),/+:-])/.test(text);
  const hasUs = /(?:^|[\s(,/-])u\.?s\.?(?:$|[\s),/+:-])/.test(text);
  const hasAmerica = /\b(?:america|american)\b/.test(text);
  const hasUsFlag = text.includes('🇺🇸');
  const hasPlusOne = /(?:^|[\s(])\+?1(?:$|[\s)])/.test(text);
  const namesAnotherCountry =
    /\b(?:canada|dominican republic|puerto rico|jamaica|bahamas|barbados|bermuda|grenada|guam|haiti|trinidad|tobago|virgin islands)\b/.test(text);

  if (namesAnotherCountry) return -1;

  let score = 0;
  if (hasUnitedStates) score += 120;
  if (hasUsa) score += 110;
  if (hasUs) score += 100;
  if (hasUsFlag) score += 100;
  if (hasAmerica) score += 70;
  if (hasPlusOne) score += 35;
  if (/^(?:\+?1|🇺🇸\s*\+?1)$/.test(text)) score += 45;
  return score;
}

function findBestUsCountryOption(options) {
  return options
    .map((option, index) => ({ option, index, score: scoreUsCountryOption(option) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.option || null;
}

function selectUsCountryFromOpenDropdown(control) {
  const controlledId = control?.getAttribute('aria-controls') ||
    control?.getAttribute('aria-owns');
  const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
  const optionRoot = controlledRoot && isVisibleElement(controlledRoot)
    ? controlledRoot
    : document;
  const options = [...optionRoot.querySelectorAll(
    '[role="option"], [role="menuitem"], li, button, [data-value]'
  )].filter(el =>
    el !== control &&
    isVisibleElement(el) &&
    !el.disabled &&
    !el.closest?.('[aria-hidden="true"]')
  );
  const option = findBestUsCountryOption(options);
  if (!option) return false;
  if (isChoiceControlSelected(option)) return true;
  option.click();
  console.log(`[JobRight Auto-Skip] selected US country option: ${getCountryOptionText(option).slice(0, 120)}`);
  return true;
}

function ensureUsCountryCode() {
  if (!profileCorrectionReady || !profileCorrectionEnabled) return false;

  const countryControls = [...document.querySelectorAll('select, button, [role="combobox"], [aria-haspopup="listbox"]')]
    .filter(el => {
      if (!isVisibleElement(el) || el.disabled) return false;
      const hints = normalizeText([
        el.id,
        el.name,
        el.getAttribute('aria-label'),
        el.getAttribute('aria-labelledby'),
        labelTextForControl(el),
        el.closest('fieldset, [class*="field"], [class*="question"], div')?.textContent,
      ].filter(Boolean).join(' '));
      // Match any visible empty "country" control (phone country code OR standalone country field)
      return /\bcountry\b/.test(hints) &&
        (isEmptyCountryControl(el) ||
          isPendingUsCountryControl(el) ||
          el.getAttribute('aria-expanded') === 'true');
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  for (const control of countryControls) {
    if (control instanceof HTMLSelectElement) {
      const option = findBestUsCountryOption([...control.options]);
      if (!option) continue;
      control.value = option.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[JobRight Auto-Skip] selected US country option: ${getCountryOptionText(option).slice(0, 120)}`);
      return true;
    }

    if (selectUsCountryFromOpenDropdown(control)) return true;
    if (control.getAttribute('aria-expanded') === 'true') {
      setTimeout(() => selectUsCountryFromOpenDropdown(control), 100);
      setTimeout(() => selectUsCountryFromOpenDropdown(control), 350);
      return true;
    }

    control.click();
    setTimeout(() => selectUsCountryFromOpenDropdown(control), 100);
    setTimeout(() => selectUsCountryFromOpenDropdown(control), 350);
    setTimeout(() => selectUsCountryFromOpenDropdown(control), 800);
    return true;
  }
  return false;
}

function isLocationCityControl(control) {
  const hints = normalizeText([
    control.id,
    control.name,
    control.placeholder,
    control.getAttribute?.('aria-label'),
    control.getAttribute?.('aria-labelledby'),
    labelTextForControl(control),
  ].filter(Boolean).join(' '));
  return /\blocation\s*\(?city\)?\b/.test(hints) ||
    /\bcity\s*(?:and|\/|,)?\s*(?:state|location)\b/.test(hints);
}

function isExactAtlantaLocation(text = '') {
  const normalized = normalizeText(text);
  const target = normalizeText(PROFILE_CORRECTIONS.locationCity);
  if (normalized === target) return true;
  return normalized.startsWith(target) &&
    normalized.split(target).join('').trim() === '';
}

function selectAtlantaFromOpenDropdown(control) {
  const controlledId = control?.getAttribute('aria-controls') ||
    control?.getAttribute('aria-owns');
  const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
  const optionRoot = controlledRoot && isVisibleElement(controlledRoot)
    ? controlledRoot
    : document;
  const option = [...optionRoot.querySelectorAll(
    '[role="option"], [role="menuitem"], li, button, [data-value]'
  )].find(el =>
    el !== control &&
    isVisibleElement(el) &&
    !el.disabled &&
    isExactAtlantaLocation(getChoiceControlText(el))
  );
  if (!option) return false;
  if (!isChoiceControlSelected(option)) option.click();
  console.log('[JobRight Auto-Skip] selected Atlanta, Georgia, United States');
  return true;
}

function ensureAtlantaLocation() {
  if (!profileCorrectionReady || !profileCorrectionEnabled) return false;
  const controls = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"], [aria-haspopup="listbox"]'
  )]
    .filter(el => isVisibleElement(el) && !el.disabled && isLocationCityControl(el))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  for (const control of controls) {
    const current = String(control.value || control.textContent || '').trim();
    if (isExactAtlantaLocation(current)) return true;

    if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find(item =>
        isExactAtlantaLocation(`${item.textContent || ''} ${item.value || ''}`)
      );
      if (!option) continue;
      control.value = option.value;
      dispatchInputEvents(control);
      console.log('[JobRight Auto-Skip] selected Atlanta, Georgia, United States');
      return true;
    }

    if (selectAtlantaFromOpenDropdown(control)) return true;
    const isAutocomplete = control.getAttribute?.('role') === 'combobox' ||
      !!control.getAttribute?.('aria-autocomplete') ||
      !!control.getAttribute?.('aria-controls');
    setNativeValue(
      control,
      isAutocomplete ? 'Atlanta' : PROFILE_CORRECTIONS.locationCity,
    );
    dispatchInputEvents(control);
    control.click?.();
    setTimeout(() => selectAtlantaFromOpenDropdown(control), 150);
    setTimeout(() => selectAtlantaFromOpenDropdown(control), 500);
    setTimeout(() => selectAtlantaFromOpenDropdown(control), 900);
    return true;
  }
  return false;
}

function isRecruitingCommunicationsQuestion(text = '') {
  const normalized = normalizeText(text);
  const channel =
    /\b(sms|text messages?|texting|mobile messages?|email communications?|marketing communications?|recruitment communications?|recruiter updates?)\b/.test(normalized);
  const recruitingContext =
    /\b(receive|opt[- ]?in|permission|consent|recruiter|recruiting|recruitment|hiring|job opportunities|career advice|recruitment events?|interview requests?|reminders?|updates?)\b/.test(normalized);
  return channel && recruitingContext;
}

function isSponsorshipQuestion(text = '') {
  const normalized = normalizeText(text);
  if (/\b(without|do not need|don['’]?t need|no)\s+(?:visa\s+)?sponsorship\b/.test(normalized) &&
      /\b(authori[sz]ed|authorization|eligible|work)\b/.test(normalized)) {
    return false;
  }
  return /\b(sponsor(?:ship|ed)?|visa sponsorship)\b/.test(normalized) &&
    /\b(require|need|now|future|employment|work)\b/.test(normalized);
}

function isWorkAuthorizationQuestion(text = '') {
  const normalized = normalizeText(text);
  if (/\b(authori[sz]ed|authorization|eligible|legal right)\b/.test(normalized) &&
      /\bwithout\s+(?:visa\s+)?sponsorship\b/.test(normalized)) {
    return true;
  }
  if (isSponsorshipQuestion(normalized)) return false;
  return /\b(authori[sz]ed|authorization|legally eligible|legal right)\b/.test(normalized) &&
    /\b(work|employment|united states|u\.?s\.?|country)\b/.test(normalized);
}

function isAccuracyAffirmationQuestion(text = '') {
  const normalized = normalizeText(text);
  const accuracy =
    /\b(?:responses?|information|statements?|answers?|application)\b/.test(normalized) &&
    /\b(?:accurate|truthful|true|complete|correct)\b/.test(normalized);
  const consequence =
    /\b(?:falsification|false information|misrepresentation)\b/.test(normalized) &&
    /\b(?:disqualification|withdrawal|termination|result in|may result)\b/.test(normalized);
  const affirmation =
    /\b(?:i affirm|i certify|i acknowledge|i understand|i agree)\b/.test(normalized);
  return affirmation && (accuracy || consequence);
}

function chooseYesForAccuracyAffirmations() {
  return chooseBooleanAnswerForQuestion(
    isAccuracyAffirmationQuestion,
    'yes',
    'application accuracy affirmation',
  );
}

function claimBooleanAnswerClick(root, desiredAnswer, ruleName) {
  const promptText = typeof root === 'string'
    ? normalizeText(root)
    : getQuestionPromptText(root) ||
      normalizeText(root?.innerText || root?.textContent || '');
  const clickLock = `${ruleName}|${desiredAnswer}|${promptText}`.slice(0, 800);
  if (booleanAnswerClickLocks.has(clickLock)) return false;
  booleanAnswerClickLocks.add(clickLock);
  return true;
}

function selectYesFromOpenCommunicationsDropdown(dropdown) {
  const controlledId = dropdown?.getAttribute('aria-controls') ||
    dropdown?.getAttribute('aria-owns');
  const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
  const optionRoot = controlledRoot && isVisibleElement(controlledRoot)
    ? controlledRoot
    : document;
  const yesOption = [...optionRoot.querySelectorAll(
    '[role="option"], [role="menuitem"], li, [data-value]'
  )].find(el =>
    isVisibleElement(el) &&
    !el.disabled &&
    /^(yes|true|agree|consent|opt in)\b/.test(getChoiceControlText(el))
  );
  if (!yesOption) return false;
  if (!isChoiceControlSelected(yesOption)) yesOption.click();
  console.log('[JobRight Auto-Skip] selected Yes for recruiting communications');
  return true;
}

function chooseYesForRecruitingCommunications() {
  const questionRoots = [...document.querySelectorAll(
    'fieldset, [role="radiogroup"], [role="group"], [class*="field"], [class*="question"], section, form, div'
  )]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const text = normalizeText(el.innerText || el.textContent || '');
      return text.length >= 30 && text.length <= 1800 && isRecruitingCommunicationsQuestion(text);
    })
    .sort((a, b) => {
      const aText = normalizeText(a.innerText || a.textContent || '').length;
      const bText = normalizeText(b.innerText || b.textContent || '').length;
      return aText - bText;
    });

  for (const root of questionRoots) {
    const radios = [...root.querySelectorAll('input[type="radio"]')];
    const yesRadio = radios.find(radio => {
      const label = radio.id
        ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)
        : radio.closest('label');
      const text = normalizeText(`${radio.value || ''} ${radio.getAttribute('aria-label') || ''} ${label?.textContent || ''}`);
      return /^(yes|true|agree|consent|opt in)\b/.test(text);
    });
    if (yesRadio) {
      if (yesRadio.checked) return true;
      if (!claimBooleanAnswerClick(root, 'yes', 'recruiting communications opt-in')) return true;
      const label = yesRadio.id
        ? document.querySelector(`label[for="${CSS.escape(yesRadio.id)}"]`)
        : yesRadio.closest('label');
      (label || yesRadio).click();
      yesRadio.dispatchEvent(new Event('input', { bubbles: true }));
      yesRadio.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[JobRight Auto-Skip] selected Yes for recruiting communications');
      return true;
    }

    const select = root.querySelector('select');
    if (select) {
      const yesOption = [...select.options].find(option =>
        /^(yes|true|agree|consent|opt in)\b/.test(normalizeText(`${option.textContent || ''} ${option.value || ''}`))
      );
      if (yesOption) {
        if (select.value === yesOption.value) return true;
        if (!claimBooleanAnswerClick(root, 'yes', 'recruiting communications opt-in')) return true;
        select.value = yesOption.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[JobRight Auto-Skip] selected Yes for recruiting communications');
        return true;
      }
    }

    const dropdown = [...root.querySelectorAll(
      '[role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
    )].find(el => isVisibleElement(el) && !el.disabled);
    if (dropdown) {
      const currentValue = normalizeText(
        `${dropdown.value || ''} ${dropdown.textContent || ''} ${dropdown.getAttribute('data-value') || ''}`
      );
      if (/^(yes|true|agree|consent|opt in)\b/.test(currentValue)) return true;
      if (selectYesFromOpenCommunicationsDropdown(dropdown)) return true;
      if (!claimBooleanAnswerClick(root, 'yes', 'recruiting communications opt-in')) return true;
      dropdown.click();
      setTimeout(() => selectYesFromOpenCommunicationsDropdown(dropdown), 150);
      setTimeout(() => selectYesFromOpenCommunicationsDropdown(dropdown), 500);
      return true;
    }

    const yesControl = [...root.querySelectorAll('button, [role="radio"], [role="option"], [role="button"], label')]
      .find(el => {
        if (!isVisibleElement(el) || el.disabled) return false;
        return /^(yes|agree|consent|opt in)$/.test(normalizeText(el.textContent || el.getAttribute('aria-label') || ''));
      });
    if (yesControl) {
      if (isChoiceControlSelected(yesControl)) return true;
      if (!claimBooleanAnswerClick(root, 'yes', 'recruiting communications opt-in')) return true;
      yesControl.click();
      console.log('[JobRight Auto-Skip] selected Yes for recruiting communications');
      return true;
    }
  }
  return false;
}

function scheduleRecruitingCommunicationsOptIn(delay = 150) {
  clearTimeout(smsOptOutTimer);
  smsOptOutTimer = setTimeout(chooseYesForRecruitingCommunications, delay);
}

function isRelocationEligibilityQuestion(text = '') {
  const normalized = normalizeText(text);
  if (isSponsorshipQuestion(normalized) || isWorkAuthorizationQuestion(normalized)) return false;
  const locationAndOfficeAttendance =
    /\b(?:located|based|live|living|reside)\b.{0,100}\b(?:able|willing|available)\b.{0,100}\b(?:come|report|work)\b.{0,40}\b(?:office|on[- ]site|onsite|in[- ]person)\b/.test(normalized);
  const officeProximity =
    /\b(?:live|living|located|based|reside|residing|local)\b.{0,100}\b(?:commut(?:e|able|ing)|driving|travel)\s+(?:distance|range|radius|time)\b/.test(normalized) ||
    /\bwithin\b.{0,60}\b(?:commut(?:e|able|ing)|driving|travel)\s+(?:distance|range|radius|time)\b/.test(normalized) ||
    /\b(?:near|nearby|close to|proximity to|local to|within \d+\s*(?:miles?|minutes?|hours?)(?: of)?)\b.{0,100}\b(?:office|location|site|headquarters|hq|[a-z .'-]+,\s*[a-z]{2})\b/.test(normalized);
  const locationOrAttendance =
    /\b(relocat(?:e|ion)|hybrid|in[- ]person|in(?:to)? (?:the |our )?office|office|on[- ]site|onsite|commut(?:e|able|ing)|local to|located in|living in|reside within|metropolitan area)\b/.test(normalized);
  const commitment =
    /\b(willing|able|available|currently|position|role|work|travel|live|living|located|reside|commute|come in|report to|days? a week|mon(?:day)?\s*[-–]\s*fri(?:day)?)\b/.test(normalized);
  const onsiteSchedule =
    /\b(?:schedule|work arrangement|working arrangement|work model)\b/.test(normalized) &&
    /\b(?:on[- ]site|onsite|in[- ]person|in(?:to)? (?:the |our )?office|hybrid|remotely?|remote)\b/.test(normalized) &&
    /\b(?:work for you|works for you|does this|agree|accept|comfortable|able|willing|days? (?:a|per) week)\b/.test(normalized);
  return locationAndOfficeAttendance ||
    officeProximity ||
    onsiteSchedule ||
    (locationOrAttendance && commitment);
}

function fillYesForRelocationFreeText() {
  const controls = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'
  )].filter(el => isVisibleElement(el) && !el.disabled && !el.readOnly);

  for (const control of controls) {
    const prompt = normalizeText([
      getProfileFieldHints(control),
      labelTextForControl(control),
    ].join(' '));
    if (prompt.length > 1200 || !isRelocationEligibilityQuestion(prompt)) continue;
    if (String(control.value || control.textContent || '').trim().toLowerCase() === 'yes') return true;
    setNativeValue(control, 'Yes');
    dispatchInputEvents(control);
    console.log('[JobRight Auto-Skip] filled Yes for free-text location/in-office schedule question');
    return true;
  }
  return false;
}

function isPreviousEmployeeQuestion(text = '') {
  const normalized = normalizeText(text);
  return /\b(?:previous(?:ly)?|formerly?|former)\b.{0,60}\b(?:employee|employed|worked|work)\b/.test(normalized) ||
    /\b(?:employee|employed|worked|work)\b.{0,60}\b(?:previous(?:ly)?|formerly?|before|in the past)\b/.test(normalized) ||
    /\bhave you (?:ever )?worked (?:for|at|with) (?:us|this company|our company)\b/.test(normalized);
}

function chooseNoForPreviousEmployeeQuestions() {
  if (chooseBooleanAnswerForQuestion(
    isPreviousEmployeeQuestion,
    'no',
    'previous employee question',
  )) return true;

  const roots = [...document.querySelectorAll(
    'fieldset, [role="group"], [class*="field"], [class*="question"], section, div'
  )]
    .filter(root => {
      if (!isVisibleElement(root)) return false;
      const prompt = getQuestionPromptText(root);
      return prompt.length >= 10 &&
        prompt.length <= 900 &&
        isPreviousEmployeeQuestion(prompt) &&
        !!root.querySelector(
          'select, [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
        );
    })
    .sort((a, b) =>
      normalizeText(a.innerText || a.textContent || '').length -
      normalizeText(b.innerText || b.textContent || '').length
    );

  for (const root of roots) {
    const select = root.querySelector('select');
    if (select) {
      const noOption = [...select.options].find(option =>
        /^(no|false)\b/.test(normalizeText(`${option.textContent || ''} ${option.value || ''}`))
      );
      if (!noOption || select.value === noOption.value) return !!noOption;
      if (!claimBooleanAnswerClick(root, 'no', 'previous employee question')) return true;
      select.value = noOption.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[JobRight Auto-Skip] selected no for previous employee question');
      return true;
    }

    const dropdown = [...root.querySelectorAll(
      '[role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
    )].find(el => isVisibleElement(el) && !el.disabled);
    if (!dropdown) continue;
    const current = normalizeText(
      `${dropdown.value || ''} ${dropdown.textContent || ''} ${dropdown.getAttribute('data-value') || ''}`
    );
    if (/^(no|false)\b/.test(current)) return true;
    if (!claimBooleanAnswerClick(root, 'open-no-dropdown', 'previous employee question')) return true;
    dropdown.click();
    const selectNo = () => {
      const noOption = [...document.querySelectorAll(
        '[role="option"], [role="menuitem"], li, [data-value]'
      )].find(el =>
        isVisibleElement(el) &&
        !el.disabled &&
        /^(no|false)\b/.test(getChoiceControlText(el))
      );
      if (noOption) noOption.click();
    };
    setTimeout(selectNo, 150);
    setTimeout(selectNo, 500);
    return true;
  }
  return false;
}

function isChoiceControlSelected(control) {
  if (!control) return false;
  if (control instanceof HTMLInputElement) {
    return (control.type === 'radio' || control.type === 'checkbox') && control.checked;
  }
  if (
    control.getAttribute('aria-checked') === 'true' ||
    control.getAttribute('aria-selected') === 'true' ||
    control.getAttribute('aria-pressed') === 'true' ||
    control.getAttribute('data-state') === 'checked'
  ) return true;

  const className = String(control.className || '').toLowerCase();
  if (/\b(selected|active|checked|chosen)\b/.test(className)) return true;

  try {
    const match = getComputedStyle(control).backgroundColor
      .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
    if (!match || Number(match[4] ?? 1) < 0.2) return false;
    const channels = [Number(match[1]), Number(match[2]), Number(match[3])];
    return Math.max(...channels) - Math.min(...channels) >= 45;
  } catch {
    return false;
  }
}

function getChoiceControlText(control) {
  if (!control) return '';
  const labels = [];
  if (control.id) {
    labels.push(...[...document.querySelectorAll(`label[for="${CSS.escape(control.id)}"]`)]
      .map(label => label.textContent || ''));
  }
  labels.push(
    control.value || '',
    control.getAttribute?.('aria-label') || '',
    control.textContent || '',
    control.closest?.('label')?.textContent || '',
  );
  return normalizeText(labels.join(' '));
}

function getQuestionPromptText(root) {
  if (!root) return '';
  const chunks = [];
  const skipSelector =
    'input, select, option, button, [role="radio"], [role="option"], [role="button"], script, style';

  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.nodeValue || '');
      if (text) chunks.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (el.matches?.(skipSelector)) return;
    if (el.matches?.('label')) {
      const labelText = normalizeText(el.textContent || '');
      if (/^(yes|no|true|false|prefer not|i['’]?m not sure)\b/.test(labelText)) return;
    }
    for (const child of el.childNodes) visit(child);
  };

  visit(root);
  return normalizeText(chunks.join(' '));
}

function findMinimalYesNoQuestionRoots(predicate) {
  return [...document.querySelectorAll(
    'fieldset, [role="radiogroup"], [role="group"], [class*="field"], [class*="question"], section, div'
  )]
    .filter(root => {
      if (!isVisibleElement(root)) return false;
      const promptText = getQuestionPromptText(root);
      if (promptText.length < 15 || promptText.length > 900 || !predicate(promptText)) return false;
      const controls = [...root.querySelectorAll(
        'input[type="radio"], select, [role="radio"], button, [role="button"]'
      )].filter(el => isVisibleElement(el) && !el.disabled);
      const labels = controls.map(getChoiceControlText);
      return labels.some(label => /^(yes|true)\b/.test(label)) &&
        labels.some(label => /^(no|false)\b/.test(label));
    })
    .filter(root => ![...root.children].some(child => {
      if (!isVisibleElement(child)) return false;
      const promptText = getQuestionPromptText(child);
      if (!predicate(promptText)) return false;
      const labels = [...child.querySelectorAll(
        'input[type="radio"], select, [role="radio"], button, [role="button"]'
      )].filter(el => isVisibleElement(el) && !el.disabled).map(getChoiceControlText);
      return labels.some(label => /^(yes|true)\b/.test(label)) &&
        labels.some(label => /^(no|false)\b/.test(label));
    }))
    .sort((a, b) =>
      normalizeText(a.innerText || a.textContent || '').length -
      normalizeText(b.innerText || b.textContent || '').length
    );
}

function findRelocationQuestionRoots() {
  const yesNoRoots = findMinimalYesNoQuestionRoots(isRelocationEligibilityQuestion);
  const dropdownRoots = [...document.querySelectorAll(
    'fieldset, [role="group"], [class*="field"], [class*="question"], section, div'
  )]
    .filter(root => {
      if (!isVisibleElement(root)) return false;
      const promptText = getQuestionPromptText(root);
      if (promptText.length < 15 ||
          promptText.length > 900 ||
          !isRelocationEligibilityQuestion(promptText)) return false;
      return [...root.querySelectorAll(
        'select, [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
      )].some(el => isVisibleElement(el) && !el.disabled);
    });

  return [...new Set([...yesNoRoots, ...dropdownRoots])]
    .filter(root => ![...root.children].some(child => {
      if (!isVisibleElement(child)) return false;
      const promptText = getQuestionPromptText(child);
      return isRelocationEligibilityQuestion(promptText) &&
        !!child.querySelector(
          'input[type="radio"], select, [role="radio"], [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
        );
    }))
    .sort((a, b) =>
      normalizeText(a.innerText || a.textContent || '').length -
      normalizeText(b.innerText || b.textContent || '').length
    );
}

function scoreRelocationOptionText(text = '') {
  const normalized = normalizeText(text);
  const commitsToRelocate =
    /\b(?:would|will|can|willing|able|prepared)\b.{0,50}\b(?:relocat\w*|move)\b/.test(normalized);
  if (!normalized ||
      /^(select|choose|please select|none|n\/a|not applicable)\b/.test(normalized) ||
      (!commitsToRelocate &&
        /\b(?:do not|don['’]?t|cannot|can['’]?t|unable|not willing|decline|no)\b.{0,65}\b(?:relocat\w*|commut\w*|meet|office|onsite|hybrid|requirement)\b/.test(normalized)) ||
      /\b(?:not within commuting distance|outside commuting distance)\b.{0,100}\b(?:do not|don['’]?t|no plan|without plans?)\b/.test(normalized)) {
    return -1;
  }

  let score = 0;
  if (/^(yes|true)\b/.test(normalized)) score += 100;
  if (/\b(?:would|will|can|willing|able|available|agree|prepared|plan)\b/.test(normalized)) score += 35;
  if (/\b(?:meet|satisfy|fulfill)\b.{0,35}\b(?:in[- ]office|office|onsite|hybrid|commut|requirement)\b/.test(normalized)) score += 45;
  if (/\b(?:relocat(?:e|ing|ion)|move)\b/.test(normalized)) score += 55;
  if (/\b(?:before|by)\b.{0,35}\b(?:start date|starting|start|first day)\b/.test(normalized)) score += 35;
  if (/\b(?:commuting distance|commute|in[- ]office|office|onsite|hybrid)\b/.test(normalized)) score += 25;
  if (/\bcurrently (?:live|living|located|reside)\b/.test(normalized) &&
      /\b(?:commuting distance|local|near|nearby)\b/.test(normalized)) {
    score += 30;
  }
  return score;
}

function findBestRelocationOption(options) {
  return options
    .map((option, index) => ({
      option,
      index,
      score: scoreRelocationOptionText(getChoiceControlText(option)),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.option || null;
}

function selectYesFromOpenDropdown(root, dropdown) {
  const promptText = getQuestionPromptText(root);
  const controlledId = dropdown?.getAttribute('aria-controls') ||
    dropdown?.getAttribute('aria-owns');
  const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
  const optionRoot = controlledRoot && isVisibleElement(controlledRoot)
    ? controlledRoot
    : document;
  const options = [...optionRoot.querySelectorAll(
    '[role="option"], [role="menuitem"], li, [data-value]'
  )]
    .filter(el => isVisibleElement(el) && !el.disabled);
  const option = findBestRelocationOption(options);
  if (!option) return false;
  if (isChoiceControlSelected(option)) return true;
  if (!claimBooleanAnswerClick(promptText, 'affirmative-option', 'relocation dropdown')) return true;
  option.click();
  console.log(
    `[JobRight Auto-Skip] selected affirmative in-office/relocation option: ${getChoiceControlText(option).slice(0, 180)}`
  );
  return true;
}

function chooseBooleanAnswerForQuestion(predicate, desiredAnswer, logLabel) {
  const desiredPattern = desiredAnswer === 'yes' ? /^(yes|true)\b/ : /^(no|false)\b/;
  const roots = findMinimalYesNoQuestionRoots(predicate);

  for (const root of roots) {
    const promptText = getQuestionPromptText(root);
    const radios = [...root.querySelectorAll('input[type="radio"]')];
    const desiredRadio = radios.find(radio => desiredPattern.test(getChoiceControlText(radio)));
    if (desiredRadio) {
      if (desiredRadio.checked) return true;
      if (!claimBooleanAnswerClick(root, desiredAnswer, logLabel)) return true;
      const label = desiredRadio.id
        ? document.querySelector(`label[for="${CSS.escape(desiredRadio.id)}"]`)
        : desiredRadio.closest('label');
      (label || desiredRadio).click();
      desiredRadio.dispatchEvent(new Event('input', { bubbles: true }));
      desiredRadio.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[JobRight Auto-Skip] selected ${desiredAnswer} for ${logLabel}`);
      return true;
    }

    const select = root.querySelector('select');
    if (select) {
      const option = [...select.options].find(item =>
        desiredPattern.test(normalizeText(`${item.textContent || ''} ${item.value || ''}`))
      );
      if (option) {
        if (select.value === option.value) return true;
        if (!claimBooleanAnswerClick(root, desiredAnswer, logLabel)) return true;
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[JobRight Auto-Skip] selected ${desiredAnswer} for ${logLabel}`);
        return true;
      }
    }

    const control = [...root.querySelectorAll(
      '[role="radio"], button, [role="button"]'
    )]
      .filter(el => isVisibleElement(el) && !el.disabled)
      .find(el => desiredPattern.test(getChoiceControlText(el)));
    if (!control) continue;
    if (isChoiceControlSelected(control)) return true;
    if (!claimBooleanAnswerClick(root, desiredAnswer, logLabel)) return true;
    control.click();
    console.log(`[JobRight Auto-Skip] selected ${desiredAnswer} for ${logLabel}`);
    return true;
  }
  return false;
}

function correctWorkEligibilityAnswers() {
  const authorizationFixed = chooseBooleanAnswerForQuestion(
    isWorkAuthorizationQuestion,
    'yes',
    'work authorization question',
  );
  const sponsorshipFixed = chooseBooleanAnswerForQuestion(
    isSponsorshipQuestion,
    'no',
    'visa sponsorship question',
  );
  return sponsorshipFixed || authorizationFixed;
}

function scheduleWorkEligibilityAnswers(delay = 100) {
  clearTimeout(workEligibilityAnswerTimer);
  workEligibilityAnswerTimer = setTimeout(correctWorkEligibilityAnswers, delay);
}

function chooseYesForRelocationQuestions() {
  if (fillYesForRelocationFreeText()) return true;
  if (chooseBooleanAnswerForQuestion(
    isRelocationEligibilityQuestion,
    'yes',
    'location/in-office availability question',
  )) return true;

  const questionRoots = findRelocationQuestionRoots();

  for (const root of questionRoots) {
    const questionSignature = getQuestionPromptText(root).slice(0, 500);
    const lastAttemptAt = relocationAnswerAttempts.get(questionSignature) || 0;
    if (Date.now() - lastAttemptAt < 30_000) continue;

    const radios = [...root.querySelectorAll('input[type="radio"]')];
    const yesRadio = radios.find(radio => {
      const label = radio.id
        ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)
        : radio.closest('label');
      return /^(yes|true|willing|able)\b/.test(normalizeText(
        `${radio.value || ''} ${radio.getAttribute('aria-label') || ''} ${label?.textContent || ''}`
      ));
    });
    if (yesRadio) {
      if (yesRadio.checked) continue;
      if (!claimBooleanAnswerClick(root, 'yes', 'relocation eligibility')) return true;
      const label = yesRadio.id
        ? document.querySelector(`label[for="${CSS.escape(yesRadio.id)}"]`)
        : yesRadio.closest('label');
      (label || yesRadio).click();
      yesRadio.dispatchEvent(new Event('input', { bubbles: true }));
      yesRadio.dispatchEvent(new Event('change', { bubbles: true }));
      relocationAnswerAttempts.set(questionSignature, Date.now());
      console.log('[JobRight Auto-Skip] selected Yes for relocation/in-person question');
      return true;
    }

    const select = root.querySelector('select');
    if (select) {
      const yesOption = findBestRelocationOption([...select.options]);
      if (yesOption) {
        if (select.value === yesOption.value) continue;
        if (!claimBooleanAnswerClick(root, 'affirmative-option', 'relocation eligibility')) return true;
        select.value = yesOption.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        relocationAnswerAttempts.set(questionSignature, Date.now());
        console.log(
          `[JobRight Auto-Skip] selected affirmative relocation/in-person option: ${getChoiceControlText(yesOption).slice(0, 180)}`
        );
        return true;
      }
    }

    const dropdown = [...root.querySelectorAll(
      '[role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
    )].find(el => isVisibleElement(el) && !el.disabled);
    if (dropdown) {
      const value = normalizeText(
        `${dropdown.value || ''} ${dropdown.textContent || ''} ${dropdown.getAttribute('data-value') || ''}`
      );
      if (scoreRelocationOptionText(value) > 0 && isChoiceControlSelected(dropdown)) continue;
      if (!claimBooleanAnswerClick(root, 'open-affirmative-dropdown', 'relocation eligibility')) return true;
      dropdown.click();
      setTimeout(() => selectYesFromOpenDropdown(root, dropdown), 150);
      setTimeout(() => selectYesFromOpenDropdown(root, dropdown), 500);
      return true;
    }

    const customControls = [...root.querySelectorAll(
      '[role="radio"], [role="option"], button, [role="button"], label'
    )].filter(el => isVisibleElement(el) && !el.disabled);
    const yesControl = findBestRelocationOption(customControls);
    if (yesControl) {
      if (isChoiceControlSelected(yesControl)) continue;
      if (!claimBooleanAnswerClick(root, 'affirmative-option', 'relocation eligibility')) return true;
      yesControl.click();
      relocationAnswerAttempts.set(questionSignature, Date.now());
      console.log(
        `[JobRight Auto-Skip] selected affirmative relocation/in-person option: ${getChoiceControlText(yesControl).slice(0, 180)}`
      );
      return true;
    }
  }
  return false;
}

function scheduleRelocationAnswer(delay = 180) {
  clearTimeout(relocationAnswerTimer);
  relocationAnswerTimer = setTimeout(chooseYesForRelocationQuestions, delay);
}

function autofillOtp(otp, source = document.activeElement) {
  // Find the best target: active element if it's an OTP field, otherwise scan
  let target = isOtpFillTarget(source) ? source : null;
  if (!target) {
    // Find the first visible OTP field on the page
    target = findVisibleOtpField();
  }
  if (!target || !document.contains(target)) return false;

  const split = findSplitInputs(target, otp);
  if (split.length >= otp.length) {
    split.forEach((inp, i) => {
      inp.focus();
      setNativeValue(inp, otp[i] || '');
      dispatchInputEvents(inp);
    });
    split[Math.min(otp.length, split.length) - 1]?.focus();
  } else {
    target.focus();
    setNativeValue(target, otp);
    dispatchInputEvents(target);
  }

  removeOtpStatus();
  console.log(`[JobRight Auto-Skip] OTP filled: ${otp}`);
  return true;
}

function recordFilledOtp(res = {}) {
  lastFilledOtp = String(res.otp || '').trim();
  lastFilledOtpMessageId = String(res.messageId || '').trim();
}

function findSubmitButton() {
  return [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      const text = `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      return r.width > 0 && r.height > 0 && text.includes('submit');
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
}

function clickSubmitAfterOtp() {
  let attempts = 0;
  const tryClick = () => {
    attempts++;
    const btn = findSubmitButton();
    const disabled = !btn ||
      btn.disabled ||
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.className?.toString().toLowerCase().includes('disabled');

    if (!disabled) {
      btn.scrollIntoView({ block: 'center', inline: 'center' });
      btn.click();
      console.log('[JobRight Auto-Skip] Submit clicked after OTP');
      return;
    }

    if (attempts < 12) setTimeout(tryClick, 300);
  };
  setTimeout(tryClick, 400);
}

function clickSubmitButton() {
  const btn = findSubmitButton();
  const disabled = !btn ||
    btn.disabled ||
    btn.getAttribute('aria-disabled') === 'true' ||
    btn.className?.toString().toLowerCase().includes('disabled');
  if (disabled) return false;
  btn.scrollIntoView({ block: 'center', inline: 'center' });
  btn.click();
  lastSubmitAttemptAt = Date.now();
  return true;
}

function isControlResolved(control) {
  if (!control || control.disabled) return false;
  if (control instanceof HTMLInputElement) {
    if (control.type === 'file') return !!control.files?.length;
    if (control.type === 'radio' || control.type === 'checkbox') return control.checked;
    return !!String(control.value || '').trim();
  }
  if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
    return !!String(control.value || '').trim();
  }
  return control.getAttribute?.('aria-checked') === 'true' ||
    control.getAttribute?.('aria-selected') === 'true' ||
    control.getAttribute?.('aria-pressed') === 'true';
}

function isReportedMissingFieldResolved(fieldText) {
  const container = findFieldContainer(fieldText);
  if (!container) return false;
  const controls = [...container.querySelectorAll(
    'input, textarea, select, [role="radio"], [role="checkbox"], [role="option"], [aria-checked], [aria-selected]'
  )].filter(el => !el.disabled);
  if (!controls.length) return false;

  const radios = controls.filter(el => el instanceof HTMLInputElement && el.type === 'radio');
  if (radios.length && !radios.some(radio => radio.checked)) return false;
  const fileInputs = controls.filter(el => el instanceof HTMLInputElement && el.type === 'file');
  if (fileInputs.length && !fileInputs.some(input => input.files?.length)) return false;

  const valueControls = controls.filter(el =>
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement &&
      !['hidden', 'radio', 'checkbox', 'file', 'button', 'submit'].includes(el.type))
  );
  if (valueControls.length && !valueControls.some(isControlResolved)) return false;

  return radios.length > 0 ||
    fileInputs.length > 0 ||
    valueControls.length > 0 ||
    controls.some(isControlResolved);
}

function scheduleSubmitAfterVerifiedJobrightRepair(fields, delay = 1200) {
  const normalizedFields = (fields || []).filter(Boolean).slice(0, 12);
  const signature = normalizedFields.map(normalizeText).join('|');
  if (!signature) return;
  const startedAt = Date.now();
  clearTimeout(jobrightRepairSubmitTimer);

  const verifyAndSubmit = () => {
    if (Date.now() - startedAt > 30_000) return;
    if (Date.now() - latestJobrightMissingFieldsAt > 30_000) return;
    if (signature !== latestJobrightMissingFields.map(normalizeText).join('|')) return;
    if (!normalizedFields.every(isReportedMissingFieldResolved)) {
      jobrightRepairSubmitTimer = setTimeout(verifyAndSubmit, 1000);
      return;
    }
    if (signature === lastJobrightRepairSubmitSignature &&
        Date.now() - lastJobrightRepairSubmitAt < 30_000) return;
    if (!clickSubmitButton()) return;
    lastJobrightRepairSubmitSignature = signature;
    lastJobrightRepairSubmitAt = Date.now();
    console.log('[JobRight Auto-Skip] submitted once after all JobRight-reported missing fields were verified filled');
  };

  jobrightRepairSubmitTimer = setTimeout(verifyAndSubmit, delay);
}

function isManualEditField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['hidden', 'file', 'submit', 'button', 'reset', 'checkbox', 'radio'].includes((el.type || 'text').toLowerCase()) &&
    !isLikelyOtpField(el);
}

function manualEditSignature(el) {
  return normalizeText([
    el.id,
    el.name,
    el.getAttribute?.('aria-label'),
    labelTextForControl(el),
    el.value || el.textContent || '',
  ].filter(Boolean).join('|')).slice(0, 500);
}

function scheduleSubmitAfterManualEdit(el, delay = 1200, attempt = 0) {
  if (!validationRetryEnabled || !isManualEditField(el) || !manuallyEditedFields.has(el)) return;
  clearTimeout(manualEditSubmitTimer);
  const signature = manualEditSignature(el);
  manualEditSubmitTimer = setTimeout(() => {
    const active = document.activeElement;
    if (isManualEditField(active) && active !== el) return;
    if (manualEditSignature(el) !== signature) return;
    if (!signature || signature === lastManualEditSubmitSignature) return;
    if (Date.now() - lastManualEditSubmitAt < 5_000) return;
    if (!clickSubmitButton()) {
      if (attempt < 8) scheduleSubmitAfterManualEdit(el, 500, attempt + 1);
      return;
    }
    lastManualEditSubmitSignature = signature;
    lastManualEditSubmitAt = Date.now();
    manuallyEditedFields.delete(el);
    console.log('[JobRight Auto-Skip] submitted once after manual field edit');
  }, delay);
}

document.addEventListener('input', (event) => {
  if (!event.isTrusted || !isManualEditField(event.target)) return;
  manuallyEditedFields.add(event.target);
  scheduleSubmitAfterManualEdit(event.target, 2500);
}, true);

document.addEventListener('change', (event) => {
  if (!event.isTrusted || !isManualEditField(event.target)) return;
  manuallyEditedFields.add(event.target);
  scheduleSubmitAfterManualEdit(event.target);
}, true);

document.addEventListener('focusout', (event) => {
  if (!event.isTrusted || !isManualEditField(event.target)) return;
  scheduleSubmitAfterManualEdit(event.target);
}, true);

document.addEventListener('focusin', (event) => {
  if (event.isTrusted && isManualEditField(event.target)) clearTimeout(manualEditSubmitTimer);
}, true);

function normalizeText(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanCompanyHint(value = '') {
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

  const titleAtCompany = text.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 .,&'’:+-]{2,90})$/i);
  if (titleAtCompany && /\b(product|program|project|manager|owner|lead|director|engineer|analyst|role|position|household)\b/i.test(text)) {
    text = titleAtCompany[1];
  }

  return text
    .replace(/^\s*(?:for|at)\s*,?\s*/i, ' ')
    .replace(/\b(?:greenhouse recruiting|application site|security code|verification code|job application|job application started|autofill|skip|senior|sr\.?|technical|data|ai|product|program|project|manager|owner|lead|director|remote|hybrid|onsite|full-time)\b/gi, ' ')
    .replace(/\b(?:incorporated|inc\.?|llc|l\.l\.c\.|corp\.?|corporation|company)\b$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function getOtpCompanyHints() {
  const hints = [];
  const add = (value) => {
    const cleaned = cleanCompanyHint(value);
    if (!cleaned || cleaned.length < 3) return;
    if (/^(greenhouse|greenhouse recruiting|lever|ashby|jobright|bubble|application site)$/i.test(cleaned)) return;
    if (!hints.some(h => h.toLowerCase() === cleaned.toLowerCase())) hints.push(cleaned);
  };

  add(document.title);
  document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(meta => add(meta.content));
  [...document.querySelectorAll('img[alt], h1, h2, h3, [class*="logo"], [class*="company"], [data-testid*="company"]')]
    .filter(el => isVisibleElement(el))
    .slice(0, 18)
    .forEach(el => add(el.getAttribute('alt') || el.textContent || ''));

  const bodyText = document.body?.innerText || document.body?.textContent || '';
  [
    /\bapplication\s+to\s+([A-Za-z0-9 .,&'’:+-]{2,90})/i,
    /\bapplying\s+to\s+([A-Za-z0-9 .,&'’:+-]{2,90})/i,
    /\bthank you(?:\s+\w+){0,5}\s+for applying\s+to\s+([A-Za-z0-9 .,&'’:+-]{2,90})/i,
    /\bview more jobs at\s+([A-Za-z0-9 .,&'’:+-]{2,90})/i,
    /\babout\s+([A-Za-z0-9 .,&'’:+-]{2,90})(?:,?\s+(?:inc|llc|corp|corporation|company)\b|[.\n])/i,
  ].forEach(re => {
    const match = bodyText.match(re);
    if (match?.[1]) add(match[1]);
  });

  return hints.slice(0, 10);
}

function getValidationErrorElements() {
  const candidates = [...document.querySelectorAll(
    '[role="alert"], [class*="error"], [class*="alert"], [class*="validation"], [class*="correction"], [class*="danger"], a, li, div, p, span'
  )]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      const text = normalizeText(el.textContent);
      return text &&
        (text.includes('your form needs corrections') ||
         text.includes('missing entry for required field') ||
         (isValidationAlertElement(el) &&
           (text.includes('required field') || text.includes('is required'))));
    });
  return candidates.filter(el => ![...el.querySelectorAll('*')].some(descendant =>
    candidates.includes(descendant) &&
    normalizeText(descendant.textContent).includes('missing entry for required field')
  ));
}

function getImpactedFieldText(errorEl) {
  const link = errorEl.querySelector?.('a') || (errorEl.matches?.('a') ? errorEl : null);
  const text = (link?.textContent || errorEl.textContent || '').trim();
  return text
    .replace(/missing entry for required field:?/i, '')
    .replace(/your form needs corrections/i, '')
    .replace(/please .*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getImpactedFieldTexts(errorEl) {
  const links = [...(errorEl.querySelectorAll?.('a') || [])]
    .map(link => (link.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (links.length) return links;
  const fieldText = getImpactedFieldText(errorEl);
  return fieldText ? [fieldText] : [];
}

function isValidationAlertElement(el) {
  const text = normalizeText(el.textContent);
  const role = (el.getAttribute?.('role') || '').toLowerCase();
  return role === 'alert' ||
    /error|alert|validation|correction|danger/.test(el.className?.toString().toLowerCase() || '') ||
    text.includes('your form needs corrections') ||
    text.includes('missing entry for required field');
}

function findFieldContainer(fieldText) {
  if (!fieldText) return null;
  const wanted = normalizeText(fieldText)
    .replace(/\*/g, '')
    .replace(/[?.!:;,]+$/g, '')
    .trim();
  const normalizePrompt = value => normalizeText(value)
    .replace(/\*/g, '')
    .replace(/[?.!:;,]+$/g, '')
    .trim();
  const fieldControls = root => [...root.querySelectorAll(
    'input, textarea, select, button, [role="radio"], [role="checkbox"], [role="combobox"], [role="textbox"]'
  )].filter(el => isVisibleElement(el) && !el.disabled);
  const nearestQuestionContainer = label => {
    let node = label;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      if (node.matches?.('form')) break;
      const controls = fieldControls(node);
      if (!controls.length) continue;
      const text = normalizePrompt(node.textContent || '');
      if (text.includes(wanted) && text.length <= Math.max(wanted.length + 160, 260)) {
        return node;
      }
    }
    return null;
  };
  const exactControls = [...document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"]')]
    .filter(el => {
      if (!isVisibleElement(el) || el.disabled || el.readOnly) return false;
      const hints = normalizePrompt([
        el.id, el.name, el.placeholder, el.getAttribute('aria-label'),
        el.getAttribute('aria-labelledby'), el.getAttribute('aria-describedby'),
        labelTextForControl(el),
      ].filter(Boolean).join(' '));
      return hints.includes(wanted);
    });
  if (exactControls[0]) {
    return nearestQuestionContainer(exactControls[0]) ||
      exactControls[0].closest('fieldset, section, [role="group"], [class*="field"], [class*="question"]') ||
      exactControls[0].parentElement?.parentElement ||
      exactControls[0].parentElement;
  }

  const labels = [...document.querySelectorAll('label, legend, [aria-label], h1, h2, h3, div, p, span')]
    .filter(el => {
      if (!isVisibleElement(el)) return false;
      if (el.closest?.('[role="alert"], [class*="error"], [class*="alert"], [class*="validation"], [class*="correction"], [class*="danger"]')) return false;
      if (isValidationAlertElement(el)) return false;
      const text = normalizePrompt(el.textContent);
      return text.includes(wanted) && text.length <= Math.max(wanted.length + 100, 160);
    });

  const label = labels.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.height - br.height || ar.top - br.top;
  })[0];
  if (!label) return null;

  return nearestQuestionContainer(label) ||
    label.closest('fieldset, section, [role="group"], [class*="field"], [class*="question"]') ||
    label.parentElement?.parentElement ||
    label.parentElement;
}

function nudgeField(fieldText, errorEl) {
  const container = findFieldContainer(fieldText);
  if (!container) return false;
  container.scrollIntoView({ block: 'center', inline: 'nearest' });

  const isFileChooserControl = (el) => {
    if (el instanceof HTMLInputElement && el.type === 'file') return true;
    const text = normalizeText(`${el.textContent || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''}`);
    if (/(upload|attach|choose file|resume|cv|cover letter)/.test(text)) return true;
    const forId = el.getAttribute?.('for');
    if (forId) {
      const control = document.getElementById(forId);
      if (control instanceof HTMLInputElement && control.type === 'file') return true;
    }
    return !!el.closest?.('label')?.querySelector?.('input[type="file"]');
  };

  const isNudgeCandidate = (el) =>
    isVisibleElement(el) && !el.disabled && !el.readOnly && !isFileChooserControl(el);

  const checkedControl = [...container.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')]
    .find(el => !el.disabled && !isFileChooserControl(el));
  if (checkedControl) {
    checkedControl.click();
    setNativeChecked(checkedControl, true);
    checkedControl.dispatchEvent(new Event('input', { bubbles: true }));
    checkedControl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const isDarkBackground = (el) => {
    try {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      // Perceived luminance — treat anything darker than mid-grey as "selected"
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    } catch { return false; }
  };

  const selected = [...container.querySelectorAll('input:checked, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"], button, [role="button"]')]
    .filter(isNudgeCandidate)
    .find(el => {
      if (el.matches?.('input:checked, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]')) return true;
      const text = normalizeText(el.textContent);
      return text && (
        isChoiceControlSelected(el) ||
        isDarkBackground(el) ||
        el.className?.toString().toLowerCase().includes('selected')
      );
    });

  if (selected) {
    selected.click();
    selected.dispatchEvent(new Event('input', { bubbles: true }));
    selected.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const target = [...container.querySelectorAll('input, textarea, select')]
    .filter(isNudgeCandidate)
    .find(el => {
      if (el instanceof HTMLInputElement &&
          ['radio', 'checkbox', 'button', 'submit', 'reset'].includes(el.type)) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !!el.value;
      if (el instanceof HTMLSelectElement) return !!el.value;
      return false;
    });

  if (!target) return false;
  target.click?.();
  target.focus?.();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    if (target instanceof HTMLSelectElement) {
      const selectedIndex = target.selectedIndex;
      if (selectedIndex >= 0) target.selectedIndex = selectedIndex;
    } else {
      setNativeValue(target, target.value);
    }
    dispatchInputEvents(target);
    target.blur?.();
    target.focus?.();
  } else {
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function labelTextForControl(el) {
  const labels = [];
  if (el.id) labels.push(...[...document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)].map(l => l.textContent || ''));
  const label = el.closest('label');
  if (label) labels.push(label.textContent || '');
  const container = el.closest('fieldset, [role="group"], [class*="field"], [class*="question"], div');
  if (container) labels.push(container.textContent || '');
  return labels.join(' ');
}

function isRequiredAgreementQuestion(root) {
  const rawText = root?.innerText || root?.textContent || '';
  const text = normalizeText(rawText);
  const agreement = /\b(?:affirm|agree|agreement|consent|acknowledge|understand|certify|confirm|accurate|truthful|falsification|terms|privacy|by checking this box)\b/.test(text);
  const mandatory = rawText.includes('*') ||
    /\b(?:required|this field is required|must|please accept|to proceed)\b/.test(text) ||
    !!root?.querySelector?.('[required], [aria-required="true"]');
  return agreement && mandatory;
}

function scoreRequiredAgreementOption(text = '') {
  const normalized = normalizeText(text);
  if (!normalized ||
      /^(select|choose|please select|none|n\/a|not applicable)\b/.test(normalized) ||
      /\b(?:do not|don['’]?t|decline|disagree|not agree|refuse|no)\b/.test(normalized)) {
    return -1;
  }

  let score = 0;
  if (/^yes\b/.test(normalized)) score += 70;
  if (/\baffirm\b/.test(normalized)) score += 55;
  if (/\bunderstand\b/.test(normalized)) score += 40;
  if (/\bagree\b/.test(normalized)) score += 60;
  if (/\b(?:acknowledge|accept|consent|certify|confirm)\b/.test(normalized)) score += 45;
  return score;
}

function findBestRequiredAgreementOption(options) {
  return options
    .map((option, index) => ({
      option,
      index,
      score: scoreRequiredAgreementOption(getChoiceControlText(option)),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.option || null;
}

function selectRequiredAgreementFromOpenDropdown(root, dropdown) {
  const controlledId = dropdown?.getAttribute('aria-controls') ||
    dropdown?.getAttribute('aria-owns');
  const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
  const optionRoot = controlledRoot && isVisibleElement(controlledRoot)
    ? controlledRoot
    : document;
  const options = [...optionRoot.querySelectorAll(
    '[role="option"], [role="menuitem"], li, [data-value]'
  )].filter(el => isVisibleElement(el) && !el.disabled);
  const option = findBestRequiredAgreementOption(options);
  if (!option) return false;
  if (isChoiceControlSelected(option)) return true;
  if (!claimBooleanAnswerClick(root, 'agree-option', 'required agreement dropdown')) return true;
  option.click();
  console.log(
    `[JobRight Auto-Skip] selected required agreement option: ${getChoiceControlText(option).slice(0, 180)}`
  );
  return true;
}

function chooseRequiredAgreementDropdowns() {
  const roots = [...document.querySelectorAll(
    'fieldset, [role="group"], [class*="field"], [class*="question"], section, div'
  )]
    .filter(root => {
      if (!isVisibleElement(root) || !isRequiredAgreementQuestion(root)) return false;
      return !!root.querySelector(
        'select, [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
      );
    })
    .filter(root => ![...root.children].some(child =>
      isVisibleElement(child) &&
      isRequiredAgreementQuestion(child) &&
      !!child.querySelector(
        'select, [role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
      )
    ))
    .sort((a, b) =>
      normalizeText(a.innerText || a.textContent || '').length -
      normalizeText(b.innerText || b.textContent || '').length
    );

  for (const root of roots) {
    const select = root.querySelector('select');
    if (select) {
      const option = findBestRequiredAgreementOption([...select.options]);
      if (!option) continue;
      if (select.value === option.value) return true;
      if (!claimBooleanAnswerClick(root, 'agree-option', 'required agreement dropdown')) return true;
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(
        `[JobRight Auto-Skip] selected required agreement option: ${getChoiceControlText(option).slice(0, 180)}`
      );
      return true;
    }

    const dropdown = [...root.querySelectorAll(
      '[role="combobox"], button[aria-haspopup="listbox"], [aria-haspopup="listbox"]'
    )].find(el => isVisibleElement(el) && !el.disabled);
    if (!dropdown) continue;
    const currentValue = normalizeText(
      `${dropdown.value || ''} ${dropdown.textContent || ''} ${dropdown.getAttribute('data-value') || ''}`
    );
    if (scoreRequiredAgreementOption(currentValue) > 0) return true;
    if (!claimBooleanAnswerClick(root, 'open-agreement-dropdown', 'required agreement dropdown')) return true;
    dropdown.click();
    setTimeout(() => selectRequiredAgreementFromOpenDropdown(root, dropdown), 150);
    setTimeout(() => selectRequiredAgreementFromOpenDropdown(root, dropdown), 500);
    return true;
  }
  return false;
}

function checkRequiredAgreements() {
  const boxes = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')]
    .filter(el => !el.disabled && getVisibleCheckboxClickTarget(el));

  for (const box of boxes) {
    const checked = box.checked || box.getAttribute('aria-checked') === 'true';
    const rawText = checkboxContextText(box);
    const text = normalizeText(rawText);
    const consentish = /\b(i affirm|i agree|agree to|accurate|truthful|falsification|terms and conditions|terms & conditions|terms of use|terms of service|accept the terms|privacy polic(?:y|ies)|privacy notice|confirm|acknowledge|certify|consent to|by checking this box)\b/.test(text);
    const mandatory = /\b(required|this field is required|must|please accept|to proceed|proceed)\b/.test(text) || rawText.includes('*');
    if (!consentish || !mandatory) continue;
    if (/\bconsent to\b/.test(text) && !/\b(collect|store|process|processing|demographic|terms|privacy|proceed)\b/.test(text)) continue;
    if (checked && !/\bthis field is required\b/.test(text)) continue;

    if (!checked) {
      const clickTarget = getVisibleCheckboxClickTarget(box) || box;
      clickTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
      clickTarget.click();
      if (box instanceof HTMLInputElement && !box.checked) setNativeChecked(box, true);
      if (!(box instanceof HTMLInputElement) && box.getAttribute('aria-checked') !== 'true') {
        box.setAttribute('aria-checked', 'true');
      }
    }
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[JobRight Auto-Skip] checked required agreement checkbox');
  }
  chooseRequiredAgreementDropdowns();
}

function getVisibleCheckboxClickTarget(box) {
  if (isVisibleElement(box)) return box;
  const candidates = [];
  if (box.id) {
    candidates.push(...document.querySelectorAll(`label[for="${CSS.escape(box.id)}"]`));
  }
  const wrappingLabel = box.closest?.('label');
  if (wrappingLabel) candidates.push(wrappingLabel);
  let node = box.parentElement;
  for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
    candidates.push(
      ...node.querySelectorAll('label, [role="checkbox"], [class*="checkbox"], [class*="check-box"]')
    );
  }
  return candidates.find(el => isVisibleElement(el)) || null;
}

function checkboxContextText(box) {
  const chunks = [labelTextForControl(box)];
  const describedBy = (box.getAttribute?.('aria-describedby') || '').split(/\s+/).filter(Boolean);
  describedBy.forEach(id => chunks.push(document.getElementById(id)?.textContent || ''));
  const label = box.closest?.('label');
  if (label) chunks.push(label.textContent || '');
  const visibleTarget = getVisibleCheckboxClickTarget(box);
  if (visibleTarget && visibleTarget !== box) chunks.push(visibleTarget.textContent || '');
  let node = box.parentElement;
  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    const text = node.textContent || '';
    if (text.length <= 2200) chunks.push(text);
  }
  return chunks.join(' ');
}

function setNativeChecked(input, checked) {
  try {
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
    if (desc?.set) desc.set.call(input, checked);
    else input.checked = checked;
  } catch (_) {
    input.checked = checked;
  }
}

function scheduleTermsCheckboxCheck() {
  clearTimeout(termsCheckboxTimer);
  termsCheckboxTimer = setTimeout(checkRequiredAgreements, 400);
}

function isResumeFieldText(value = '') {
  const text = normalizeText(value).replace(/\*/g, '');
  return /(?:^|\b)(resume(?:\s*\/\s*cv)?|curriculum vitae|cv)(?:\b|$)/.test(text) &&
    !/\bcover letter\b/.test(text);
}

function isCoverLetterFieldText(value = '') {
  const text = normalizeText(value).replace(/\*/g, '');
  return /\bcover\s*letter\b/.test(text);
}

function deepQueryAll(selector, root = document) {
  const results = [];
  const visit = currentRoot => {
    results.push(...currentRoot.querySelectorAll(selector));
    currentRoot.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return [...new Set(results)];
}

function isResumeRequiredMissing() {
  const text = normalizeText(document.body?.innerText || document.body?.textContent || '');
  if (Date.now() - jobrightResumeMissingAt < 30_000) return true;
  if (
    /\b(?:resume(?:\s*\/\s*cv)?|curriculum vitae|cv)\s+(?:is\s+)?(?:required|missing)\b/.test(text) ||
    /\bmissing entry for required field:\s*(?:resume(?:\s*\/\s*cv)?|curriculum vitae|cv)\b/.test(text) ||
    /\bplease\s+(?:attach|upload|provide|add)\s+(?:a|your)?\s*(?:resume|curriculum vitae|cv)\b/.test(text)
  ) return true;

  return deepQueryAll('input[type="file"]').some(input => {
    if (input.files?.length) return false;
    return isResumeFileInput(input) && (
      input.required ||
      input.getAttribute('aria-required') === 'true' ||
      input.getAttribute('aria-invalid') === 'true'
    );
  });
}

function getResumeInputHints(input, includeNearby = true) {
  const root = input.getRootNode?.() || document;
  const getTextById = id => root.getElementById?.(id)?.textContent ||
    document.getElementById(id)?.textContent ||
    '';
  const labelledBy = (input.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(getTextById)
    .join(' ');
  const describedBy = (input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(getTextById)
    .join(' ');
  let nearbyText = '';
  if (includeNearby) {
    let node = input.parentElement;
    for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
      const nodeText = node.textContent || '';
      if (nodeText.length <= 1200) nearbyText += ` ${nodeText}`;
      if (isResumeFieldText(nodeText) || /\bcover letter\b/i.test(nodeText)) break;
    }
  }
  return [
    input.id,
    input.name,
    input.accept,
    input.getAttribute('aria-label'),
    input.getAttribute('data-testid'),
    input.getAttribute('data-qa'),
    input.getAttribute('data-field'),
    labelledBy,
    describedBy,
    input.closest('label')?.textContent,
    nearbyText,
  ].filter(Boolean).join(' ');
}

function isResumeFileInput(input) {
  const directHints = normalizeText(getResumeInputHints(input, false));
  if (isResumeFieldText(directHints)) return true;
  return isResumeFieldText(normalizeText(getResumeInputHints(input, true)));
}

function isCoverLetterFileInput(input) {
  const directHints = normalizeText(getResumeInputHints(input, false));
  if (isCoverLetterFieldText(directHints)) return true;
  const nearbyHints = normalizeText(getResumeInputHints(input, true));
  return isCoverLetterFieldText(nearbyHints) && !isResumeFieldText(nearbyHints);
}

function findResumeFileInput() {
  const inputs = deepQueryAll('input[type="file"]')
    .filter(input => !input.disabled && !input.files?.length);
  const resumeInputs = inputs.filter(isResumeFileInput);
  return resumeInputs[0] || inputs.find(input => {
    const accept = normalizeText(input.accept);
    const hints = normalizeText(getResumeInputHints(input));
    return inputs.length === 1 &&
      (accept.includes('pdf') || accept.includes('document') || !accept) &&
      !/\bcover letter\b/.test(hints);
  }) || null;
}

function findCoverLetterFileInput() {
  return deepQueryAll('input[type="file"]')
    .filter(input => !input.disabled && !input.files?.length)
    .find(isCoverLetterFileInput) || null;
}

function hasCoverLetterValidationError() {
  const text = normalizeText(document.body?.innerText || document.body?.textContent || '');
  return /\bmissing entry for required field:\s*cover\s*letter\b/.test(text) ||
    /\bcover\s*letter\s+(?:is\s+)?(?:required|missing)\b/.test(text) ||
    /\bplease\s+(?:attach|upload|provide|add)\s+(?:a|your)?\s*cover\s*letter\b/.test(text);
}

function isCoverLetterRequiredMissing() {
  if (Date.now() - jobrightCoverLetterMissingAt < 30_000) return true;
  if (hasCoverLetterValidationError()) return true;

  return deepQueryAll('input[type="file"]').some(input => {
    if (input.files?.length || !isCoverLetterFileInput(input)) return false;
    return input.required ||
      input.getAttribute('aria-required') === 'true' ||
      input.getAttribute('aria-invalid') === 'true';
  });
}

function setFileInputFiles(input, files) {
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, files);
    else input.files = files;
    return input.files?.length === files.length;
  } catch (_) {
    return false;
  }
}

async function uploadFallbackResumeIfNeeded() {
  if (resumeFallbackUploaded || !isResumeRequiredMissing()) return;

  const input = findResumeFileInput();
  if (!input) return;

  const res = await fetch(chrome.runtime.getURL(FALLBACK_RESUME_PATH));
  if (!res.ok) return;
  const blob = await res.blob();
  const file = new File([blob], FALLBACK_RESUME_NAME, { type: 'application/pdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  if (!setFileInputFiles(input, transfer.files)) return;

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  await new Promise(resolve => setTimeout(resolve, 500));
  if (!input.files?.length) {
    resumeFallbackAttempts++;
    if (resumeFallbackAttempts < 3) scheduleFallbackResumeUpload(500);
    return;
  }

  resumeFallbackUploaded = true;
  resumeFallbackAttempts = 0;
  console.log('[JobRight Auto-Skip] attached standard fallback resume to missing Resume/CV field');
  if (latestJobrightMissingFields.some(field => isResumeFieldText(field))) {
    scheduleSubmitAfterVerifiedJobrightRepair(latestJobrightMissingFields);
  }
}

function scheduleFallbackResumeUpload(delay = 700) {
  clearTimeout(resumeFallbackTimer);
  resumeFallbackTimer = setTimeout(() => uploadFallbackResumeIfNeeded().catch(() => {}), delay);
}

async function uploadFallbackCoverLetterIfNeeded() {
  if (coverLetterFallbackUploaded || !isCoverLetterRequiredMissing()) return;

  const input = findCoverLetterFileInput();
  if (!input) return;
  const shouldRetrySubmit = hasCoverLetterValidationError() ||
    Date.now() - jobrightCoverLetterMissingAt < 30_000;

  const res = await fetch(chrome.runtime.getURL(FALLBACK_COVER_LETTER_PATH));
  if (!res.ok) return;
  const blob = await res.blob();
  const file = new File([blob], FALLBACK_COVER_LETTER_NAME, { type: 'application/pdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  if (!setFileInputFiles(input, transfer.files)) return;

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  await new Promise(resolve => setTimeout(resolve, 500));
  if (!input.files?.length) {
    coverLetterFallbackAttempts++;
    if (coverLetterFallbackAttempts < 3) scheduleFallbackCoverLetterUpload(500);
    return;
  }

  coverLetterFallbackUploaded = true;
  coverLetterFallbackAttempts = 0;
  console.log('[JobRight Auto-Skip] attached fallback cover letter to required Cover Letter field');
  if (latestJobrightMissingFields.some(field => isCoverLetterFieldText(field))) {
    scheduleSubmitAfterVerifiedJobrightRepair(latestJobrightMissingFields);
  } else if (shouldRetrySubmit) {
    setTimeout(clickSubmitButton, 1000);
  }
}

function scheduleFallbackCoverLetterUpload(delay = 700) {
  clearTimeout(coverLetterFallbackTimer);
  coverLetterFallbackTimer = setTimeout(
    () => uploadFallbackCoverLetterIfNeeded().catch(() => {}),
    delay,
  );
}

function retryValidationErrors() {
  if (!validationRetryEnabled) return;

  const jobrightKnows = latestJobrightMissingFields.length > 0 &&
    Date.now() - latestJobrightMissingFieldsAt <= 30_000;

  // ── PATH A: JobRight reported missing fields ─────────────────────────────
  // Nudge directly using the field names JobRight gave us. Does NOT require
  // an ATS error banner — the field may just not be registering as filled.
  if (jobrightKnows) {
    const sig = latestJobrightMissingFields.map(normalizeText).join('|').slice(0, 500);
    const count = validationRetryCounts.get(sig) || 0;
    if (count >= VALIDATION_RETRY_MAX) return;
    validationRetryCounts.set(sig, count + 1);

    let nudged = false;
    for (const fieldText of latestJobrightMissingFields) {
      if (nudgeField(fieldText, null)) nudged = true;
    }
    if (nudged) {
      console.log('[JobRight Auto-Skip] nudged missing fields reported by JobRight');
      scheduleSubmitAfterVerifiedJobrightRepair(latestJobrightMissingFields);
    }
    return;
  }

  // ── PATH B: ATS returned a validation error after a submit attempt ────────
  // A visible correction banner is explicit enough to repair even if JobRight
  // incorrectly reports every field as filled or the submit timestamp was lost.
  const recentSubmitAttempt = Date.now() - lastSubmitAttemptAt < 15_000;
  const errors = getValidationErrorElements();
  if (!errors.length) return;
  const hasExplicitCorrection = errors.some(error => {
    const text = normalizeText(error.textContent);
    return text.includes('your form needs corrections') ||
      text.includes('missing entry for required field');
  });
  if (!recentSubmitAttempt && !hasExplicitCorrection) return;

  const fieldTexts = [...new Set(errors
    .flatMap(getImpactedFieldTexts)
    .map(text => text.trim())
    .filter(Boolean))];
  const sig = fieldTexts.map(normalizeText).join('|').slice(0, 500);
  const count = validationRetryCounts.get(sig) || 0;
  if (count >= VALIDATION_RETRY_MAX) return;
  validationRetryCounts.set(sig, count + 1);

  let nudged = false;
  for (const fieldText of fieldTexts) {
    if (nudgeField(fieldText, null)) nudged = true;
  }
  if (nudged) {
    console.log('[JobRight Auto-Skip] nudged ATS validation field after failed submit attempt');
    clearTimeout(jobrightRepairSubmitTimer);
    jobrightRepairSubmitTimer = setTimeout(() => {
      if (clickSubmitButton()) {
        console.log('[JobRight Auto-Skip] retried submit once after ATS validation nudge');
      }
    }, 1500);
  }
}

function scheduleValidationRetry() {
  clearTimeout(validationRetryTimer);
  validationRetryTimer = setTimeout(retryValidationErrors, 500);
}

// ═════════════════════════════════════════════════════════════════════════════
// STATUS BADGE (inline feedback near the field)
// ═════════════════════════════════════════════════════════════════════════════

function removeOtpStatus() {
  otpStatusBadge?.remove();
  otpStatusBadge = null;
}

function showFieldStatus(message, input = document.activeElement, tone = 'neutral') {
  removeOtpStatus();
  if (!input || !isVisibleElement(input)) return;

  otpStatusBadge = document.createElement('div');
  otpStatusBadge.textContent = message;
  Object.assign(otpStatusBadge.style, {
    position: 'fixed', zIndex: '2147483647', padding: '5px 10px', borderRadius: '7px',
    background: tone === 'error' ? '#fef2f2' : tone === 'success' ? '#f0fdf4' : '#eef2ff',
    color: tone === 'error' ? '#991b1b' : tone === 'success' ? '#166534' : '#3730a3',
    border: `1px solid ${tone === 'error' ? '#fecaca' : tone === 'success' ? '#bbf7d0' : '#c7d2fe'}`,
    boxShadow: '0 6px 18px rgba(15,23,42,0.12)',
    font: '500 12px/1.4 system-ui, sans-serif', maxWidth: '320px', pointerEvents: 'none',
  });

  const rect = input.getBoundingClientRect();
  otpStatusBadge.style.top  = `${Math.min(rect.bottom + 6, window.innerHeight - 40)}px`;
  otpStatusBadge.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 340))}px`;

  document.body.appendChild(otpStatusBadge);
  if (tone === 'error' || tone === 'success') setTimeout(removeOtpStatus, 4000);
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTO POLLING (triggered when an OTP field receives focus)
// Concurrency: first poll snapshots existing message IDs so only NEW emails
// arriving AFTER the field was focused can fill the code.
// ═════════════════════════════════════════════════════════════════════════════

function stopAutoPolling() {
  clearTimeout(autoPollingTimer);
  autoPollingTimer = null;
}

function isInvalidated(err) {
  return err instanceof Error &&
    (err.message.includes('Extension context invalidated') ||
     err.message.includes('Cannot access a chrome'));
}

function sendAutoFetchMessage(ignoreMessageIds = [], baselineTimestamp = 0) {
  return new Promise(resolve => {
    try {
      const combinedIgnore = [...new Set([...(ignoreMessageIds || []), ...ignoredOtpMessageIds].filter(Boolean))];
      chrome.runtime.sendMessage({
        type: 'AUTO_FETCH_OTP',
        ignoreMessageIds: combinedIgnore,
        baselineTimestamp,
        companyHints: getOtpCompanyHints(),
      }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'Extension error' });
        } else {
          resolve(res || { ok: false, error: 'No response from background' });
        }
      });
    } catch (err) {
      if (isInvalidated(err)) stopAutoPolling();
      resolve({ ok: false, error: err.message || 'Extension error' });
    }
  });
}

function normalizeOtpValue(value = '') {
  return String(value).replace(/[\s-]+/g, '').trim().toLowerCase();
}

function shouldIgnoreOtpResult(res = {}) {
  const otp = normalizeOtpValue(res.otp || '');
  if (!otp) return false;
  if (ignoredOtpValues.has(otp)) {
    if (res.messageId && !ignoredOtpMessageIds.includes(res.messageId)) ignoredOtpMessageIds.push(res.messageId);
    return true;
  }
  return false;
}

function rememberSeenMessage(res, seenMessageIds) {
  if (res?.messageId && !seenMessageIds.includes(res.messageId)) seenMessageIds.push(res.messageId);
}

function formatOtpWaitStatus(res, attempt) {
  const reason = res?.error ? ` · ${String(res.error).replace(/\.$/, '')}` : '';
  return `Waiting for OTP email... (${attempt}/${AUTO_POLL_MAX_ATTEMPTS})${reason}`;
}

function startOtpPolling(activeElement, options = {}) {
  if (!activeElement) activeElement = findVisibleOtpField();
  if (!activeElement) return;
  const now = Date.now();
  if (!options.force && activeElement === lastAutoFetchElement && now - lastAutoFetchAt < AUTO_FETCH_COOLDOWN_MS) return;
  lastAutoFetchAt = now;
  lastAutoFetchElement = activeElement;
  stopAutoPolling();

  let attempt = 0;
  let seenMessageIds = [];
  let baselineTimestamp = 0;

  function poll() {
    attempt++;
    if (!document.contains(activeElement)) { stopAutoPolling(); removeOtpStatus(); return; }

    if (attempt === 1) {
      // Snapshot all existing message IDs — only new emails after this count
      showFieldStatus('Checking Gmail for OTP...', activeElement);
      sendAutoFetchMessage([]).then(firstRes => {
        seenMessageIds = firstRes?.seenMessageIds || [];
        baselineTimestamp = firstRes?.ok || firstRes?.seenMessageIds?.length ? Date.now() : 0;

        if (firstRes?.ok && firstRes.otp) {
          rememberSeenMessage(firstRes, seenMessageIds);
          if (shouldIgnoreOtpResult(firstRes)) {
            showFieldStatus(`Waiting for newer OTP email... (${attempt}/${AUTO_POLL_MAX_ATTEMPTS})`, activeElement);
            autoPollingTimer = setTimeout(poll, AUTO_POLL_INTERVAL_MS);
            return;
          }
          stopAutoPolling();
          const target = findVisibleOtpField() || activeElement;
          const filled = document.contains(target) && autofillOtp(firstRes.otp, target);
          if (filled) recordFilledOtp(firstRes);
          if (filled) clickSubmitAfterOtp();
          showFieldStatus(filled ? `OTP filled: ${firstRes.otp}` : `OTP found: ${firstRes.otp}`, activeElement, filled ? 'success' : 'error');
          return;
        }

        if (attempt >= AUTO_POLL_MAX_ATTEMPTS) {
          stopAutoPolling();
          showFieldStatus('No OTP found. Check Gmail manually.', activeElement, 'error');
          lastAutoFetchAt = 0;
          return;
        }
        showFieldStatus(formatOtpWaitStatus(firstRes, attempt), activeElement);
        autoPollingTimer = setTimeout(poll, AUTO_POLL_INTERVAL_MS);
      });
      return;
    }

    // Polls 2+: pass seenMessageIds and baselineTimestamp so already-seen emails
    // are excluded and only genuinely new emails can fill the code.
    showFieldStatus(`Checking Gmail... (${attempt}/${AUTO_POLL_MAX_ATTEMPTS})`, activeElement);
    sendAutoFetchMessage(seenMessageIds, baselineTimestamp).then(res => {
      if (res?.seenMessageIds?.length) {
        for (const id of res.seenMessageIds) {
          if (!seenMessageIds.includes(id)) seenMessageIds.push(id);
        }
      }
      if (res?.ok && res.otp) {
        rememberSeenMessage(res, seenMessageIds);
        if (shouldIgnoreOtpResult(res)) {
          if (attempt >= AUTO_POLL_MAX_ATTEMPTS) {
            stopAutoPolling();
            showFieldStatus('No newer OTP found. Check Gmail manually.', activeElement, 'error');
            lastAutoFetchAt = 0;
            return;
          }
          showFieldStatus(`Waiting for newer OTP email... (${attempt}/${AUTO_POLL_MAX_ATTEMPTS})`, activeElement);
          autoPollingTimer = setTimeout(poll, AUTO_POLL_INTERVAL_MS);
          return;
        }
        stopAutoPolling();
        removeOtpStatus();
        const target = findVisibleOtpField() || activeElement;
        const filled = document.contains(target) && autofillOtp(res.otp, target);
        if (filled) recordFilledOtp(res);
        if (filled) clickSubmitAfterOtp();
        showFieldStatus(filled ? `OTP filled: ${res.otp}` : `OTP found: ${res.otp}`, activeElement, filled ? 'success' : 'error');
        return;
      }
      if (attempt >= AUTO_POLL_MAX_ATTEMPTS) {
        stopAutoPolling();
        showFieldStatus('No OTP found. Check Gmail manually.', activeElement, 'error');
        lastAutoFetchAt = 0;
        return;
      }
      showFieldStatus(formatOtpWaitStatus(res, attempt), activeElement);
      autoPollingTimer = setTimeout(poll, AUTO_POLL_INTERVAL_MS);
    });
  }

  poll();
}

function hasInvalidOtpText() {
  return INVALID_OTP_PATTERN.test(document.body?.innerText || document.body?.textContent || '');
}

function clearOtpFields() {
  const target = findVisibleOtpField();
  if (!target) return;
  const split = findSplitInputs(target, lastFilledOtp || '12345678');
  const fields = split.length ? split : [target];
  for (const field of fields) {
    try {
      field.focus?.();
      setNativeValue(field, '');
      dispatchInputEvents(field);
    } catch (_) {}
  }
  fields[0]?.focus?.();
}

function retryInvalidOtpIfNeeded() {
  if (!hasInvalidOtpText()) return;
  const now = Date.now();
  if (now - lastInvalidOtpRetryAt < 5_000) return;
  lastInvalidOtpRetryAt = now;

  if (lastFilledOtpMessageId && !ignoredOtpMessageIds.includes(lastFilledOtpMessageId)) {
    ignoredOtpMessageIds.push(lastFilledOtpMessageId);
  }
  const normalizedLastOtp = normalizeOtpValue(lastFilledOtp);
  if (normalizedLastOtp) ignoredOtpValues.add(normalizedLastOtp);

  clearOtpFields();
  lastAutoFetchAt = 0;
  lastAutoFetchElement = null;

  const target = findVisibleOtpField();
  if (!target) return;
  showOTPBanner();
  showFieldStatus('OTP rejected. Waiting for newer email...', target, 'error');
  startOtpPolling(target, { force: true });
}

function scheduleInvalidOtpRetry() {
  clearTimeout(invalidOtpRetryTimer);
  invalidOtpRetryTimer = setTimeout(retryInvalidOtpIfNeeded, 400);
}

// ═════════════════════════════════════════════════════════════════════════════
// OTP ALERT BANNER (shown when OTP field appears even before focus)
// ═════════════════════════════════════════════════════════════════════════════

function showOTPBanner() {
  if (otpAlertShown) return;
  otpAlertShown = true;

  const banner = document.createElement('div');
  banner.id = 'jobright-otp-banner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#f59e0b;color:#1c1917;font-family:sans-serif;font-size:13px;font-weight:600;padding:9px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
  banner.innerHTML = `<span>Security code required - fetching OTP from Gmail automatically...</span><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#1c1917;margin-left:12px;padding:0;">x</button>`;
  document.body.prepend(banner);
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBMISSION DETECTION
// ═════════════════════════════════════════════════════════════════════════════

function checkForSubmission() {
  if (!autoAppliedEnabled) return;
  const text = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
  const confirmationUrl = /\/confirmation(?:[/?#]|$)/i.test(location.pathname) ||
    /[?&](?:submitted|success|confirmation)=/i.test(location.search);
  const visibleSubmitControl = findSubmitButton();
  // Greenhouse and some other ATS pages embed their future confirmation copy
  // in hydration data or hidden DOM while the application form is still open.
  // Do not treat that text as success until the form's visible Submit control
  // is gone or the URL itself is a confirmation route.
  const terminalSuccessSurface = confirmationUrl || !visibleSubmitControl;
  const confirmedSuccess = terminalSuccessSurface &&
    ATS_CONFIRMED_SUCCESS_PATTERNS.some(re => re.test(text));
  const confirmedFailure = ATS_CONFIRMED_FAILURE_PATTERNS.some(re => re.test(text));
  const configuredMatch = terminalSuccessSurface &&
    loadTerminalSuccessPhrases().some(phrase => text.includes(phrase));
  if (!confirmedSuccess && !confirmedFailure && !configuredMatch) return;
  if (Date.now() - lastSubmissionSignalAt < 1_500) return;

  signalSent = true;
  lastSubmissionSignalAt = Date.now();
  console.log(confirmedFailure
    ? '[JobRight Auto-Skip] ATS terminal failure detected'
    : '[JobRight Auto-Skip] ATS submission detected');
  try {
    chrome.runtime.sendMessage({
      type: 'ATS_SUBMISSION_DETECTED',
      url: location.href,
      origin: location.origin,
      confirmedSuccess,
      confirmedFailure,
    });
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════════════════
// FOCUS HANDLER — triggers OTP polling when an OTP field is focused
// ═════════════════════════════════════════════════════════════════════════════

function handleFocusIn(event) {
  const el = event.target;
  if (!isLikelyOtpField(el)) return;
  showOTPBanner();
  startOtpPolling(el);
}

document.addEventListener('focusin', handleFocusIn, true);

function maybeStartOtpPollingFromPageText() {
  if (!hasOtpSectionText()) return;
  const target = findVisibleOtpField();
  if (!target) return;
  showOTPBanner();

  // In iframes the browser blocks programmatic focus() without prior user
  // interaction. Dispatch a synthetic click+focus to try acquiring activation,
  // but start polling regardless — don't let focus failure gate OTP fetching.
  try {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
    target.focus({ preventScroll: true });
  } catch (_) {}

  startOtpPolling(target, { force: false });
}

// ═════════════════════════════════════════════════════════════════════════════
// DOM OBSERVER — watches for OTP fields appearing and for submission text
// ═════════════════════════════════════════════════════════════════════════════

let pageObserver = new MutationObserver(() => {
  clickLeverApplyForThisJobOnce();
  checkForSubmission();
  scheduleProfileCorrection();
  scheduleRecruitingCommunicationsOptIn();
  scheduleWorkEligibilityAnswers();
  scheduleRelocationAnswer();
  chooseYesForAccuracyAffirmations();
  chooseNoForPreviousEmployeeQuestions();
  scheduleValidationRetry();
  scheduleTermsCheckboxCheck();
  scheduleFallbackResumeUpload();
  scheduleFallbackCoverLetterUpload();
  scheduleInvalidOtpRetry();

  // Auto-trigger polling as soon as the OTP section appears, even before user focus.
  maybeStartOtpPollingFromPageText();

  // Also handle ATSes that auto-focus the field on render.
  const active = document.activeElement;
  if (active && isLikelyOtpField(active)) handleFocusIn({ target: active });
});

if (document.body) {
  pageObserver.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    if (pageObserver) pageObserver.observe(document.body, { childList: true, subtree: true });
  });
}

// Initial check on page load (confirmation pages loaded fresh)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  clickLeverApplyForThisJobOnce();
  checkForSubmission();
  scheduleProfileCorrection(0);
  scheduleRecruitingCommunicationsOptIn(0);
  scheduleWorkEligibilityAnswers(0);
  scheduleRelocationAnswer(0);
  chooseYesForAccuracyAffirmations();
  chooseNoForPreviousEmployeeQuestions();
  scheduleValidationRetry();
  scheduleTermsCheckboxCheck();
  scheduleFallbackResumeUpload();
  scheduleFallbackCoverLetterUpload();
  scheduleInvalidOtpRetry();
  maybeStartOtpPollingFromPageText();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    clickLeverApplyForThisJobOnce();
    checkForSubmission();
    scheduleProfileCorrection(0);
    scheduleRecruitingCommunicationsOptIn(0);
    scheduleWorkEligibilityAnswers(0);
    scheduleRelocationAnswer(0);
    chooseYesForAccuracyAffirmations();
    chooseNoForPreviousEmployeeQuestions();
    scheduleValidationRetry();
    scheduleTermsCheckboxCheck();
    scheduleFallbackResumeUpload();
    scheduleFallbackCoverLetterUpload();
    scheduleInvalidOtpRetry();
    maybeStartOtpPollingFromPageText();
  }, { once: true });
}

// Fast-poll for the OTP section appearing — catches cases where the iframe
// content renders before the MutationObserver attaches, or focus() was blocked.
// Stops itself once polling has started (AUTO_FETCH_COOLDOWN_MS guard prevents
// duplicate triggering inside startOtpPolling anyway).
let _otpWatcherInterval = setInterval(() => {
  const pageText = document.body?.innerText || document.body?.textContent || '';
  // Only trigger on actual email-OTP delivery pages (requires "@" email address
  // near "sent to") — prevents false positives on cert code questions.
  if (OTP_EMAIL_SENT_PATTERN.test(pageText)) {
    maybeStartOtpPollingFromPageText();
  }
}, 800);
// Stop watcher after 5 minutes (OTP windows don't last longer than that)
setTimeout(() => clearInterval(_otpWatcherInterval), 5 * 60 * 1000);

// SPA navigation fallback
let _lastUrl = location.href;
setInterval(() => {
  if (location.href !== _lastUrl) {
    _lastUrl = location.href;
    leverApplyClickUrl = '';
    leverApplyClickAt = 0;
    signalSent = false;
    lastSubmissionSignalAt = 0;
    otpAlertShown = false;
    validationRetryCounts = new Map();
    resumeFallbackUploaded = false;
    jobrightResumeMissingAt = 0;
    resumeFallbackAttempts = 0;
    coverLetterFallbackUploaded = false;
    jobrightCoverLetterMissingAt = 0;
    coverLetterFallbackAttempts = 0;
    lastFilledOtp = '';
    lastFilledOtpMessageId = '';
    ignoredOtpMessageIds = [];
    ignoredOtpValues = new Set();
    relocationAnswerAttempts.clear();
    booleanAnswerClickLocks.clear();
    lastInvalidOtpRetryAt = 0;
    clearTimeout(manualEditSubmitTimer);
    clearTimeout(jobrightRepairSubmitTimer);
    lastManualEditSubmitSignature = '';
    lastManualEditSubmitAt = 0;
    lastJobrightNudgeSignature = '';
    lastJobrightNudgeAt = 0;
    lastJobrightRepairSubmitSignature = '';
    lastJobrightRepairSubmitAt = 0;
    latestJobrightMissingFields = [];
    latestJobrightMissingFieldsAt = 0;
    clickLeverApplyForThisJobOnce();
    checkForSubmission();
    scheduleProfileCorrection(0);
    scheduleRecruitingCommunicationsOptIn(0);
    scheduleWorkEligibilityAnswers(0);
    scheduleRelocationAnswer(0);
    chooseYesForAccuracyAffirmations();
    chooseNoForPreviousEmployeeQuestions();
    scheduleValidationRetry();
    scheduleTermsCheckboxCheck();
    scheduleFallbackResumeUpload();
    scheduleFallbackCoverLetterUpload();
    scheduleInvalidOtpRetry();
    maybeStartOtpPollingFromPageText();
  }
}, 500);

setInterval(() => {
  correctStaleProfileFields();
  ensureUsCountryCode();
  ensureAtlantaLocation();
}, 2_000);
setInterval(chooseYesForRecruitingCommunications, 2_000);
setInterval(correctWorkEligibilityAnswers, 2_000);
setInterval(chooseYesForRelocationQuestions, 2_000);
setInterval(chooseYesForAccuracyAffirmations, 2_000);
setInterval(chooseNoForPreviousEmployeeQuestions, 2_000);
setInterval(checkRequiredAgreements, 2_000);
setInterval(checkForSubmission, 1_500);
setInterval(() => {
  if (!leverApplyClickAt || Date.now() - leverApplyClickAt > 15_000) {
    clickLeverApplyForThisJobOnce();
  }
}, 2_000);

} // end guard
