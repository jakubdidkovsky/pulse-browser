// Shows why Pulse Remote didn't start (an old browser, a blocked script) instead of a blank page.
// A plain script on purpose, so it still runs where the app's modules can't.
(function () {
  var START_TIMEOUT_MS = 10000;
  var errors = [];
  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '';
    errors.push((e.message || 'Script error') + where);
  });
  window.addEventListener('unhandledrejection', function (e) {
    errors.push(String((e.reason && e.reason.message) || e.reason));
  });
  setTimeout(function () {
    if (window.__pulseRemote) return;
    var box = document.createElement('div');
    box.className = 'pair';
    var title = document.createElement('h1');
    title.textContent = 'Pulse Remote didn’t start';
    var text = document.createElement('p');
    text.textContent = 'This browser couldn’t run it. Update iOS or Android, or open the link in Safari or Chrome.';
    var detail = document.createElement('pre');
    detail.className = 'boot-error';
    detail.textContent = errors.join('\n') || 'No error was reported.';
    var reload = document.createElement('button');
    reload.className = 'btn primary';
    reload.textContent = 'Reload';
    reload.onclick = function () { location.reload(); };
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(detail);
    box.appendChild(reload);
    document.body.innerHTML = '';
    document.body.appendChild(box);
  }, START_TIMEOUT_MS);
})();
