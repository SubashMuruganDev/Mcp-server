/**
 * OpenClaw Browser Extension — Content Script
 *
 * Injected into every page. Handles:
 *  - Page content extraction
 *  - Interactive element scanning (forms, buttons, inputs)
 *  - Action execution: fill, click, select, check, clear, scroll
 *  - Text highlighting and scroll-to-text
 */

(function () {
  'use strict';

  if (window.__openclawContentLoaded) return;
  window.__openclawContentLoaded = true;

  // ─── Stable element registry ───────────────────────────────────────────────
  // Filled each time SCAN_INTERACTIVE is called so that action indices
  // always refer to the most recent scan result.
  let _registry = [];

  // ─── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          break;

        case 'EXTRACT_CONTENT':
          sendResponse(extractContent());
          break;

        case 'SCAN_INTERACTIVE':
          sendResponse(scanInteractive());
          break;

        case 'EXECUTE_ACTION':
          sendResponse(executeAction(message.action));
          break;

        case 'HIGHLIGHT_TEXT':
          highlightText(message.text);
          sendResponse({ ok: true });
          break;

        case 'SCROLL_TO':
          scrollToText(message.text);
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });

  // ─── Content extraction ────────────────────────────────────────────────────

  function extractContent() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, svg, iframe').forEach((el) => el.remove());
    const bodyText = clone.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 15000);

    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 60)
      .map((a) => ({ text: a.textContent.trim().slice(0, 100), href: a.href }))
      .filter((l) => l.text && l.href.startsWith('http'));

    const images = Array.from(document.querySelectorAll('img'))
      .slice(0, 30)
      .map((img) => ({ alt: img.alt?.trim() || '', src: img.src, title: img.title?.trim() || '' }))
      .filter((i) => i.src);

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .slice(0, 40)
      .map((h) => ({ level: h.tagName, text: h.textContent.trim() }));

    const tables = Array.from(document.querySelectorAll('table'))
      .slice(0, 5)
      .map((t) => t.innerText.trim().slice(0, 500));

    const codeBlocks = Array.from(document.querySelectorAll('pre, code'))
      .slice(0, 10)
      .map((c) => c.textContent.trim().slice(0, 300))
      .filter(Boolean);

    const metaDescription =
      document.querySelector('meta[name="description"]')?.content ||
      document.querySelector('meta[property="og:description"]')?.content || '';

    const selectedText = window.getSelection()?.toString()?.trim() || '';

    return {
      url: location.href,
      title: document.title,
      description: metaDescription,
      bodyText,
      headings,
      links,
      images,
      tables,
      codeBlocks,
      selectedText,
      scrollPercent: Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight || 1)) * 100
      ),
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Interactive element scanner ───────────────────────────────────────────

  function scanInteractive() {
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

    const elements = Array.from(document.querySelectorAll(SELECTORS))
      .filter((el) => isVisible(el))
      .slice(0, 100);

    _registry = elements;

    const items = elements.map((el, index) => {
      const tag    = el.tagName.toLowerCase();
      const type   = el.getAttribute('type') || tag;
      const id     = el.id || '';
      const name   = el.getAttribute('name') || '';
      const label  = getLabel(el);
      const placeholder = el.getAttribute('placeholder') || '';
      const value  = getDisplayValue(el);
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
      const role   = el.getAttribute('role') || '';

      return { index, tag, type, id, name, label, placeholder, value, disabled, role };
    });

    return { elements: items, count: items.length };
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getLabel(el) {
    // 1. aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();

    // 2. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // 3. <label for="id">
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) return labelEl.textContent.trim();
    }

    // 4. Wrapping <label>
    const parent = el.closest('label');
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach((c) => c.remove());
      const txt = clone.textContent.trim();
      if (txt) return txt;
    }

    // 5. Nearby text / button content
    return el.textContent?.trim().slice(0, 60) ||
           el.getAttribute('title') ||
           el.getAttribute('name') ||
           '';
  }

  function getDisplayValue(el) {
    if (el.tagName === 'SELECT') {
      return Array.from(el.selectedOptions).map((o) => o.text).join(', ');
    }
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'checked' : 'unchecked';
    return el.value || el.textContent?.trim().slice(0, 80) || '';
  }

  // ─── Action executor ───────────────────────────────────────────────────────

  function executeAction(action) {
    const { type, index, selector, value } = action;

    const el = resolveElement(index, selector);
    if (!el) return { ok: false, error: `Element not found (index=${index}, selector=${selector})` };

    // Scroll into view first
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Flash highlight
    flashElement(el);

    switch (type) {
      case 'fill':
        return doFill(el, value ?? '');

      case 'click':
        return doClick(el);

      case 'select':
        return doSelect(el, value ?? '');

      case 'check':
        return doCheck(el, value);

      case 'clear':
        return doFill(el, '');

      case 'scroll':
        // Already scrolled above
        return { ok: true };

      case 'focus':
        el.focus();
        return { ok: true };

      default:
        return { ok: false, error: `Unknown action type: ${type}` };
    }
  }

  function resolveElement(index, selector) {
    if (selector) {
      try { return document.querySelector(selector); } catch { /* fall through */ }
    }
    if (index !== undefined && index !== null && _registry[index]) {
      return _registry[index];
    }
    return null;
  }

  function doFill(el, value) {
    el.focus();

    // Native input value setter (works with React, Vue, etc.)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    );
    if (nativeInputValueSetter) {
      nativeInputValueSetter.set.call(el, value);
    } else if (el.isContentEditable) {
      el.textContent = value;
    } else {
      el.value = value;
    }

    // Fire events so frameworks (React/Vue/Angular) pick up the change
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { ok: true, value };
  }

  function doClick(el) {
    el.focus();
    el.click();
    // Also dispatch mousedown/mouseup for sites that listen to those
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    return { ok: true };
  }

  function doSelect(el, value) {
    if (el.tagName !== 'SELECT') return { ok: false, error: 'Element is not a <select>' };

    // Try matching by option text or option value
    const options = Array.from(el.options);
    const match = options.find(
      (o) =>
        o.value === value ||
        o.text.trim().toLowerCase() === value.toLowerCase()
    );
    if (!match) return { ok: false, error: `No option matching "${value}"` };

    el.value = match.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selected: match.text };
  }

  function doCheck(el, value) {
    const shouldCheck = value === true || value === 'true' || value === 'on';
    if (el.checked !== shouldCheck) {
      el.click();
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, checked: el.checked };
  }

  // ─── Visual feedback ───────────────────────────────────────────────────────

  function flashElement(el) {
    const prev = el.style.outline;
    const prevTrans = el.style.transition;
    el.style.transition = 'outline 0.1s';
    el.style.outline = '2px solid #6c63ff';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.transition = prevTrans;
    }, 800);
  }

  // ─── Highlight helpers ─────────────────────────────────────────────────────

  function highlightText(searchText) {
    if (!searchText) return;
    removeHighlights();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    const regex = new RegExp(escapeRegex(searchText), 'gi');
    nodes.forEach((textNode) => {
      if (!regex.test(textNode.textContent)) return;
      regex.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = textNode.textContent.replace(
        regex,
        (m) => `<mark class="openclaw-highlight">${m}</mark>`
      );
      textNode.parentNode.replaceChild(span, textNode);
    });
  }

  function removeHighlights() {
    document.querySelectorAll('.openclaw-highlight').forEach((el) => {
      el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
    });
  }

  function scrollToText(searchText) {
    if (!searchText) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const regex = new RegExp(escapeRegex(searchText), 'i');
    let node;
    while ((node = walker.nextNode())) {
      if (regex.test(node.textContent)) {
        node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Injected styles ───────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    .openclaw-highlight {
      background: #ffd700;
      color: #000;
      border-radius: 2px;
      padding: 0 1px;
    }
  `;
  document.head.appendChild(style);
})();
