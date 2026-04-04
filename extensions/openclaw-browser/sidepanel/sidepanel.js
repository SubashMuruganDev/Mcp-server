/**
 * OpenClaw Browser Extension — Side Panel UI
 *
 * Handles chat, page reading, screenshot, interactive element scanning,
 * form filling, clicking, and action execution with live visual feedback.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  pageContext: null,
  screenshotDataUrl: null,
  isLoading: false,
  interactMode: false,      // true when Interact button is active
  scannedElements: [],      // latest element scan result
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const elMessages        = $('messages');
const elWelcome         = $('welcome');
const elInput           = $('chat-input');
const elSendBtn         = $('btn-send');
const elNewChat         = $('btn-new-chat');
const elSettings        = $('btn-settings');
const elReadPage        = $('btn-read-page');
const elInteract        = $('btn-interact');
const elScreenshot      = $('btn-screenshot');
const elContextBar      = $('page-context-bar');
const elPageTitle       = $('page-title-label');
const elClearCtx        = $('btn-clear-context');
const elCharCount       = $('char-count');
const elViewChat        = $('view-chat');
const elViewSettings    = $('view-settings');
const elInputUrl        = $('input-url');
const elInputToken      = $('input-token');
const elToggleToken     = $('btn-toggle-token');
const elTestConn        = $('btn-test-connection');
const elSaveSettings    = $('btn-save-settings');
const elConnStatus      = $('connection-status');
const elBack            = $('btn-back');
const elChips           = document.querySelectorAll('.chip');
const elInputFooter     = $('input-footer');
const elElementsPanel   = $('elements-panel');
const elElementsList    = $('elements-list');
const elElementsCount   = $('elements-count-label');
const elRescan          = $('btn-rescan');
const elToastContainer  = $('toast-container');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadHistory();
  bindEvents();
  elInput.focus();
}

// ─── Event bindings ───────────────────────────────────────────────────────────

function bindEvents() {
  elInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  elInput.addEventListener('input', () => {
    autoResize(elInput);
    updateCharCount();
    elSendBtn.disabled = !elInput.value.trim() || state.isLoading;
  });

  elSendBtn.addEventListener('click', handleSend);

  elNewChat.addEventListener('click', async () => {
    await bg('NEW_SESSION');
    clearMessages();
    state.pageContext = null;
    state.screenshotDataUrl = null;
    state.interactMode = false;
    state.scannedElements = [];
    hideContextBar();
    removeScrPreview();
    hideElementsPanel();
    elInteract.classList.remove('active');
    elReadPage.classList.remove('active');
    addSystemMessage('New conversation started.');
  });

  elSettings.addEventListener('click', openSettings);
  elBack.addEventListener('click', closeSettings);

  elReadPage.addEventListener('click', handleReadPage);
  elInteract.addEventListener('click', handleInteract);
  elScreenshot.addEventListener('click', handleScreenshot);
  elRescan.addEventListener('click', () => rescanElements());

  elClearCtx.addEventListener('click', () => {
    state.pageContext = null;
    hideContextBar();
    elReadPage.classList.remove('active');
  });

  elChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      elInput.value = chip.dataset.text;
      autoResize(elInput);
      updateCharCount();
      elSendBtn.disabled = false;
      elInput.focus();
    });
  });

  elSaveSettings.addEventListener('click', saveSettings);
  elTestConn.addEventListener('click', testConnection);
  elToggleToken.addEventListener('click', () => {
    elInputToken.type = elInputToken.type === 'password' ? 'text' : 'password';
  });
}

// ─── Send message ─────────────────────────────────────────────────────────────

async function handleSend() {
  const text = elInput.value.trim();
  if (!text || state.isLoading) return;

  elInput.value = '';
  autoResize(elInput);
  updateCharCount();
  elSendBtn.disabled = true;

  appendMessage('user', text);
  hideWelcome();

  const typing = appendTyping();
  state.isLoading = true;

  try {
    let result;
    if (state.interactMode && state.scannedElements.length) {
      // Interact mode: include element list and instruct OpenClaw to return actions
      result = await bg('SEND_MESSAGE_INTERACT', {
        text,
        pageContext: state.pageContext,
        elements: state.scannedElements,
      });
    } else {
      result = await bg('SEND_MESSAGE', { text, pageContext: state.pageContext });
    }

    removeTyping(typing);
    if (result.error) throw new Error(result.error);

    // Render reply and detect embedded <actions> blocks
    renderAssistantReply(result.reply);
  } catch (err) {
    removeTyping(typing);
    appendMessage('error', `Error: ${err.message}`);
  } finally {
    state.isLoading = false;
    elSendBtn.disabled = !elInput.value.trim();
  }
}

// ─── Assistant reply + action parsing ────────────────────────────────────────

function renderAssistantReply(reply) {
  const actions = parseActions(reply);
  const displayText = reply.replace(/<actions>[\s\S]*?<\/actions>/gi, '').trim();

  const msgEl = appendMessage('assistant', displayText);

  if (actions.length) {
    // Attach "Run N actions" button below the reply
    const runBtn = document.createElement('button');
    runBtn.className = 'run-actions-btn';
    runBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Run ${actions.length} action${actions.length > 1 ? 's' : ''}
    `;
    runBtn.title = 'Execute the actions OpenClaw suggested on this page';

    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      await runActions(actions);
      runBtn.textContent = 'Done ✓';
    });

    msgEl.querySelector('.message-content').appendChild(runBtn);

    // Show a summary of planned actions as a system note
    const summary = actions
      .map((a) => describeAction(a))
      .join('\n');
    addSystemMessage(`Planned actions:\n${summary}`);
  }

  scrollToBottom();
}

/** Parse <actions>[...]</actions> from reply */
function parseActions(text) {
  const match = text.match(/<actions>([\s\S]*?)<\/actions>/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function describeAction(a) {
  switch (a.type) {
    case 'fill':   return `  • Fill [${a.index}] with "${a.value}"`;
    case 'click':  return `  • Click [${a.index}]`;
    case 'select': return `  • Select "${a.value}" in [${a.index}]`;
    case 'check':  return `  • ${a.value ? 'Check' : 'Uncheck'} [${a.index}]`;
    case 'clear':  return `  • Clear [${a.index}]`;
    case 'scroll': return `  • Scroll to [${a.index}]`;
    default:       return `  • ${a.type} [${a.index}]`;
  }
}

// ─── Execute actions ──────────────────────────────────────────────────────────

async function runActions(actions) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showToast('No active tab', 'error'); return; }

  showToast(`Running ${actions.length} action${actions.length > 1 ? 's' : ''}…`, 'info');

  try {
    const result = await bg('EXECUTE_ACTIONS', { tabId: tab.id, actions });
    if (result.error) throw new Error(result.error);

    const failed = result.results.filter((r) => r.result?.error);
    if (failed.length) {
      showToast(`${result.completed - failed.length}/${result.completed} actions succeeded`, 'warning');
      failed.forEach((f) => addSystemMessage(`Action failed: ${f.result.error}`));
    } else {
      showToast(`All ${result.completed} actions completed`, 'success');
    }

    // Refresh element list after actions
    if (state.interactMode) await rescanElements(false);
  } catch (err) {
    showToast(`Actions failed: ${err.message}`, 'error');
  }
}

// ─── Read page ────────────────────────────────────────────────────────────────

async function handleReadPage() {
  elReadPage.classList.toggle('active');

  if (elReadPage.classList.contains('active')) {
    addSystemMessage('Reading page content…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await bg('GET_PAGE_CONTENT', { tabId: tab.id });
      if (result.error) throw new Error(result.error);

      state.pageContext = result;
      showContextBar(result.title || result.url);
      addSystemMessage(`Page loaded: "${result.title || result.url}"`);
    } catch (err) {
      state.pageContext = null;
      elReadPage.classList.remove('active');
      appendMessage('error', `Could not read page: ${err.message}`);
    }
  } else {
    state.pageContext = null;
    hideContextBar();
  }
}

// ─── Interact mode ────────────────────────────────────────────────────────────

async function handleInteract() {
  state.interactMode = !state.interactMode;
  elInteract.classList.toggle('active', state.interactMode);

  if (state.interactMode) {
    await rescanElements();
  } else {
    state.scannedElements = [];
    hideElementsPanel();
    addSystemMessage('Interact mode off.');
  }
}

async function rescanElements(announce = true) {
  if (announce) addSystemMessage('Scanning interactive elements…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await bg('SCAN_PAGE_ELEMENTS', { tabId: tab.id });
    if (result.error) throw new Error(result.error);

    state.scannedElements = result.elements;
    renderElementsPanel(result.elements);
    showElementsPanel();

    if (announce) {
      addSystemMessage(
        `Found ${result.count} interactive element${result.count !== 1 ? 's' : ''}. ` +
        `Ask me to fill, click, or select any of them.`
      );
    }
  } catch (err) {
    state.scannedElements = [];
    hideElementsPanel();
    appendMessage('error', `Could not scan elements: ${err.message}`);
  }
}

function renderElementsPanel(elements) {
  elElementsCount.textContent = `${elements.length} element${elements.length !== 1 ? 's' : ''} found`;
  elElementsList.innerHTML = '';

  if (!elements.length) {
    elElementsList.innerHTML = '<p class="no-elements">No interactive elements found on this page.</p>';
    return;
  }

  elements.forEach((el) => {
    const item = document.createElement('div');
    item.className = `element-item${el.disabled ? ' disabled' : ''}`;

    const badge = document.createElement('span');
    badge.className = `element-badge element-badge--${getElementCategory(el)}`;
    badge.textContent = getElementShortType(el);

    const info = document.createElement('div');
    info.className = 'element-info';

    const name = document.createElement('span');
    name.className = 'element-name';
    name.textContent = el.label || el.placeholder || el.name || el.id || `[${el.index}]`;

    const meta = document.createElement('span');
    meta.className = 'element-meta';
    meta.textContent = el.value ? `= ${el.value.slice(0, 30)}` : '';

    info.appendChild(name);
    if (meta.textContent) info.appendChild(meta);

    const idx = document.createElement('span');
    idx.className = 'element-index';
    idx.textContent = `#${el.index}`;

    item.appendChild(badge);
    item.appendChild(info);
    item.appendChild(idx);

    // Click to prefill input with an action suggestion
    if (!el.disabled) {
      item.title = 'Click to ask OpenClaw about this element';
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const suggestion = buildElementSuggestion(el);
        elInput.value = suggestion;
        autoResize(elInput);
        updateCharCount();
        elSendBtn.disabled = false;
        elInput.focus();
      });
    }

    elElementsList.appendChild(item);
  });
}

function getElementCategory(el) {
  if (el.tag === 'button' || el.role === 'button') return 'button';
  if (el.tag === 'a') return 'link';
  if (el.tag === 'select' || el.role === 'combobox') return 'select';
  if (el.type === 'checkbox' || el.role === 'checkbox') return 'check';
  if (el.type === 'radio' || el.role === 'radio') return 'radio';
  if (el.tag === 'textarea' || el.role === 'textbox') return 'text';
  return 'input';
}

function getElementShortType(el) {
  if (el.tag === 'button' || el.role === 'button') return 'BTN';
  if (el.tag === 'a') return 'LNK';
  if (el.tag === 'select') return 'SEL';
  if (el.type === 'checkbox') return 'CHK';
  if (el.type === 'radio') return 'RDO';
  if (el.type === 'email') return 'EML';
  if (el.type === 'password') return 'PWD';
  if (el.type === 'number') return 'NUM';
  if (el.tag === 'textarea') return 'TXT';
  return 'INP';
}

function buildElementSuggestion(el) {
  const name = el.label || el.placeholder || el.name || `element ${el.index}`;
  if (el.tag === 'button' || el.role === 'button') return `Click the "${name}" button`;
  if (el.tag === 'select') return `Select an option from the "${name}" dropdown`;
  if (el.type === 'checkbox') return `Check the "${name}" checkbox`;
  return `Fill the "${name}" field with `;
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

async function handleScreenshot() {
  addSystemMessage('Capturing screenshot…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await bg('TAKE_SCREENSHOT', { tabId: tab.id });
    if (result.error) throw new Error(result.error);

    state.screenshotDataUrl = result.dataUrl;
    showScrPreview(result.dataUrl);

    if (!state.pageContext) {
      state.pageContext = { url: result.url, title: result.title, screenshot: true };
      showContextBar(result.title || result.url);
    }

    addSystemMessage('Screenshot captured. It will be included in your next message.');
  } catch (err) {
    appendMessage('error', `Screenshot failed: ${err.message}`);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function openSettings() {
  const config = await bg('GET_CONFIG');
  elInputUrl.value   = config.openclawUrl   || '';
  elInputToken.value = config.openclawToken || '';
  elConnStatus.textContent = '';
  elConnStatus.className   = 'connection-status';

  elViewChat.classList.add('hidden');
  elInputFooter.classList.add('hidden');
  elViewSettings.classList.remove('hidden');
}

function closeSettings() {
  elViewSettings.classList.add('hidden');
  elViewChat.classList.remove('hidden');
  elInputFooter.classList.remove('hidden');
}

async function saveSettings() {
  await bg('SAVE_CONFIG', {
    config: {
      openclawUrl:   elInputUrl.value.trim(),
      openclawToken: elInputToken.value.trim(),
    },
  });
  elConnStatus.textContent = 'Settings saved.';
  elConnStatus.className   = 'connection-status ok';
  setTimeout(closeSettings, 800);
}

async function testConnection() {
  elConnStatus.textContent = 'Testing…';
  elConnStatus.className   = 'connection-status';
  try {
    const config = {
      openclawUrl:   elInputUrl.value.trim(),
      openclawToken: elInputToken.value.trim(),
    };
    await bg('SAVE_CONFIG', { config });
    const result = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', config });
    if (result?.error) throw new Error(result.error);
    elConnStatus.textContent = 'Connected successfully!';
    elConnStatus.className   = 'connection-status ok';
  } catch (err) {
    elConnStatus.textContent = `Failed: ${err.message}`;
    elConnStatus.className   = 'connection-status fail';
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

async function loadHistory() {
  const history = await bg('GET_HISTORY');
  if (!history?.length) return;

  history.forEach(({ role, content }) => {
    if (role === 'user' || role === 'assistant') {
      // Render without action buttons (history replay)
      appendMessage(role, content, false);
    }
  });
  hideWelcome();
  scrollToBottom();
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function appendMessage(role, content, scroll = true) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'OpenClaw' : role;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;

  div.appendChild(roleLabel);
  div.appendChild(contentDiv);
  elMessages.appendChild(div);

  if (scroll) scrollToBottom();
  return div;
}

function addSystemMessage(text) {
  appendMessage('system', text);
}

function appendTyping() {
  const div = document.createElement('div');
  div.className = 'message assistant';

  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = 'OpenClaw';

  const typing = document.createElement('div');
  typing.className = 'typing-indicator message-content';
  typing.innerHTML = '<span></span><span></span><span></span>';

  div.appendChild(roleLabel);
  div.appendChild(typing);
  elMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function removeTyping(el) { el?.remove(); }

function clearMessages() {
  elMessages.innerHTML = '';
  elWelcome.classList.remove('hidden');
}

function hideWelcome() { elWelcome.classList.add('hidden'); }

function scrollToBottom() { elMessages.scrollTop = elMessages.scrollHeight; }

function showContextBar(title) {
  elPageTitle.textContent = title;
  elContextBar.classList.remove('hidden');
}

function hideContextBar() { elContextBar.classList.add('hidden'); }

function showElementsPanel()  { elElementsPanel.classList.remove('hidden'); }
function hideElementsPanel()  { elElementsPanel.classList.add('hidden'); }

function showScrPreview(dataUrl) {
  removeScrPreview();
  const wrapper = document.createElement('div');
  wrapper.className = 'screenshot-preview';
  wrapper.id = 'scr-preview';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Screenshot';

  const btn = document.createElement('button');
  btn.className = 'screenshot-remove';
  btn.title = 'Remove screenshot';
  btn.textContent = '✕';
  btn.addEventListener('click', () => {
    state.screenshotDataUrl = null;
    removeScrPreview();
  });

  wrapper.appendChild(img);
  wrapper.appendChild(btn);
  document.querySelector('.input-row').before(wrapper);
}

function removeScrPreview() { $('scr-preview')?.remove(); }

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function updateCharCount() {
  const len = elInput.value.length;
  elCharCount.textContent = `${len} / 4000`;
  elCharCount.style.color = len > 3800 ? 'var(--error)' : 'var(--text-muted)';
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  elToastContainer.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3000);
}

// ─── Background messaging ─────────────────────────────────────────────────────

function bg(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
