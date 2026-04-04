# OpenClaw Browser Extension

A Chrome/Edge browser extension that lets you chat with your OpenClaw AI server about any web page — reads page content, captures screenshots, and shows answers in a side panel, similar to how the Claude browser extension works.

## Features

| Feature | Description |
|---|---|
| **Read page** | Extracts full page text, headings, links, and images and sends as context |
| **Screenshot** | Captures a JPEG screenshot of the visible area |
| **Side panel chat** | Persistent chat UI docked alongside any page |
| **Session memory** | Conversation history persists across pages within a session |
| **New conversation** | Start a fresh session with one click |
| **Highlight & scroll** | Extension can highlight matching text on page from responses |
| **Settings** | Configure your OpenClaw server URL and bearer token |

## Installation

### Prerequisites

- Google Chrome 114+ or Microsoft Edge 114+
- A running OpenClaw server (default: `http://localhost:18789`)

### Load as unpacked extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this directory: `extensions/openclaw-browser/`
5. The OpenClaw icon will appear in the toolbar

### Configure

1. Click the OpenClaw icon in the toolbar
2. Click **Open Side Panel**
3. Click the **Settings** (gear) icon in the panel
4. Enter your OpenClaw server URL (e.g. `http://localhost:18789`)
5. Enter your bearer token from your OpenClaw config
6. Click **Test connection**, then **Save**

## Usage

1. Navigate to any website
2. Click the OpenClaw toolbar icon → **Open Side Panel**
3. Use the toolbar buttons in the panel:
   - **Read page** — loads the current page's content as context
   - **Screenshot** — captures the visible area for visual context
4. Type your question and press **Enter** or click the send button
5. OpenClaw replies in the panel with full page awareness

### Example prompts

- *"Summarize this article"*
- *"What are the prices listed on this page?"*
- *"Extract all the email addresses from this page"*
- *"What is the main call to action here?"*
- *"Translate the headings to Spanish"*

## Architecture

```
extensions/openclaw-browser/
├── manifest.json              # MV3 manifest
├── background/
│   └── service-worker.js      # API calls, screenshot, page extraction
├── content/
│   └── content.js             # Page content extraction & highlight
├── sidepanel/
│   ├── sidepanel.html         # Chat UI
│   ├── sidepanel.css          # Dark theme styles
│   └── sidepanel.js           # UI logic
├── popup/
│   ├── popup.html             # Toolbar popup (opens side panel)
│   └── popup.js
├── icons/                     # Extension icons (16/32/48/128px)
└── generate-icons.js          # Icon generator (requires `canvas`)
```

### Message flow

```
sidepanel.js
    │  chrome.runtime.sendMessage
    ▼
service-worker.js  ──── fetch ────►  OpenClaw REST API
    │                                (localhost:18789)
    │  chrome.scripting.executeScript
    ▼
content.js  (extracts page DOM, highlights text)
```

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read the URL/title of the current tab |
| `scripting` | Inject content script to extract page text |
| `storage` | Save settings and chat history locally |
| `sidePanel` | Show the chat interface in the browser side panel |
| `tabs` | Query and capture the active tab |
| `screenshots` | Capture visible area screenshots |
| `<all_urls>` | Read content from any website the user visits |

All data stays local — the only outbound connection is to your own OpenClaw server.

## Generating better icons

If you have Node.js `canvas` installed:

```bash
npm install canvas
node generate-icons.js
```

This will produce higher-quality icons in `icons/`.
