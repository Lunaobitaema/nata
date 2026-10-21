/* Meta Pixel із запитом згоди на cookie.
   Піксель завантажується лише після натискання «Прийняти» (аудиторія курсу — переважно в ЄС).
   Вибір зберігається в браузері відвідувача; змінити його можна, очистивши дані сайту. */
(function () {
  var PIXEL_ID = '1624644415826344';
  var KEY = 'nk_consent';

  function load() {
    if (window.fbq) return;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  // Подія для інших скриптів сторінки: спрацьовує лише за наявності згоди
  window.nkTrack = function (event, params, opts) {
    if (window.fbq) window.fbq('track', event, params || {}, opts || {});
  };

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function banner() {
    var css = document.createElement('style');
    css.textContent =
      '.nk-cookie{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;background:#1B1C14;color:#F2ECE2;' +
      'border:1px solid rgba(242,236,226,.22);border-radius:18px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px/1.5 Montserrat,system-ui,sans-serif}' +
      '.nk-cookie p{margin:0 0 12px}.nk-cookie a{color:#CFBBA2}' +
      '.nk-cookie .b{display:flex;gap:10px;flex-wrap:wrap}' +
      '.nk-cookie button{font:inherit;font-weight:700;border-radius:999px;padding:9px 18px;cursor:pointer;border:1px solid #F4EFE7}' +
      '.nk-cookie .y{background:#F4EFE7;color:#27281F}.nk-cookie .n{background:transparent;color:#F2ECE2}';
    document.head.appendChild(css);
    var box = document.createElement('div');
    box.className = 'nk-cookie';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Згода на cookie');
    box.innerHTML = '<p>Ми використовуємо cookie Meta Pixel, щоб вимірювати ефективність реклами. ' +
      'Детальніше — у <a href="/privacy.html">Політиці конфіденційності</a>.</p>' +
      '<div class="b"><button type="button" class="y">Прийняти</button><button type="button" class="n">Відхилити</button></div>';
    box.querySelector('.y').onclick = function () { set('yes'); box.remove(); load(); };
    box.querySelector('.n').onclick = function () { set('no'); box.remove(); };
    (document.body || document.documentElement).appendChild(box);
  }

  var c = get();
  if (c === 'yes') load();
  else if (c !== 'no') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
  }
})();
