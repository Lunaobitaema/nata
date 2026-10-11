/* Перемикач варіантів дизайну. Потрібен лише на час вибору:
   щоб прибрати панель, видаліть рядок <script src="variants.js"></script> зі сторінок. */
(function () {
  var V = [
    ['index.html', 'Поточний'],
    ['v2.html', 'Листування'],
    ['v3.html', 'Лист'],
    ['v4.html', 'Маршрут'],
    ['v5.html', 'Зошит'],
    ['v6.html', 'Плакат'],
    ['v7.html', 'Диван'],
    ['v8.html', 'Зближення'],
    ['v9.html', 'Зорі'],
    ['v10.html', 'Фото']
  ];
  var cur = location.pathname.split('/').pop() || 'index.html';
  var H = 48;
  var css =
    '#vbar{position:fixed;top:0;left:0;right:0;height:' + H + 'px;z-index:9999;background:#111;color:#fff;' +
    'display:flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;' +
    'font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '#vbar span{opacity:.7;margin-right:6px;white-space:nowrap}' +
    '#vbar a{display:flex;align-items:center;justify-content:center;min-width:36px;height:34px;padding:0 10px;' +
    'border-radius:8px;background:#2a2a2a;color:#fff;text-decoration:none;white-space:nowrap}' +
    '#vbar a:hover{background:#444}' +
    '#vbar a[aria-current]{background:#fff;color:#111}' +
    '#vbar a b{font-weight:700}#vbar a i{font-style:normal;font-weight:500;margin-left:6px}' +
    '@media (max-width:900px){#vbar a i{display:none}#vbar a[aria-current] i{display:inline}}' +
    '@media (max-width:1100px){#vbar a i{display:none}#vbar a[aria-current] i{display:inline}}' +
    '@media (max-width:560px){#vbar span{display:none}#vbar{gap:2px}#vbar a{min-width:26px;padding:0 5px}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var bar = document.createElement('nav');
  bar.id = 'vbar';
  bar.setAttribute('aria-label', 'Варіанти дизайну');
  var h = '<span>Варіант дизайну</span>';
  V.forEach(function (v, i) {
    var on = v[0] === cur;
    h += '<a href="' + v[0] + '"' + (on ? ' aria-current="page"' : '') + ' title="' + v[1] + '"><b>' + (i + 1) + '</b><i>' + v[1] + '</i></a>';
  });
  bar.innerHTML = h;
  document.body.insertBefore(bar, document.body.firstChild);
  document.documentElement.style.setProperty('--vb', H + 'px');
  document.body.style.paddingTop = H + 'px';
})();
