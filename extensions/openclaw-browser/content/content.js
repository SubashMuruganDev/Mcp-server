/**
 * OpenClaw Browser Extension — Content Script
 *
 * Injected into every page. Listens for extraction requests
 * from the sidepanel/background and returns structured page data.
 * Also adds a subtle visual indicator when OpenClaw is reading the page.
 */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__openclawContentLoaded) return;
  window.__openclawContentLoaded = true;

  // ─── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'EXTRACT_CONTENT') {
      sendResponse(extractContent());
      return;
    }

    if (message.type === 'HIGHLIGHT_TEXT') {
      highlightText(message.text);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'SCROLL_TO') {
      scrollToText(message.text);
      sendResponse({ ok: true });
      return;
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
      document.querySelector('meta[property="og:description"]')?.content ||
      '';

    const ogImage =
      document.querySelector('meta[property="og:image"]')?.content || '';

    const selectedText = window.getSelection()?.toString()?.trim() || '';

    return {
      url: location.href,
      title: document.title,
      description: metaDescription,
      ogImage,
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

  // ─── Highlight helper ──────────────────────────────────────────────────────

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

  // ─── Highlight styles ──────────────────────────────────────────────────────

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
