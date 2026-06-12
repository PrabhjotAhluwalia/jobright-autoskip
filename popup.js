'use strict';

const autoAppliedToggle = document.getElementById('autoAppliedToggle');
const autoAppliedBadge  = document.getElementById('autoAppliedBadge');
const autoQueueToggle   = document.getElementById('autoQueueToggle');
const autoQueueBadge    = document.getElementById('autoQueueBadge');
const profileCorrectionToggle = document.getElementById('profileCorrectionToggle');
const profileCorrectionBadge  = document.getElementById('profileCorrectionBadge');
const statusBadge       = document.getElementById('statusBadge');
const skipCountEl       = document.getElementById('skipCount');
const resetBtn          = document.getElementById('resetBtn');
const mainUI            = document.getElementById('mainUI');
const notJobright       = document.getElementById('notJobright');
const blocklistToggle   = document.getElementById('blocklistToggle');
const blocklistBadge    = document.getElementById('blocklistBadge');
const companyListEl     = document.getElementById('companyList');
const emptyMsg          = document.getElementById('emptyMsg');
const blocklistCount    = document.getElementById('blocklistCount');
const addCompanyInput   = document.getElementById('addCompanyInput');
const addCompanyBtn     = document.getElementById('addCompanyBtn');
const toggleBtn         = document.getElementById('toggleBtn');
const gmailCard         = document.getElementById('gmailCard');
const gmailDot          = document.getElementById('gmailDot');
const gmailText         = document.getElementById('gmailText');
const gmailStatus       = document.getElementById('gmailStatus');
const gmailSub          = document.getElementById('gmailSub');
const gmailBtn          = document.getElementById('gmailBtn');

let currentTab = null;
const PROFILE_CORRECTION_FLAG = 'atsProfileCorrectionEnabled';

function setProfileCorrectionUI(enabled) {
  profileCorrectionToggle.className = 'toggle' + (enabled ? '' : ' off');
  profileCorrectionBadge.textContent = enabled ? 'ON' : 'OFF';
  profileCorrectionBadge.className = 'status-badge ' + (enabled ? 'on' : 'off');
}

function loadProfileCorrectionSetting() {
  chrome.storage.local.get([PROFILE_CORRECTION_FLAG], (stored) => {
    setProfileCorrectionUI(stored[PROFILE_CORRECTION_FLAG] !== false);
  });
}

function ensureJobrightContentScript(tabId) {
  if (!tabId) return Promise.resolve(false);
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => { globalThis.__jobrightForceContentReload = true; },
  })
    .then(() => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }))
    .then(() => true)
    .catch(() => false);
}

function sendCurrentTabMessage(message, callback = () => {}) {
  if (!currentTab?.id) {
    callback(new Error('No active JobRight tab'), null);
    return;
  }
  chrome.tabs.sendMessage(currentTab.id, message, (res) => {
    const err = chrome.runtime.lastError || null;
    if (!err) {
      callback(null, res);
      return;
    }
    ensureJobrightContentScript(currentTab.id).then((injected) => {
      if (!injected) {
        callback(err, null);
        return;
      }
      chrome.tabs.sendMessage(currentTab.id, message, (retryRes) => {
        callback(chrome.runtime.lastError || null, retryRes);
      });
    }).catch(injectErr => callback(injectErr, null));
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setUI(enabled, count, blocklistEnabled, blocklist, autoAppliedEnabled, autoQueueEnabled) {
  toggleBtn.className      = 'toggle' + (enabled ? '' : ' off');
  statusBadge.textContent  = enabled ? 'ON' : 'OFF';
  statusBadge.className    = 'status-badge ' + (enabled ? 'on' : 'off');
  skipCountEl.textContent  = count !== undefined ? count : '0';
  autoAppliedToggle.className  = 'toggle' + (autoAppliedEnabled ? '' : ' off');
  autoAppliedBadge.textContent = autoAppliedEnabled ? 'ON' : 'OFF';
  autoAppliedBadge.className   = 'status-badge ' + (autoAppliedEnabled ? 'on' : 'off');
  autoQueueToggle.className  = 'toggle' + (autoQueueEnabled ? '' : ' off');
  autoQueueBadge.textContent = autoQueueEnabled ? 'ON' : 'OFF';
  autoQueueBadge.className   = 'status-badge ' + (autoQueueEnabled ? 'on' : 'off');
  renderBlocklist(blocklistEnabled, blocklist || []);
}

function renderBlocklist(blocklistEnabled, blocklist) {
  blocklistToggle.className  = 'toggle' + (blocklistEnabled ? '' : ' off');
  blocklistBadge.textContent = blocklistEnabled ? 'ON' : 'OFF';
  blocklistBadge.className   = 'status-badge ' + (blocklistEnabled ? 'on' : 'off');
  blocklistCount.textContent = blocklist.length + ' compan' + (blocklist.length === 1 ? 'y' : 'ies');

  companyListEl.querySelectorAll('.company-item').forEach(el => el.remove());

  if (blocklist.length === 0) {
    emptyMsg.style.display = 'block';
  } else {
    emptyMsg.style.display = 'none';
    blocklist.forEach(company => {
      const item = document.createElement('div');
      item.className = 'company-item';

      const name = document.createElement('span');
      name.className   = 'company-name';
      name.textContent = company;
      name.title       = company;

      const btn = document.createElement('button');
      btn.className   = 'remove-btn';
      btn.textContent = '×';
      btn.title       = 'Remove from blocklist';
      btn.addEventListener('click', () => removeCompany(company));

      item.appendChild(name);
      item.appendChild(btn);
      companyListEl.appendChild(item);
    });
  }
}

function showWrongPage() {
  mainUI.style.display      = 'none';
  notJobright.style.display = 'block';
}

// ─── Gmail status ─────────────────────────────────────────────────────────────

function setGmailUI(state, subText) {
  gmailCard.className = 'gmail-card ' + state;
  gmailDot.className  = 'gmail-dot '  + state;
  gmailText.className = 'gmail-text ' + state;

  if (state === 'checking') {
    gmailStatus.textContent = 'Checking...';
    gmailSub.textContent    = subText || 'Verifying Gmail connection';
    gmailBtn.style.display  = 'none';
  } else if (state === 'connected') {
    gmailStatus.textContent = 'Gmail connected';
    gmailSub.textContent    = subText || 'OTP autofill active';
    gmailBtn.style.display  = 'block';
    gmailBtn.textContent    = 'Disconnect';
    gmailBtn.className      = 'gmail-btn disconnect';
  } else {
    gmailStatus.textContent = 'Gmail not connected';
    gmailSub.textContent    = subText || 'Click Connect to enable OTP autofill';
    gmailBtn.style.display  = 'block';
    gmailBtn.textContent    = 'Connect';
    gmailBtn.className      = 'gmail-btn connect';
  }
}

function checkGmailStatus() {
  setGmailUI('checking');
  chrome.storage.local.get(
    ['gmailOtpOAuthToken', 'gmailOtpRefreshToken', 'gmailNativeConnected',
     'gmailConnectedEmail', 'gmailLastAuthError', 'gmailLastAuthErrorAt'],
    (s) => {
      const access       = s.gmailOtpOAuthToken;
      const refresh      = s.gmailOtpRefreshToken;
      const native       = s.gmailNativeConnected;
      const email        = s.gmailConnectedEmail || '';
      const lastErr      = s.gmailLastAuthError;
      // Surface a stored error for up to 5 min — long enough to survive a PKCE popup-close cycle
      const recentError  = lastErr && (Date.now() - (s.gmailLastAuthErrorAt || 0) < 5 * 60 * 1000)
                           ? lastErr : null;

      const hasValidAccess = access?.accessToken && access.expiresAt > Date.now() + 60_000;

      if (hasValidAccess) {
        setGmailUI('connected', 'Token valid · auto-refresh ON');
      } else if (refresh) {
        setGmailUI('connected', 'Will silently refresh on next OTP');
      } else if (native) {
        // Chrome-native path — round-trip verify the session
        chrome.runtime.sendMessage({ type: 'CHECK_GMAIL_AUTH' }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            setGmailUI('disconnected', res?.error || recentError || 'Session expired — please reconnect');
          } else {
            setGmailUI('connected', res.sub || email || 'Connected via browser account');
          }
        });
      } else {
        // Nothing stored — silent probe; show persisted error if we have one
        chrome.runtime.sendMessage({ type: 'CHECK_GMAIL_AUTH' }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            setGmailUI('disconnected', recentError || undefined);
          } else {
            setGmailUI('connected', res.sub || 'Connected via browser account');
          }
        });
      }
    }
  );
}

gmailBtn.addEventListener('click', () => {
  if (gmailBtn.classList.contains('connect')) {
    setGmailUI('checking', 'Opening Google sign-in…');
    chrome.runtime.sendMessage({ type: 'LOGIN' }, (res) => {
      if (chrome.runtime.lastError) {
        setGmailUI('disconnected', 'Extension error — reload and try again');
        gmailBtn.className   = 'gmail-btn retry';
        gmailBtn.textContent = 'Retry';
        return;
      }
      if (!res?.ok) {
        setGmailUI('disconnected', res?.error || 'Sign-in failed — try again');
        gmailBtn.className   = 'gmail-btn retry';
        gmailBtn.textContent = 'Retry';
      } else {
        const sub = res.email || '';
        setGmailUI('connected', sub ? `Connected: ${sub}` : 'Connected · OTP autofill active');
      }
    });
  } else if (gmailBtn.classList.contains('disconnect')) {
    chrome.storage.local.remove(['gmailOtpOAuthToken', 'gmailOtpRefreshToken'], () => {
      chrome.runtime.sendMessage({ type: 'REVOKE_GMAIL_AUTH' });
      setGmailUI('disconnected', 'Disconnected');
    });
  } else {
    // retry
    gmailBtn.className   = 'gmail-btn connect';
    gmailBtn.textContent = 'Connect';
    checkGmailStatus();
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs?.[0]) { showWrongPage(); return; }
  currentTab = tabs[0];
  if (!currentTab.url?.includes('jobright.ai')) { showWrongPage(); return; }

  sendCurrentTabMessage({ type: 'GET_STATUS' }, (err, res) => {
    if (err || !res) {
      setUI(true, 0, true, [], true, false);
    } else {
      setUI(res.enabled, res.skipCount, res.blocklistEnabled, res.blocklist, res.autoAppliedEnabled, res.autoQueueEnabled);
    }
    checkGmailStatus();
  });
});

loadProfileCorrectionSetting();

profileCorrectionToggle.addEventListener('click', () => {
  chrome.storage.local.get([PROFILE_CORRECTION_FLAG], (stored) => {
    const enabled = stored[PROFILE_CORRECTION_FLAG] === false;
    chrome.storage.local.set({ [PROFILE_CORRECTION_FLAG]: enabled }, () => {
      setProfileCorrectionUI(enabled);
    });
  });
});

// ─── Auto-skip toggle ─────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', () => {
  if (!currentTab) return;
  sendCurrentTabMessage({ type: 'GET_STATUS' }, (err, res) => {
    if (err) return;
    const v = res ? !res.enabled : true;
    sendCurrentTabMessage({ type: 'SET_ENABLED', enabled: v }, (setErr) => {
      if (setErr) return;
      setUI(v, res?.skipCount ?? 0, res?.blocklistEnabled ?? true, res?.blocklist ?? [], res?.autoAppliedEnabled ?? true, res?.autoQueueEnabled ?? false);
    });
  });
});

// ─── Auto-applied toggle ──────────────────────────────────────────────────────

autoAppliedToggle.addEventListener('click', () => {
  if (!currentTab) return;
  sendCurrentTabMessage({ type: 'GET_STATUS' }, (err, res) => {
    if (err) return;
    const v = res ? !res.autoAppliedEnabled : false;
    sendCurrentTabMessage({ type: 'SET_AUTO_APPLIED_ENABLED', autoAppliedEnabled: v }, (setErr) => {
      if (setErr) return;
      autoAppliedToggle.className  = 'toggle' + (v ? '' : ' off');
      autoAppliedBadge.textContent = v ? 'ON' : 'OFF';
      autoAppliedBadge.className   = 'status-badge ' + (v ? 'on' : 'off');
    });
  });
});

// ─── Auto queue builder toggle ────────────────────────────────────────────────

autoQueueToggle.addEventListener('click', () => {
  if (!currentTab) return;
  sendCurrentTabMessage({ type: 'GET_STATUS' }, (err, res) => {
    if (err) return;
    const v = res ? !res.autoQueueEnabled : false;
    sendCurrentTabMessage({ type: 'SET_AUTO_QUEUE_ENABLED', autoQueueEnabled: v }, (setErr) => {
      if (setErr) return;
      autoQueueToggle.className  = 'toggle' + (v ? '' : ' off');
      autoQueueBadge.textContent = v ? 'ON' : 'OFF';
      autoQueueBadge.className   = 'status-badge ' + (v ? 'on' : 'off');
    });
  });
});

// ─── Blocklist feature toggle ─────────────────────────────────────────────────

blocklistToggle.addEventListener('click', () => {
  if (!currentTab) return;
  sendCurrentTabMessage({ type: 'GET_STATUS' }, (err, res) => {
    if (err) return;
    const v = res ? !res.blocklistEnabled : false;
    sendCurrentTabMessage({ type: 'SET_BLOCKLIST_ENABLED', blocklistEnabled: v }, (setErr) => {
      if (setErr) return;
      renderBlocklist(v, res?.blocklist ?? []);
    });
  });
});

// ─── Add company to blocklist ─────────────────────────────────────────────────

function addCompany() {
  if (!currentTab) return;
  const name = addCompanyInput.value.trim();
  if (!name) { addCompanyInput.focus(); return; }

  addCompanyBtn.disabled = true;
  sendCurrentTabMessage({ type: 'ADD_TO_BLOCKLIST', company: name }, (err) => {
    addCompanyBtn.disabled = false;
    if (err) return;
    addCompanyInput.value = '';
    addCompanyInput.focus();
    sendCurrentTabMessage({ type: 'GET_STATUS' }, (_statusErr, res) => {
      if (res) renderBlocklist(res.blocklistEnabled, res.blocklist || []);
    });
  });
}

addCompanyBtn.addEventListener('click', addCompany);
addCompanyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCompany(); });

// ─── Remove one company ───────────────────────────────────────────────────────

function removeCompany(company) {
  if (!currentTab) return;
  sendCurrentTabMessage({ type: 'REMOVE_FROM_BLOCKLIST', company }, () => {
    sendCurrentTabMessage({ type: 'GET_STATUS' }, (_err, res) => {
      if (res) renderBlocklist(res.blocklistEnabled, res.blocklist || []);
    });
  });
}

// ─── Reset skip count ─────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  if (!currentTab) return;
  chrome.storage.local.set({ skipCount: 0 });
  skipCountEl.textContent = '0';
  sendCurrentTabMessage({ type: 'RESET_COUNT' });
});

// ─── Live updates from content script ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SKIP_CLICKED') skipCountEl.textContent = msg.count;
  if (msg.type === 'BLOCKLIST_UPDATED' && currentTab) {
    sendCurrentTabMessage({ type: 'GET_STATUS' }, (_err, res) => {
      if (res) renderBlocklist(res.blocklistEnabled, res.blocklist || []);
    });
  }
});
