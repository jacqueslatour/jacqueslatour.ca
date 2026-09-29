/*
 * bundle-download.js — build a verification bundle .zip in the browser, on demand.
 *
 * Why on-demand: a pre-built zip is a snapshot that goes stale the instant a
 * document is re-signed, so a downloaded copy can carry an old .vrfy and fail
 * verification. Building the zip at click-time always packages the CURRENT live
 * document and .vrfy, so a downloaded bundle always verifies.
 *
 * No dependencies: a minimal STORE-method (uncompressed) ZIP writer. The files
 * are a few KB of HTML/text, so skipping compression keeps this self-contained
 * and the output is a perfectly ordinary .zip any tool can open.
 *
 * Wire a button with:  <button data-bundle="legal-opinion">…</button>
 * It bundles /gallery/legal-opinion.html + .vrfy + a HOW-TO-VERIFY.txt.
 */
(function () {
  'use strict';

  var BASE = '/gallery/';
  var enc = new TextEncoder();

  // ── CRC32 ─────────────────────────────────────────────────────────────
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosStamp(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }

  // Build a STORE-method zip from [{name, bytes}]. Returns a Uint8Array.
  function makeZip(entries) {
    var stamp = dosStamp(new Date());
    var parts = [];   // local file sections
    var central = []; // central directory records
    var offset = 0;

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var crc = crc32(e.bytes);
      var size = e.bytes.length;

      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // local file header signature
      lh.setUint16(4, 20, true);           // version needed
      lh.setUint16(6, 0x0800, true);       // flag: UTF-8 name
      lh.setUint16(8, 0, true);            // method: store
      lh.setUint16(10, stamp.time, true);
      lh.setUint16(12, stamp.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);        // compressed size
      lh.setUint32(22, size, true);        // uncompressed size
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);           // extra length
      parts.push(new Uint8Array(lh.buffer), nameBytes, e.bytes);

      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);   // central dir header signature
      ch.setUint16(4, 20, true);           // version made by
      ch.setUint16(6, 20, true);           // version needed
      ch.setUint16(8, 0x0800, true);       // flag: UTF-8 name
      ch.setUint16(10, 0, true);           // method: store
      ch.setUint16(12, stamp.time, true);
      ch.setUint16(14, stamp.date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);           // extra length
      ch.setUint16(32, 0, true);           // comment length
      ch.setUint16(34, 0, true);           // disk number start
      ch.setUint16(36, 0, true);           // internal attrs
      ch.setUint32(38, 0, true);           // external attrs
      ch.setUint32(42, offset, true);      // local header offset
      central.push(new Uint8Array(ch.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    var centralSize = central.reduce(function (s, u) { return s + u.length; }, 0);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);   // end of central dir signature
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);      // central dir offset

    var all = parts.concat(central, [new Uint8Array(eocd.buffer)]);
    var total = all.reduce(function (s, u) { return s + u.length; }, 0);
    var out = new Uint8Array(total);
    var p = 0;
    all.forEach(function (u) { out.set(u, p); p += u.length; });
    return out;
  }

  // ── bundle contents ───────────────────────────────────────────────────
  function howToVerify(docFile) {
    return [
      'HOW TO VERIFY THIS DOCUMENT',
      '===========================',
      '',
      'This bundle contains three files:',
      '  - ' + docFile,
      '  - ' + docFile + '.vrfy   (its cryptographic signature manifest)',
      '  - HOW-TO-VERIFY.txt      (this file)',
      '',
      'TO VERIFY',
      '',
      '  1. Extract all files from this .zip into the same folder.',
      '',
      '  2. Check the document with TrustDID Verify:',
      '',
      '         https://trustdid.ca',
      '',
      '     Point it at ' + docFile + '.vrfy. It re-hashes ' + docFile + ' and',
      '     compares the result against the signature in the manifest.',
      '',
      'A PASS confirms two things:',
      '  - the document was signed by did:web:jacqueslatour.ca, and',
      '  - not a single byte has changed since it was signed.',
      '',
      'Keep the document and its .vrfy together and unmodified.',
      ''
    ].join('\n');
  }

  function fetchBytes(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
      return r.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    });
  }

  function triggerDownload(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after the download has had a chance to start.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function buildBundle(btn) {
    var slug = btn.getAttribute('data-bundle');
    if (!slug) return;
    var docFile = slug + '.html';
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building…';

    Promise.all([
      fetchBytes(BASE + docFile),
      fetchBytes(BASE + docFile + '.vrfy')
    ]).then(function (pair) {
      var zip = makeZip([
        { name: docFile, bytes: pair[0] },
        { name: docFile + '.vrfy', bytes: pair[1] },
        { name: 'HOW-TO-VERIFY.txt', bytes: enc.encode(howToVerify(docFile)) }
      ]);
      triggerDownload(zip, slug + '-bundle.zip');
      btn.disabled = false;
      btn.textContent = label;
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Download failed — retry';
      // Surface the reason for debugging without alert() noise in the demo.
      if (window.console) console.error('[bundle-download]', err);
      setTimeout(function () { btn.textContent = label; }, 3000);
    });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-bundle]') : null;
    if (!btn) return;
    ev.preventDefault();
    buildBundle(btn);
  });
})();
