// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });
  }
});

// .vrfy manifest inline viewer (progressive enhancement)
(function initVrfyViewer() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVrfyViewer);
    return;
  }
  var vrfyLinks = document.querySelectorAll('a.vrfy-link');
  vrfyLinks.forEach(function (link) {
    var href = link.getAttribute('href');
    if (!href) return;

    // Build wrapper
    var viewer = document.createElement('div');
    viewer.className = 'vrfy-viewer';

    // Toggle button
    var btn = document.createElement('button');
    btn.className = 'vrfy-toggle';
    btn.type = 'button';
    btn.innerHTML = 'View .vrfy manifest &#x25B6;';

    // Preview panel (hidden)
    var panel = document.createElement('div');
    panel.className = 'manifest-preview';
    panel.style.display = 'none';
    var pre = document.createElement('pre');
    panel.appendChild(pre);

    // Raw download link (hidden)
    var rawLink = link.cloneNode(false);
    rawLink.className = 'vrfy-raw-link';
    rawLink.textContent = 'Download raw .vrfy file \u2192';
    rawLink.setAttribute('download', '');
    rawLink.style.display = 'none';

    // Assemble
    viewer.appendChild(btn);
    viewer.appendChild(panel);
    viewer.appendChild(rawLink);
    link.parentNode.replaceChild(viewer, link);

    // State
    var fetched = false;
    var open = false;

    btn.addEventListener('click', function () {
      open = !open;
      if (open) {
        btn.innerHTML = 'View .vrfy manifest &#x25BC;';
        panel.style.display = '';
        rawLink.style.display = '';
        if (!fetched) {
          pre.textContent = 'Loading\u2026';
          fetch(href)
            .then(function (r) { return r.text(); })
            .then(function (text) {
              fetched = true;
              // Strip comment lines (// ...)
              var lines = text.split('\n');
              var jsonLines = [];
              var inComment = true;
              for (var i = 0; i < lines.length; i++) {
                if (inComment && lines[i].match(/^\s*\/\//)) continue;
                inComment = false;
                jsonLines.push(lines[i]);
              }
              var jsonStr = jsonLines.join('\n').trim();
              try {
                var obj = JSON.parse(jsonStr);
                pre.innerHTML = highlightJson(JSON.stringify(obj, null, 2));
              } catch (e) {
                // Show raw text if not valid JSON
                pre.textContent = jsonStr;
              }
            })
            .catch(function () {
              pre.textContent = 'Failed to load .vrfy file.';
            });
        }
      } else {
        btn.innerHTML = 'View .vrfy manifest &#x25B6;';
        panel.style.display = 'none';
        rawLink.style.display = 'none';
      }
    });
  });

  function highlightJson(json) {
    // Escape HTML first
    var html = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Syntax highlight
    return html.replace(
      /("(?:\\.|[^"\\])*")\s*:/g,
      '<span class="key">$1</span>:'
    ).replace(
      /:\s*("(?:\\.|[^"\\])*")/g,
      function (match, val) {
        // Truncate very long base64 values (pqManifestProof)
        var raw = val.slice(1, -1); // strip quotes
        if (raw.length > 120) {
          var short = raw.substring(0, 80) + '\u2026 (' + raw.length + ' chars)';
          return ': <span class="string">"' + short + '"</span>';
        }
        return ': <span class="string">' + val + '</span>';
      }
    );
  }
})();
