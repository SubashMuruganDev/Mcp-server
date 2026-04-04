/**
 * OpenClaw Browser Extension — Side Panel UI
 *
 * Handles the chat interface, page reading, screenshot capture,
 * and communication with the background service worker.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  pageContext: null,
  screenshotDataUrl: null,
  isLoading: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const elMessages      = $('messages');
const elWelcome       = $('welcome');
const elInput         = $('chat-input');
const elSendBtn       = $('btn-send');
const elNewChat       = $('btn-new-chat');
const elSettings      = $('btn-settings');
const elReadPage      = $('btn-read-page');
const elScreenshot    = $('btn-screenshot');
const elContextBar    = $('page-context-bar');
const elPageTitle     = $('page-title-label');
const elClearCtx      = $('btn-clear-context');
const elCharCount     = $('char-count');
const elViewChat      = $('view-chat');
const elViewSettings  = $('view-settings');
const elInputUrl      = $('input-url');
const elInputToken    = $('input-token');
const elToggleToken   = $('btn-toggle-token');
const elTestConn      = $('btn-test-connection');
const elSaveSettings  = $('btn-save-settings');
const elConnStatus    = $('connection-status');
const elBack          = $('btn-back');
const elChips         = document.querySelectorAll('.chip');
const elInputFooter   = $('input-footer');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadHistory();
  bindEvents();
  elInput.focus();
}

// ─── Event bindings ───────────────────────────────────────────────────────────

function bindEvents() {
  // Send on Enter (Shift+Enter = newline)
  elInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
    hideContextBar();
    removeScrPreview();
    addSystemMessage('New conversation started.');
  });

  elSettings.addEventListener('click', openSettings);
  elBack.addEventListener('click', closeSettings);

  elReadPage.addEventListener('click', handleReadPage);
  elScreenshot.addEventListener('click', handleScreenshot);

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
    const result = await bg('SEND_MESSAGE', {
      text,
      pageContext: state.pageContext,
    });
    removeTyping(typing);

    if (result.error) throw new Error(result.error);
    appendMessage('assistant', result.reply);
  } catch (err) {
    removeTyping(typing);
    appendMessage('error', `Error: ${err.message}`);
  } finally {
    state.isLoading = false;
    elSendBtn.disabled = !elInput.value.trim();
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

// ─── Screenshot ───────────────────────────────────────────────────────────────

async function handleScreenshot() {
  addSystemMessage('Capturing screenshot…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await bg('TAKE_SCREENSHOT', { tabId: tab.id });

    if (result.error) throw new Error(result.error);

    state.screenshotDataUrl = result.dataUrl;
    showScrPreview(result.dataUrl);

    // Include screenshot URL in page context as supplemental info
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
    // Send a status request via background
    await bg('SAVE_CONFIG', { config });
    const result = await bgRaw({ type: 'TEST_CONNECTION', config });

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
    if (role === 'user' || role === 'assistant') appendMessage(role, content, false);
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

function removeTyping(el) {
  el?.remove();
}

function clearMessages() {
  elMessages.innerHTML = '';
  elWelcome.classList.remove('hidden');
}

function hideWelcome() {
  elWelcome.classList.add('hidden');
}

function scrollToBottom() {
  elMessages.scrollTop = elMessages.scrollHeight;
}

function showContextBar(title) {
  elPageTitle.textContent = title;
  elContextBar.classList.remove('hidden');
}

function hideContextBar() {
  elContextBar.classList.add('hidden');
}

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

  // Insert before the input-row
  const inputRow = document.querySelector('.input-row');
  inputRow.parentNode.insertBefore(wrapper, inputRow);
}

function removeScrPreview() {
  $('scr-preview')?.remove();
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function updateCharCount() {
  const len = elInput.value.length;
  elCharCount.textContent = `${len} / 4000`;
  elCharCount.style.color = len > 3800 ? 'var(--error)' : 'var(--text-muted)';
}

// ─── Background messaging ─────────────────────────────────────────────────────

function bg(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function bgRaw(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
