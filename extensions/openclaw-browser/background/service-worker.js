/**
 * OpenClaw Browser Extension — Background Service Worker
 *
 * Manages:
 *  - OpenClaw API communication
 *  - Page content extraction coordination
 *  - Interactive element scanning & action execution
 *  - Screenshot capture
 *  - Session state
 *  - Message routing between content scripts, popup, and sidepanel
 */

const DEFAULT_CONFIG = {
  openclawUrl: 'http://localhost:18789',
  openclawToken: '',
  sessionId: null,
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('config', (data) => {
    if (!data.config) {
      chrome.storage.local.set({ config: DEFAULT_CONFIG });
    }
  });
});

// Open sidepanel when the toolbar button is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_PAGE_CONTENT':
      return getPageContent(message.tabId);

    case 'TAKE_SCREENSHOT':
      return takeScreenshot(message.tabId);

    case 'SEND_MESSAGE':
      return sendMessageToOpenclaw(message.text, message.pageContext);

    case 'SEND_MESSAGE_INTERACT':
      return sendMessageWithElements(message.text, message.pageContext, message.elements);

    case 'GET_CONFIG':
      return getConfig();

    case 'SAVE_CONFIG':
      return saveConfig(message.config);

    case 'NEW_SESSION':
      return newSession();

    case 'GET_HISTORY':
      return getHistory();

    case 'TEST_CONNECTION':
      return testConnection(message.config);

    case 'SCAN_PAGE_ELEMENTS':
      return scanPageElements(message.tabId);

    case 'EXECUTE_ACTION':
      return executeAction(message.tabId, message.action);

    case 'EXECUTE_ACTIONS':
      return executeActions(message.tabId, message.actions);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ─── Page Content ─────────────────────────────────────────────────────────────

async function getPageContent(tabId) {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab');

  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: extractPageContent,
  });

  return results?.[0]?.result ?? null;
}

/** Runs inside the page — extracts structured content */
function extractPageContent() {
  const getMetaContent = (name) =>
    document.querySelector(`meta[name="${name}"]`)?.content ||
    document.querySelector(`meta[property="${name}"]`)?.content || '';

  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
  const bodyText = clone.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 15000);

  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 50)
    .map((a) => ({ text: a.textContent.trim().slice(0, 80), href: a.href }))
    .filter((l) => l.text && l.href.startsWith('http'));

  const images = Array.from(document.querySelectorAll('img[alt]'))
    .slice(0, 20)
    .map((img) => ({ alt: img.alt.trim(), src: img.src }))
    .filter((i) => i.alt);

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .slice(0, 30)
    .map((h) => ({ level: h.tagName, text: h.textContent.trim() }));

  return {
    url: location.href,
    title: document.title,
    description: getMetaContent('description') || getMetaContent('og:description'),
    bodyText,
    headings,
    links,
    images,
    timestamp: new Date().toISOString(),
  };
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

async function takeScreenshot(tabId) {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab');

  const tab = await chrome.tabs.get(targetTabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 80,
  });

  return { dataUrl, url: tab.url, title: tab.title };
}

// ─── Interactive element scanning ─────────────────────────────────────────────

async function scanPageElements(tabId) {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab');

  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: () => {
      // Trigger the content script's SCAN_INTERACTIVE via direct call if available,
      // otherwise inline the scan here as a fallback.
      if (window.__openclawScan) return window.__openclawScan();

      const SELECTORS = [
        'input:not([type="hidden"])',
        'textarea',
        'select',
        'button',
        '[role="button"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="combobox"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        'a[href]',
      ].join(', ');

      function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      }

      function getLabel(el) {
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
        const lb = el.getAttribute('aria-labelledby');
        if (lb) { const e = document.getElementById(lb); if (e) return e.textContent.trim(); }
        if (el.id) { const e = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (e) return e.textContent.trim(); }
        const p = el.closest('label');
        if (p) { const c = p.cloneNode(true); c.querySelectorAll('input,select,textarea').forEach(x => x.remove()); const t = c.textContent.trim(); if (t) return t; }
        return el.textContent?.trim().slice(0, 60) || el.getAttribute('title') || el.getAttribute('name') || '';
      }

      function getDisplayValue(el) {
        if (el.tagName === 'SELECT') return Array.from(el.selectedOptions).map(o => o.text).join(', ');
        if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'checked' : 'unchecked';
        return el.value || el.textContent?.trim().slice(0, 80) || '';
      }

      const elements = Array.from(document.querySelectorAll(SELECTORS))
        .filter(isVisible)
        .slice(0, 100);

      // Store on window for action executor to reference by index
      window.__openclawRegistry = elements;

      return {
        elements: elements.map((el, index) => ({
          index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || el.tagName.toLowerCase(),
          id: el.id || '',
          name: el.getAttribute('name') || '',
          label: getLabel(el),
          placeholder: el.getAttribute('placeholder') || '',
          value: getDisplayValue(el),
          disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
          role: el.getAttribute('role') || '',
        })),
        count: elements.length,
      };
    },
  });

  return results?.[0]?.result ?? { elements: [], count: 0 };
}

// ─── Action execution ─────────────────────────────────────────────────────────

async function executeAction(tabId, action) {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab');

  // Route through the content script message handler
  const results = await chrome.tabs.sendMessage(targetTabId, {
    type: 'EXECUTE_ACTION',
    action,
  }).catch(async () => {
    // Content script might not be injected on this page yet — inject and retry
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ['content/content.js'],
    });
    return chrome.tabs.sendMessage(targetTabId, { type: 'EXECUTE_ACTION', action });
  });

  return results;
}

async function executeActions(tabId, actions) {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab');

  // Re-scan first so the registry is fresh
  await scanPageElements(targetTabId);

  const results = [];
  for (const action of actions) {
    const result = await executeAction(targetTabId, action);
    results.push({ action, result });
    // Small delay between actions so the page can react
    await sleep(350);
  }

  return { results, completed: results.length };
}

// ─── OpenClaw API ─────────────────────────────────────────────────────────────

async function sendMessageToOpenclaw(userText, pageContext) {
  const config = await getConfig();
  if (!config.openclawToken) throw new Error('OpenClaw token not configured. Please open Settings.');

  let fullText = userText;
  if (pageContext) {
    fullText = `${buildContextBlock(pageContext)}\n\nUser question: ${userText}`;
  }

  return doSend(config, userText, fullText);
}

async function sendMessageWithElements(userText, pageContext, elements) {
  const config = await getConfig();
  if (!config.openclawToken) throw new Error('OpenClaw token not configured. Please open Settings.');

  const parts = [];
  if (pageContext) parts.push(buildContextBlock(pageContext));

  if (elements?.length) {
    parts.push('[Interactive Elements on Page]');
    parts.push(
      elements
        .map((el) => {
          const typeInfo = el.type !== el.tag ? `[type=${el.type}]` : '';
          const label    = el.label    ? ` label="${el.label}"`       : '';
          const ph       = el.placeholder ? ` placeholder="${el.placeholder}"` : '';
          const val      = el.value    ? ` value="${el.value}"`       : '';
          const dis      = el.disabled ? ' (disabled)'               : '';
          return `[${el.index}] <${el.tag}${typeInfo}>${label}${ph}${val}${dis}`;
        })
        .join('\n')
    );
    parts.push('');
    parts.push(INTERACT_INSTRUCTIONS);
  }

  parts.push(`User request: ${userText}`);
  const fullText = parts.join('\n');

  return doSend(config, userText, fullText);
}

const INTERACT_INSTRUCTIONS = `You can interact with these elements by including an <actions> block in your response.
Use this exact format (valid JSON array inside <actions> tags):

<actions>
[{"type":"fill","index":0,"value":"example text"},{"type":"click","index":2}]
</actions>

Available action types:
- fill   : set text value       { "type":"fill",   "index": N, "value": "text" }
- click  : click element        { "type":"click",  "index": N }
- select : choose dropdown      { "type":"select", "index": N, "value": "option text" }
- check  : check/uncheck box    { "type":"check",  "index": N, "value": true }
- clear  : clear a field        { "type":"clear",  "index": N }
- scroll : scroll into view     { "type":"scroll", "index": N }

Always explain what you are going to do before the <actions> block.`;

async function doSend(config, userText, fullText) {
  const sessionId = await ensureSession(config);

  const response = await fetchOpenclaw(config, `/api/sessions/${sessionId}/messages`, 'POST', {
    role: 'user',
    content: fullText,
  });

  await chrome.storage.local.set({ sessionId });

  // OpenClaw returns an OpenClawMessage: { role, content, id?, timestamp? }
  const reply =
    response?.content ||
    response?.reply?.content ||
    response?.message?.content ||
    (typeof response === 'string' ? response : JSON.stringify(response));

  await appendHistory({ role: 'user',      content: userText, timestamp: Date.now() });
  await appendHistory({ role: 'assistant', content: reply,    timestamp: Date.now() });

  return { reply };
}

function buildContextBlock(ctx) {
  const lines = [`[Page Context]`, `URL: ${ctx.url}`, `Title: ${ctx.title}`];
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.headings?.length) lines.push(`Headings: ${ctx.headings.map((h) => h.text).join(' | ')}`);
  if (ctx.bodyText) lines.push(`\nPage content:\n${ctx.bodyText.slice(0, 8000)}`);
  return lines.join('\n');
}

async function ensureSession(config) {
  const stored = await chrome.storage.local.get('sessionId');
  if (stored.sessionId) return stored.sessionId;

  // OpenClaw uses "main" as the default session — no creation endpoint needed.
  // We generate a unique ID per browser session so conversations stay separate.
  const sessionId = 'ext-' + Date.now().toString(36);
  await chrome.storage.local.set({ sessionId });
  return sessionId;
}

async function newSession() {
  await chrome.storage.local.remove('sessionId');
  await chrome.storage.local.remove('chatHistory');
  return { ok: true };
}

async function fetchOpenclaw(config, path, method = 'GET', body) {
  const url = `${config.openclawUrl.replace(/\/$/, '')}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openclawToken}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenClaw API error ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

// ─── Connection test ──────────────────────────────────────────────────────────

async function testConnection(config) {
  const cfg = config ?? (await getConfig());
  // /api/status is public — no token required, perfect for a connectivity check
  const url = `${cfg.openclawUrl.replace(/\/$/, '')}/api/status`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { ok: true, status: body };
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(data.config ?? {}) };
}

async function saveConfig(newConfig) {
  const current = await getConfig();
  await chrome.storage.local.set({ config: { ...current, ...newConfig } });
  return { ok: true };
}

// ─── History ──────────────────────────────────────────────────────────────────

async function getHistory() {
  const data = await chrome.storage.local.get('chatHistory');
  return data.chatHistory ?? [];
}

async function appendHistory(entry) {
  const history = await getHistory();
  history.push(entry);
  await chrome.storage.local.set({ chatHistory: history.slice(-200) });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
