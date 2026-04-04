/**
 * OpenClaw Browser Extension — Background Service Worker
 *
 * Manages:
 *  - OpenClaw API communication
 *  - Page content extraction coordination
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
    document.querySelector(`meta[property="${name}"]`)?.content ||
    '';

  // Clean body text — remove script/style noise
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
  const bodyText = clone.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 15000);

  // Collect links
  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 50)
    .map((a) => ({ text: a.textContent.trim().slice(0, 80), href: a.href }))
    .filter((l) => l.text && l.href.startsWith('http'));

  // Collect images
  const images = Array.from(document.querySelectorAll('img[alt]'))
    .slice(0, 20)
    .map((img) => ({ alt: img.alt.trim(), src: img.src }))
    .filter((i) => i.alt);

  // Headings structure
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

// ─── OpenClaw API ─────────────────────────────────────────────────────────────

async function sendMessageToOpenclaw(userText, pageContext) {
  const config = await getConfig();

  if (!config.openclawToken) {
    throw new Error('OpenClaw token not configured. Please open Settings.');
  }

  // Build the message — include page context as a system preamble when provided
  let fullText = userText;
  if (pageContext) {
    const ctx = buildContextBlock(pageContext);
    fullText = `${ctx}\n\nUser question: ${userText}`;
  }

  const sessionId = await ensureSession(config);

  const response = await fetchOpenclaw(config, `/api/sessions/${sessionId}/messages`, 'POST', {
    role: 'user',
    content: fullText,
  });

  // Persist session id
  await chrome.storage.local.set({ sessionId });

  // Extract assistant reply
  const reply =
    response?.reply?.content ||
    response?.message?.content ||
    response?.content ||
    JSON.stringify(response);

  // Append to local history
  await appendHistory({ role: 'user', content: userText, timestamp: Date.now() });
  await appendHistory({ role: 'assistant', content: reply, timestamp: Date.now() });

  return { reply };
}

function buildContextBlock(ctx) {
  const lines = [
    `[Page Context]`,
    `URL: ${ctx.url}`,
    `Title: ${ctx.title}`,
  ];
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.headings?.length) {
    lines.push(`Headings: ${ctx.headings.map((h) => h.text).join(' | ')}`);
  }
  if (ctx.bodyText) {
    lines.push(`\nPage content:\n${ctx.bodyText.slice(0, 8000)}`);
  }
  return lines.join('\n');
}

async function ensureSession(config) {
  const stored = await chrome.storage.local.get('sessionId');
  if (stored.sessionId) return stored.sessionId;

  const response = await fetchOpenclaw(config, '/api/sessions', 'POST', {});
  const sessionId = response?.sessionId || response?.id || crypto.randomUUID();
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
  if (!cfg.openclawToken) throw new Error('No token configured');
  // Hit the health or status endpoint
  const url = `${cfg.openclawUrl.replace(/\/$/, '')}/health`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.openclawToken}` },
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return { ok: true };
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(data.config ?? {}) };
}

async function saveConfig(newConfig) {
  const current = await getConfig();
  const merged = { ...current, ...newConfig };
  await chrome.storage.local.set({ config: merged });
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
  // Keep last 200 messages
  const trimmed = history.slice(-200);
  await chrome.storage.local.set({ chatHistory: trimmed });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
