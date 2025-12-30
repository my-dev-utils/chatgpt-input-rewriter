// ==UserScript==
// @name         chatgpt-input-rewriter
// @namespace    https://mimiron.se/chatgpt-input-rewriter
// @version      0.5.0
// @description  Submit-time prompt rewrite via fetch interception with editable macro UI
// @author       Mårten Larsson
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.5.0';
  const LOG_PREFIX = `[chatgpt-input-rewriter v${VERSION}]`;
  const MACROS_KEY = 'chatgpt-input-rewriter.macros';

  const log = (...args) => console.log(LOG_PREFIX, ...args);

  /* ---------------------------------------------------------
   * Macro storage
   * --------------------------------------------------------- */

  const EXAMPLE_JSON = `{
  // Example macros
  // Syntax: "<macro> arg1 arg2 ..."
  // Placeholders:
  //   {{1}}, {{2}}, ... = positional args
  //   {{*}} or {{arg}} = all args joined by space

  "aiu": "Update {{1}} in {{2}} and emit the full file.",
  "ex":  "Explain {{*}} step by step, including reasoning.",
  "gen": "Generate {{1}} using {{2}} with options: {{*}}"
}`;

  function loadMacros() {
    try {
      const raw = localStorage.getItem(MACROS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------
   * Rewrite logic (positional args)
   * --------------------------------------------------------- */

  function rewritePrompt(original, macros) {
    if (typeof original !== 'string' || !macros) return original;

    const trimmed = original.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length === 0) return original;

    const macro = parts[0];
    const args = parts.slice(1);

    const expansion = macros[macro];
    if (typeof expansion !== 'string') return original;

    let rewritten = expansion;

    // {{1}}, {{2}}, ...
    args.forEach((arg, idx) => {
      const re = new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g');
      rewritten = rewritten.replace(re, arg);
    });

    const allArgs = args.join(' ');

    // {{*}} and {{arg}}
    rewritten = rewritten
      .replace(/\{\{\*\}\}/g, allArgs)
      .replace(/\{\{arg\}\}/g, allArgs);

    return rewritten;
  }

  /* ---------------------------------------------------------
   * Fetch interception (submit-time)
   * --------------------------------------------------------- */

  const originalFetch = window.fetch;

  window.fetch = async (input, init = {}) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : '';

    const looksLikeConversation =
      url.includes('/backend-api/conversation') ||
      (typeof init.body === 'string' && init.body.includes('"messages"'));

    if (looksLikeConversation && typeof init.body === 'string') {
      try {
        const data = JSON.parse(init.body);
        const parts = data?.messages?.[0]?.content?.parts;

        if (Array.isArray(parts) && typeof parts[0] === 'string') {
          const macros = loadMacros();
          const original = parts[0];
          const rewritten = rewritePrompt(original, macros);

          if (rewritten !== original) {
            parts[0] = rewritten;
            init.body = JSON.stringify(data);
            log('macro rewritten', { from: original, to: rewritten });
          }
        }
      } catch {
        /* silent */
      }
    }

    return originalFetch(input, init);
  };

  /* ---------------------------------------------------------
   * UI: Edit Macros Modal (unchanged)
   * --------------------------------------------------------- */

  function createButton() {
    const btn = document.createElement('button');
    btn.textContent = 'Edit macros';
    btn.style.position = 'fixed';
    btn.style.bottom = '16px';
    btn.style.right = '16px';
    btn.style.zIndex = '2147483647';
    btn.style.padding = '6px 10px';
    btn.style.fontSize = '12px';
    btn.style.opacity = '0.6';
    btn.style.cursor = 'pointer';

    btn.onmouseenter = () => (btn.style.opacity = '1');
    btn.onmouseleave = () => (btn.style.opacity = '0.6');
    btn.onclick = openModal;

    document.body.appendChild(btn);
  }

  function openModal() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '2147483647';

    const modal = document.createElement('div');
    modal.style.position = 'absolute';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.width = '70vw';
    modal.style.height = '60vh';
    modal.style.background = '#1e1e1e';
    modal.style.color = '#ddd';
    modal.style.padding = '12px';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.fontFamily = 'monospace';

    const style = document.createElement('style');
    style.textContent = `
      .cir-key  { color: #9cdcfe; }
      .cir-str  { color: #ce9178; }
      .cir-num  { color: #b5cea8; }
      .cir-bool { color: #569cd6; }
      pre::selection { background: transparent; }
    `;
    modal.appendChild(style);

    const editorWrap = document.createElement('div');
    editorWrap.style.position = 'relative';
    editorWrap.style.flex = '1';

    const pre = document.createElement('pre');
    const ta = document.createElement('textarea');

    const font = '13px monospace';
    const lineHeight = '18px';
    const padding = '8px';

    [pre, ta].forEach(el => {
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.margin = '0';
      el.style.font = font;
      el.style.lineHeight = lineHeight;
      el.style.padding = padding;
      el.style.boxSizing = 'border-box';
      el.style.whiteSpace = 'pre-wrap';
      el.style.overflow = 'scroll';
    });

    pre.style.pointerEvents = 'none';

    ta.style.background = 'transparent';
    ta.style.color = 'transparent';
    ta.style.caretColor = '#fff';
    ta.style.border = 'none';
    ta.style.resize = 'none';

    const stored = localStorage.getItem(MACROS_KEY);
    ta.value = stored ?? EXAMPLE_JSON;

    function highlight() {
      const escaped = ta.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      pre.innerHTML = escaped
        .replace(/"(.*?)"/g, '<span class="cir-str">"$1"</span>')
        .replace(
          /<span class="cir-str">"(.*?)"<\/span>:/g,
          '<span class="cir-key">"$1"</span>:'
        )
        .replace(/\b(true|false|null)\b/g, '<span class="cir-bool">$1</span>')
        .replace(/\b-?\d+(\.\d+)?\b/g, '<span class="cir-num">$&</span>');
    }

    ta.addEventListener('input', highlight);
    ta.addEventListener('scroll', () => (pre.scrollTop = ta.scrollTop));

    highlight();

    editorWrap.appendChild(pre);
    editorWrap.appendChild(ta);

    const error = document.createElement('div');
    error.style.color = '#f88';
    error.style.marginTop = '6px';

    const actions = document.createElement('div');
    actions.style.marginTop = '8px';
    actions.style.textAlign = 'right';

    const save = document.createElement('button');
    save.textContent = 'Save';
    save.onclick = () => {
      try {
        const parsed = JSON.parse(ta.value);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Root must be an object');
        }
        for (const [k, v] of Object.entries(parsed)) {
          if (!/^[a-z][a-z0-9]{1,3}$/.test(k)) {
            throw new Error(`Invalid macro name: ${k}`);
          }
          if (typeof v !== 'string') {
            throw new Error(`Macro value for "${k}" must be a string`);
          }
        }
        localStorage.setItem(MACROS_KEY, ta.value);
        log('macros updated');
        document.body.removeChild(overlay);
      } catch (e) {
        error.textContent = e.message || 'Invalid JSON';
      }
    };

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.marginLeft = '6px';
    cancel.onclick = () => document.body.removeChild(overlay);

    actions.appendChild(save);
    actions.appendChild(cancel);

    modal.appendChild(editorWrap);
    modal.appendChild(error);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    overlay.onclick = e => e.target === overlay && document.body.removeChild(overlay);

    document.body.appendChild(overlay);
    ta.focus();
  }

  createButton();
  log('loaded');
})();
