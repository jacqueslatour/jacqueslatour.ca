/*
 * trustdid-verify.js — embeddable TrustDID verification widget
 *
 * One file, no dependencies. Drop a <script> tag onto any page and every
 * element with `data-trustdid-vrfy` becomes a "Verify" button that fetches
 * the `.vrfy` sidecar, POSTs it to `/api/v1/verify-advanced`, and renders
 * the result inline.
 *
 * Public API:
 *   window.TrustDID.verify(url)  -> Promise<VerifyResult>
 *   window.TrustDID.mount(el, options)  -> attaches a button to an arbitrary element
 *
 * Auto-wire attributes:
 *   data-trustdid-vrfy              URL to verify. Empty = current page URL.
 *                                   Value may point to the document or its .vrfy.
 *   data-trustdid-vrfy-mode         "inline" (default) | "newtab"
 *   data-trustdid-vrfy-label        Override button text (default: "Verify")
 *   data-trustdid-vrfy-position     "after" (default) | "inside"
 *
 * Global overrides (optional, set BEFORE loading the script):
 *   window.TRUSTDID_API_BASE        Default: "https://trustdid.ca"
 *   window.TRUSTDID_VERIFY_PAGE     Default: "<API_BASE>/stealth/verify/"
 *
 * Theming (CSS custom properties on :root):
 *   --tdv-pass       Valid-state accent           (default #1f6f43)
 *   --tdv-fail       Invalid-state accent         (default #a5322a)
 *   --tdv-warn       Warning/unreachable accent   (default #b57a1b)
 *   --tdv-accent     Button accent                (default #1f6f43)
 *   --tdv-bg         Popover background           (default #fdfbf6)
 *   --tdv-ink        Popover text                 (default #2a2a28)
 *   --tdv-rule       Separator color              (default #e4dfd2)
 *   --tdv-radius     Border radius                (default 6px)
 *   --tdv-font       Font family                  (default inherits)
 *
 * Security:
 *   All API-returned fields (signer, message, timestamp) are rendered via
 *   textContent only — never innerHTML. See Appendix C of the embed design
 *   doc for the full XSS checklist this script satisfies.
 */
(function () {
  'use strict';

  if (window.TrustDID && window.TrustDID.__loaded) return; // idempotent

  // ───────────────────────────────────────────────────────────────── config ──

  var API_BASE = (window.TRUSTDID_API_BASE || 'https://trustdid.ca').replace(/\/$/, '');
  var VERIFY_PAGE = window.TRUSTDID_VERIFY_PAGE || (API_BASE + '/stealth/verify/');

  // ─────────────────────────────────────────────────────────────── styles ────

  var STYLE_ID = 'trustdid-verify-styles';
  var STYLES = [
    ':root {',
    '  --tdv-pass: #1f6f43;',
    '  --tdv-fail: #a5322a;',
    '  --tdv-warn: #b57a1b;',
    '  --tdv-accent: #1f6f43;',
    '  --tdv-bg: #fdfbf6;',
    '  --tdv-ink: #2a2a28;',
    '  --tdv-muted: #6b6860;',
    '  --tdv-rule: #e4dfd2;',
    '  --tdv-radius: 6px;',
    '  --tdv-font: inherit;',
    '}',
    '.tdv-btn {',
    '  display: inline-flex; align-items: center; gap: 0.4em;',
    '  font: inherit; font-family: var(--tdv-font);',
    '  font-size: 0.85rem; font-weight: 600;',
    '  padding: 0.4em 0.9em;',
    '  border: 1px solid var(--tdv-accent);',
    '  background: transparent; color: var(--tdv-accent);',
    '  border-radius: var(--tdv-radius);',
    '  cursor: pointer; line-height: 1;',
    '  transition: background 0.15s ease, color 0.15s ease;',
    '  vertical-align: baseline;',
    '}',
    '.tdv-btn:hover:not(:disabled), .tdv-btn:focus-visible:not(:disabled) {',
    '  background: var(--tdv-accent); color: #fff; outline: none;',
    '}',
    '.tdv-btn:disabled { opacity: 0.6; cursor: progress; }',
    '.tdv-btn-icon { font-size: 1em; line-height: 1; }',
    '.tdv-spin {',
    '  display: inline-block; width: 0.8em; height: 0.8em;',
    '  border: 2px solid currentColor; border-top-color: transparent;',
    '  border-radius: 50%; animation: tdv-spin 0.8s linear infinite;',
    '}',
    '@keyframes tdv-spin { to { transform: rotate(360deg); } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .tdv-spin { animation-duration: 2s; }',
    '}',
    '.tdv-popover {',
    '  font-family: var(--tdv-font); color: var(--tdv-ink);',
    '  background: var(--tdv-bg);',
    '  border: 1px solid var(--tdv-rule);',
    '  border-radius: var(--tdv-radius);',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.06);',
    '  max-width: 28rem; margin: 0.75rem 0;',
    '  overflow: hidden; font-size: 0.9rem; line-height: 1.45;',
    '}',
    '.tdv-popover__head {',
    '  display: flex; align-items: center; gap: 0.5rem;',
    '  padding: 0.65rem 0.9rem;',
    '  color: #fff; font-weight: 700; font-size: 0.85rem;',
    '  letter-spacing: 0.03em; text-transform: uppercase;',
    '}',
    '.tdv-popover__head--pass { background: var(--tdv-pass); }',
    '.tdv-popover__head--fail { background: var(--tdv-fail); }',
    '.tdv-popover__head--warn { background: var(--tdv-warn); }',
    '.tdv-popover__icon { font-size: 1.1rem; line-height: 1; }',
    '.tdv-popover__assurance {',
    '  margin-left: auto; font-size: 0.7rem; padding: 0.15rem 0.45rem;',
    '  border-radius: 3px; background: rgba(255,255,255,0.22);',
    '}',
    '.tdv-popover__body { padding: 0.75rem 0.9rem; }',
    '.tdv-popover__section + .tdv-popover__section {',
    '  border-top: 1px solid var(--tdv-rule);',
    '  margin-top: 0.65rem; padding-top: 0.65rem;',
    '}',
    '.tdv-field { display: flex; gap: 0.5rem; margin: 0.15rem 0; font-size: 0.82rem; }',
    '.tdv-field__k { color: var(--tdv-muted); min-width: 5rem; flex-shrink: 0; }',
    '.tdv-field__v { color: var(--tdv-ink); word-break: break-word; }',
    '.tdv-field__v code {',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    '  font-size: 0.78rem; background: rgba(0,0,0,0.04); padding: 0 0.25rem;',
    '  border-radius: 3px;',
    '}',
    '.tdv-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; padding: 0.15rem 0; }',
    '.tdv-check__icon { width: 1em; text-align: center; font-weight: 700; }',
    '.tdv-check__icon--pass { color: var(--tdv-pass); }',
    '.tdv-check__icon--fail { color: var(--tdv-fail); }',
    '.tdv-check__icon--neutral { color: var(--tdv-muted); }',
    '.tdv-check__label { flex: 1; }',
    '.tdv-check__detail { color: var(--tdv-muted); font-size: 0.75rem; }',
    '.tdv-popover__msg { font-size: 0.82rem; color: var(--tdv-muted); }',
    '.tdv-popover__foot {',
    '  padding: 0.55rem 0.9rem; border-top: 1px solid var(--tdv-rule);',
    '  background: rgba(0,0,0,0.015); font-size: 0.75rem;',
    '  display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;',
    '}',
    '.tdv-popover__foot a { color: var(--tdv-muted); text-decoration: underline; }',
    '.tdv-popover__close {',
    '  background: none; border: 0; font: inherit; color: var(--tdv-muted);',
    '  cursor: pointer; padding: 0.15rem 0.35rem; line-height: 1;',
    '}',
    '.tdv-popover__close:hover { color: var(--tdv-ink); }',
    ''
  ].join('\n');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  // ────────────────────────────────────────────────────────────── helpers ────

  function deriveVrfyUrl(url) {
    if (!url) return '';
    var trimmed = String(url).trim();
    if (trimmed.slice(-5) === '.vrfy') return trimmed;
    // Normalize: drop fragment + query (manifests are per-document, not per-request),
    // and treat directory URLs as serving index.html so the sidecar URL matches the
    // file that was actually signed.
    try {
      var u = new URL(trimmed, window.location.href);
      u.hash = '';
      u.search = '';
      if (u.pathname === '' || u.pathname.slice(-1) === '/') u.pathname += 'index.html';
      return u.href + '.vrfy';
    } catch (e) {
      return trimmed + '.vrfy';
    }
  }

  function formatTimestamp(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return String(iso); }
  }

  function resolveUrl(raw) {
    if (!raw) return '';
    try { return new URL(raw, window.location.href).href; }
    catch (e) { return raw; }
  }

  // Maps API `error` strings to short plain-language labels. The API already
  // returns a human `message`; this is only used when rendering the check list.
  var ERROR_LABELS = {
    vrfy_fetch_error:       'Could not fetch signature file',
    vrfy_fetch_timeout:     'Signature file fetch timed out',
    manifest_parse_error:   'Signature file is malformed',
    no_did_in_manifest:     'Signature file missing identity',
    invalid_manifest:       'Signature file invalid',
    missing_manifest_proof: 'Signature missing',
    manifest_integrity_failed: 'Signature file has been altered',
    document_integrity_failed: 'Document has been modified since signing',
    manifest_proof_mismatch:'Signature hash mismatch',
    did_fetch_error:        'Could not resolve signer identity',
    did_fetch_timeout:      'Identity resolution timed out',
    invalid_did_document:   'Signer identity document invalid',
    signature_invalid:      'Signature does not match content',
    key_not_found:          'Signing key not present in identity',
    key_not_authorized:     'Signing key not authorized',
    did_mismatch:           'Identity does not match signature',
    expired:                'Signature is expired',
    pq_signature_invalid:   'Post-quantum signature invalid',
    pq_did_mismatch:        'Post-quantum identity mismatch',
    pq_key_not_found:       'Post-quantum key missing'
  };

  // Friendly labels for individual `checks` keys. Present = pass/fail line.
  var CHECK_LABELS = {
    document_integrity: 'Document content',
    manifest_integrity: 'Signature file integrity',
    did_resolution:     'Signer identity resolved',
    signature_valid:    'Signature verified',
    dns_uri:            'DNS URI record',
    dns_tlsa:           'DNS TLSA record',
    trust_registry:     'Trust registry',
    pq_manifest:        'Post-quantum signature',
    identity_assurance: 'Identity assurance'
  };

  var CHECK_ORDER = [
    'document_integrity', 'manifest_integrity', 'pq_manifest',
    'did_resolution', 'signature_valid',
    'dns_uri', 'dns_tlsa', 'trust_registry', 'identity_assurance'
  ];

  // ──────────────────────────────────────────────────────────── verify() ────
  //
  // Full verification is two half-moons that meet in the middle:
  //
  //   Server-side (API)   — signature chain: Ed25519 + ML-DSA-44 over the
  //                         manifest, DID resolution, DNS anchors, trust
  //                         registry. The API never sees the document, so
  //                         it cannot check that the referenced bytes still
  //                         hash to what the manifest claims.
  //
  //   Client-side (here)  — document integrity: fetch the .vrfy to read
  //                         payload.documentHash, fetch the document
  //                         bytes, SHA-256 them in the browser, compare.
  //                         Catches tampering the API cannot see.
  //
  // Both must pass for the overall result to be valid.

  // Strip the leading // comment header from a .vrfy file and parse JSON.
  function parseVrfyBody(text) {
    var lines = String(text).split('\n');
    while (lines.length && /^\s*(\/\/|$)/.test(lines[0])) lines.shift();
    return JSON.parse(lines.join('\n'));
  }

  function bytesToHex(buf) {
    var view = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < view.length; i++) {
      var h = view[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  }

  // Derive the document URL from a .vrfy URL by trimming the extension.
  function stripVrfy(vrfyUrl) {
    return vrfyUrl.replace(/\.vrfy(\?.*)?$/, '$1');
  }

  // Fetch the document bytes and SHA-256 them in the browser.
  function clientSideDocumentCheck(vrfyUrl) {
    if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) {
      return Promise.resolve({ ok: null, reason: 'SubtleCrypto unavailable' });
    }
    return fetch(vrfyUrl, { credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching .vrfy');
        return r.text();
      })
      .then(function (vrfyText) {
        var manifest = parseVrfyBody(vrfyText);
        var expected = manifest && manifest.payload && manifest.payload.documentHash;
        if (!expected) throw new Error('manifest has no documentHash');
        var docUrl = stripVrfy(vrfyUrl);
        return fetch(docUrl, { credentials: 'omit', cache: 'no-store' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching document');
            return r.arrayBuffer();
          })
          .then(function (bytes) {
            return window.crypto.subtle.digest('SHA-256', bytes)
              .then(function (hashBuf) {
                var actual = bytesToHex(hashBuf);
                return {
                  ok: actual.toLowerCase() === String(expected).toLowerCase(),
                  expected: String(expected),
                  computed: actual,
                  fileName: manifest.payload.fileName
                };
              });
          });
      })
      .catch(function (err) {
        return { ok: null, reason: err.message || String(err) };
      });
  }

  function callVerifyApi(vrfyUrl) {
    return fetch(API_BASE + '/api/v1/verify-advanced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vrfy_url: vrfyUrl }),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok && !('valid' in data)) {
          var msg = 'Verification request failed';
          if (Array.isArray(data.detail)) msg = data.detail.map(function (d) { return d.msg; }).join('; ');
          else if (typeof data.detail === 'string') msg = data.detail;
          var e = new Error(msg);
          e.type = 'validation';
          throw e;
        }
        return data;
      });
    });
  }

  function verify(url) {
    var vrfyUrl = deriveVrfyUrl(resolveUrl(url));
    if (!vrfyUrl) return Promise.reject(new Error('missing url'));

    // Run both halves in parallel.
    return Promise.all([
      callVerifyApi(vrfyUrl),
      clientSideDocumentCheck(vrfyUrl)
    ]).then(function (pair) {
      var api = pair[0];
      var doc = pair[1];
      api.checks = api.checks || {};

      // Attach the client-side numbers so the UI can show expected vs computed.
      if (doc.expected) api.expectedHash = doc.expected;
      if (doc.computed) api.computedHash = doc.computed;

      if (doc.ok === false) {
        // Hard fail: bytes on the wire do not match what the signer attested to.
        api.valid = false;
        api.error = 'document_integrity_failed';
        api.message = 'The document no longer matches its signed hash. It has been modified since it was signed.';
        api.checks.document_integrity = false;
      } else if (doc.ok === true) {
        api.checks.document_integrity = true;
      }
      // doc.ok === null: could not run the client-side check (e.g. CORS,
      // SubtleCrypto missing, network). Leave the API result unchanged but
      // expose the reason so the caller can mention the partial result.
      if (doc.ok === null) api.documentCheckSkipped = doc.reason || 'unavailable';
      return api;
    });
  }

  // ─────────────────────────────────────────────────────────── rendering ────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function addField(parent, key, value) {
    var row = el('div', 'tdv-field');
    row.appendChild(el('span', 'tdv-field__k', key));
    var v = el('span', 'tdv-field__v');
    // textContent: signer/timestamp/etc. may be attacker-controlled.
    if (value instanceof Node) v.appendChild(value);
    else v.textContent = value == null ? '—' : String(value);
    row.appendChild(v);
    parent.appendChild(row);
  }

  function addCheck(parent, state, label, detail) {
    var row = el('div', 'tdv-check');
    var icon = el('span', 'tdv-check__icon');
    if (state === true)       { icon.classList.add('tdv-check__icon--pass');    icon.textContent = '✓'; }
    else if (state === false) { icon.classList.add('tdv-check__icon--fail');    icon.textContent = '✗'; }
    else                      { icon.classList.add('tdv-check__icon--neutral'); icon.textContent = '—'; }
    row.appendChild(icon);
    row.appendChild(el('span', 'tdv-check__label', label));
    if (detail) row.appendChild(el('span', 'tdv-check__detail', detail));
    parent.appendChild(row);
  }

  function buildPopover(kind, title, assurance) {
    var pop = el('div', 'tdv-popover');
    pop.setAttribute('role', 'status');
    pop.setAttribute('aria-live', 'polite');

    var head = el('div', 'tdv-popover__head tdv-popover__head--' + kind);
    var icon = el('span', 'tdv-popover__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'pass' ? '✓' : kind === 'fail' ? '✗' : '⚠';
    head.appendChild(icon);
    head.appendChild(el('span', null, title));
    if (assurance) head.appendChild(el('span', 'tdv-popover__assurance', assurance + ' assurance'));
    pop.appendChild(head);

    var body = el('div', 'tdv-popover__body');
    pop.appendChild(body);

    var foot = el('div', 'tdv-popover__foot');
    pop.appendChild(foot);

    pop.__body = body;
    pop.__foot = foot;
    return pop;
  }

  function addFootLinks(pop, vrfyUrl) {
    var left = el('span', null);
    var learnMore = el('a', null, 'Re-verify on trustdid.ca ↗');
    learnMore.href = VERIFY_PAGE + '?url=' + encodeURIComponent(vrfyUrl);
    learnMore.target = '_blank';
    learnMore.rel = 'noopener';
    left.appendChild(learnMore);
    pop.__foot.appendChild(left);

    var close = el('button', 'tdv-popover__close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', function () {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    });
    pop.__foot.appendChild(close);
  }

  function renderResult(result, vrfyUrl) {
    if (!result.valid) return renderFailure(result, vrfyUrl);

    var pop = buildPopover('pass', 'Verified', result.assurance || '');
    var body = pop.__body;

    if (result.signer)    addField(body, 'Signer',  result.signer);
    if (result.timestamp) addField(body, 'Signed',  formatTimestamp(result.timestamp));
    if (result.pq_algo)   addField(body, 'PQ algo', result.pq_algo);

    var checks = result.checks || {};
    var section = el('div', 'tdv-popover__section');
    body.appendChild(section);
    CHECK_ORDER.forEach(function (k) {
      if (!(k in checks) || checks[k] == null) return;
      var v = checks[k];
      var label = CHECK_LABELS[k] || k;
      // trust_registry false == "not configured" (neutral), not a hard fail.
      if (k === 'trust_registry' && v === false) {
        addCheck(section, null, label, 'not configured');
        return;
      }
      if (typeof v === 'boolean')       addCheck(section, v, label);
      else if (typeof v === 'string')   addCheck(section, true, label, v);
      else                              addCheck(section, null, label, String(v));
    });

    if (result.message) {
      var msgSection = el('div', 'tdv-popover__section');
      msgSection.appendChild(el('div', 'tdv-popover__msg', result.message));
      body.appendChild(msgSection);
    }

    addFootLinks(pop, vrfyUrl);
    return pop;
  }

  function renderFailure(result, vrfyUrl) {
    var pop = buildPopover('fail', 'Verification failed');
    var body = pop.__body;

    if (result.signer)    addField(body, 'Claimed signer', result.signer);

    // When the document has been modified, show the expected vs. computed
    // hashes side-by-side — same info the browser extension reports, same
    // style as a git diff.
    if (result.expectedHash && result.computedHash) {
      var hashSection = el('div', 'tdv-popover__section');
      var expCode = el('code');
      expCode.textContent = String(result.expectedHash).slice(0, 16) + '…';
      expCode.title = result.expectedHash;
      addField(hashSection, 'Expected', expCode);
      var actCode = el('code');
      actCode.textContent = String(result.computedHash).slice(0, 16) + '…';
      actCode.title = result.computedHash;
      addField(hashSection, 'Computed', actCode);
      body.appendChild(hashSection);
    }

    var reason = result.message ||
      ERROR_LABELS[result.error] ||
      'This content could not be verified.';
    body.appendChild(el('div', 'tdv-popover__msg', reason));

    var checks = result.checks || {};
    if (Object.keys(checks).length) {
      var section = el('div', 'tdv-popover__section');
      body.appendChild(section);
      CHECK_ORDER.forEach(function (k) {
        if (!(k in checks) || checks[k] == null) return;
        var v = checks[k];
        var label = CHECK_LABELS[k] || k;
        if (typeof v === 'boolean') addCheck(section, v, label);
      });
      // surface error as the trailing failed check if no per-check data said so
      if (result.error && ERROR_LABELS[result.error]) {
        addCheck(section, false, ERROR_LABELS[result.error]);
      }
    }

    addFootLinks(pop, vrfyUrl);
    return pop;
  }

  function renderUnreachable(message, vrfyUrl) {
    var pop = buildPopover('warn', 'Verification unreachable');
    var body = pop.__body;
    body.appendChild(el('div', 'tdv-popover__msg',
      message || 'The verification service could not be reached. Please try again in a moment.'));

    var hint = el('div', 'tdv-popover__section');
    hint.appendChild(el('div', 'tdv-popover__msg',
      'You can also verify this file offline with the TrustDID CLI.'));
    body.appendChild(hint);

    addFootLinks(pop, vrfyUrl);
    return pop;
  }

  // ─────────────────────────────────────────────── button + inline popover ──

  function createButton(label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tdv-btn';
    btn.setAttribute('aria-label', 'Verify digital signature');

    var icon = el('span', 'tdv-btn-icon', '✓');
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    btn.appendChild(el('span', null, label || 'Verify'));
    return btn;
  }

  function setButtonLoading(btn) {
    btn.disabled = true;
    btn.__origHTML = btn.innerHTML;
    btn.textContent = '';
    var spin = el('span', 'tdv-spin');
    spin.setAttribute('aria-hidden', 'true');
    btn.appendChild(spin);
    btn.appendChild(el('span', null, ' Verifying…'));
  }

  function restoreButton(btn) {
    btn.disabled = false;
    if (btn.__origHTML != null) {
      btn.innerHTML = btn.__origHTML;
      btn.__origHTML = null;
    }
  }

  function placePopover(targetEl, btn, position, pop) {
    // Remove any prior popover keyed to this button.
    if (btn.__tdvPopover && btn.__tdvPopover.parentNode) {
      btn.__tdvPopover.parentNode.removeChild(btn.__tdvPopover);
    }
    btn.__tdvPopover = pop;
    if (position === 'inside' && targetEl.appendChild) {
      targetEl.appendChild(pop);
    } else if (btn.parentNode) {
      btn.parentNode.insertBefore(pop, btn.nextSibling);
    }
  }

  function resolveTargetUrl(el) {
    var attr = el.getAttribute('data-trustdid-vrfy');
    if (attr) return resolveUrl(attr);
    if (el.tagName === 'A' && el.href) return el.href;
    return window.location.href;
  }

  function handleClick(targetEl, btn) {
    var mode     = targetEl.getAttribute('data-trustdid-vrfy-mode') || 'inline';
    var position = targetEl.getAttribute('data-trustdid-vrfy-position') || 'after';
    var rawUrl   = resolveTargetUrl(targetEl);
    var vrfyUrl  = deriveVrfyUrl(rawUrl);

    if (mode === 'newtab') {
      var href = VERIFY_PAGE + '?url=' + encodeURIComponent(vrfyUrl);
      window.open(href, '_blank', 'noopener');
      return;
    }

    setButtonLoading(btn);
    verify(rawUrl).then(function (result) {
      var pop = renderResult(result, vrfyUrl);
      placePopover(targetEl, btn, position, pop);
    }).catch(function (err) {
      var msg = err && err.message ? err.message : 'Unknown error';
      var pop = renderUnreachable(msg, vrfyUrl);
      placePopover(targetEl, btn, position, pop);
    }).then(function () {
      restoreButton(btn);
    });
  }

  function wireElement(targetEl) {
    if (targetEl.__tdvWired) return;
    targetEl.__tdvWired = true;

    var label = targetEl.getAttribute('data-trustdid-vrfy-label') || 'Verify';
    var position = targetEl.getAttribute('data-trustdid-vrfy-position') || 'after';

    var btn = createButton(label);
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      handleClick(targetEl, btn);
    });

    if (position === 'inside' && targetEl.appendChild) {
      targetEl.appendChild(btn);
    } else if (targetEl.parentNode) {
      targetEl.parentNode.insertBefore(btn, targetEl.nextSibling);
    }
  }

  function wireAll(root) {
    var nodes = (root || document).querySelectorAll('[data-trustdid-vrfy]');
    for (var i = 0; i < nodes.length; i++) wireElement(nodes[i]);
  }

  // ───────────────────────────────────────────────────── init + public API ──

  function mount(el, options) {
    if (!el) return;
    options = options || {};
    if (options.url)   el.setAttribute('data-trustdid-vrfy', options.url);
    else if (!el.hasAttribute('data-trustdid-vrfy')) el.setAttribute('data-trustdid-vrfy', '');
    if (options.mode)     el.setAttribute('data-trustdid-vrfy-mode', options.mode);
    if (options.label)    el.setAttribute('data-trustdid-vrfy-label', options.label);
    if (options.position) el.setAttribute('data-trustdid-vrfy-position', options.position);
    wireElement(el);
  }

  window.TrustDID = {
    __loaded: true,
    verify: verify,
    mount: mount,
    _wire: wireAll   // exposed for tests / dynamically-added content
  };

  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireAll(document); });
  } else {
    wireAll(document);
  }

  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute && n.hasAttribute('data-trustdid-vrfy')) wireElement(n);
          if (n.querySelectorAll) wireAll(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
