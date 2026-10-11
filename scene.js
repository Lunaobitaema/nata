/* Сцена «пара на дивані». Малює SVG у контейнері й уміє плавно
   переходити від t = 0 (сидять по різних кінцях, дивляться в різні боки)
   до t = 1 (сидять в обіймах). Диван при цьому не рухається.
   Використання:  const s = Scene(document.getElementById('stage'));  s.draw(0.4);  */
function Scene(box) {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.style.cssText = 'display:block;width:100%;height:100%';
  box.appendChild(svg);

  var CX = 600, SEAT = 350, H = 520;
  var C = {
    sofaBack: '#6B6E45', sofaSeat: '#7C7F52', sofaArm: '#5F623C', sofaBase: '#55583A', rug: '#3A3D26',
    line: '#CFBBA2',
    mSkin: '#D9A77F', mHair: '#2A221B', mTop: '#CFBBA2', mLeg: '#3B3024', mShoe: '#17180F',
    wSkin: '#E6B892', wHair: '#9C6B3F', wTop: '#F4EFE7', wLeg: '#B98A5E', wShoe: '#F4EFE7'
  };
  var S = 350, halfW = 600, last = 0;

  function lerp(a, b, k) { return a + (b - a) * k; }
  /* значення за ключовими кадрами: keys = [[t, v], ...] */
  function key(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        var k = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        k = k * k * (3 - 2 * k);
        return lerp(keys[i - 1][1], keys[i][1], k);
      }
    }
    return keys[keys.length - 1][1];
  }
  function rot(x, y, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }
  function r(n) { return Math.round(n * 10) / 10; }

  function sofa() {
    var w = S + 150, o = '';
    o += '<ellipse cx="' + CX + '" cy="474" rx="' + (w + 110) + '" ry="15" fill="' + C.rug + '"/>';
    /* картини на стіні */
    o += '<g fill="none" stroke="' + C.line + '" stroke-width="3" opacity=".3">' +
      '<rect x="' + (CX - 120) + '" y="60" width="96" height="120" rx="3"/>' +
      '<path d="M' + (CX - 108) + ' 160l26-40 20 26 14-18 22 32"/>' +
      '<rect x="' + (CX + 10) + '" y="86" width="120" height="94" rx="3"/>' +
      '<circle cx="' + (CX + 70) + '" cy="133" r="24"/></g>';
    o += '<rect x="' + (CX - w) + '" y="192" width="' + (2 * w) + '" height="200" rx="44" fill="' + C.sofaBack + '"/>';
    o += '<rect x="' + (CX - w + 20) + '" y="346" width="' + (2 * w - 40) + '" height="68" rx="22" fill="' + C.sofaSeat + '"/>';
    o += '<rect x="' + (CX - w + 26) + '" y="404" width="' + (2 * w - 52) + '" height="42" rx="10" fill="' + C.sofaBase + '"/>';
    o += '<path d="M' + CX + ' 352v56" stroke="' + C.sofaBase + '" stroke-width="4" stroke-linecap="round"/>';
    o += '<rect x="' + (CX - w - 34) + '" y="285" width="70" height="162" rx="30" fill="' + C.sofaArm + '"/>';
    o += '<rect x="' + (CX + w - 36) + '" y="285" width="70" height="162" rx="30" fill="' + C.sofaArm + '"/>';
    o += '<rect x="' + (CX - w + 6) + '" y="444" width="16" height="26" rx="5" fill="' + C.mShoe + '"/>';
    o += '<rect x="' + (CX + w - 22) + '" y="444" width="16" height="26" rx="5" fill="' + C.mShoe + '"/>';
    /* коробки після переїзду, якщо є місце */
    if (halfW > w + 300) {
      var bx = CX - w - 250;
      o += '<g fill="#8A6E4B"><rect x="' + bx + '" y="372" width="150" height="98" rx="4"/>' +
        '<rect x="' + (bx + 22) + '" y="300" width="112" height="72" rx="4" fill="#9A7C55"/></g>' +
        '<path d="M' + (bx + 75) + ' 372v34M' + (bx + 78) + ' 300v26" stroke="' + C.line + '" stroke-width="12" opacity=".55"/>';
      var px = CX + w + 150;
      o += '<path d="M' + px + ' 400c-40-60-36-120-10-170M' + px + ' 400c10-70 44-110 84-126M' + px + ' 400c-4-80 10-150 30-190M' + px + ' 400c-50-30-84-70-92-120" ' +
        'fill="none" stroke="#7E8A4F" stroke-width="14" stroke-linecap="round"/>' +
        '<path d="M' + (px - 42) + ' 396h84l-12 74h-60z" fill="#B98A5E"/>';
    }
    return o;
  }

  /* рука: від плеча до кисті з вигином у лікті */
  function arm(sx, sy, hx, hy, bend, col, skin) {
    var mx = (sx + hx) / 2, my = (sy + hy) / 2 + bend;
    return '<path d="M' + r(sx) + ' ' + r(sy) + 'Q' + r(mx) + ' ' + r(my) + ' ' + r(hx) + ' ' + r(hy) + '" fill="none" stroke="' + col +
      '" stroke-width="25" stroke-linecap="round"/><circle cx="' + r(hx) + '" cy="' + r(hy) + '" r="12" fill="' + skin + '"/>';
  }
  function legs(x, leg, shoe) {
    return '<rect x="' + r(x - 42) + '" y="' + (SEAT - 22) + '" width="38" height="128" rx="18" fill="' + leg + '"/>' +
      '<rect x="' + r(x + 4) + '" y="' + (SEAT - 22) + '" width="38" height="128" rx="18" fill="' + leg + '"/>' +
      '<rect x="' + r(x - 48) + '" y="' + (SEAT + 102) + '" width="46" height="20" rx="10" fill="' + shoe + '"/>' +
      '<rect x="' + r(x + 2) + '" y="' + (SEAT + 102) + '" width="46" height="20" rx="10" fill="' + shoe + '"/>';
  }
  /* тулуб і голова. f: -1 дивиться ліворуч, +1 праворуч */
  function bodyOf(x, lean, f, tilt, woman) {
    var skin = woman ? C.wSkin : C.mSkin, hair = woman ? C.wHair : C.mHair, top = woman ? C.wTop : C.mTop;
    var o = '<g transform="translate(' + r(x) + ' ' + SEAT + ') rotate(' + r(lean) + ')">';
    o += '<rect x="-47" y="-152" width="94" height="170" rx="38" fill="' + top + '"/>';
    o += '<rect x="-13" y="-176" width="26" height="34" rx="10" fill="' + skin + '"/>';
    o += '<g transform="translate(0 -170) rotate(' + r(tilt) + ') translate(0 -38)">';
    if (woman) o += '<rect x="' + r(-42 - 8 * f) + '" y="-34" width="84" height="104" rx="38" fill="' + hair + '"/>';
    o += '<circle r="36" fill="' + skin + '"/>';
    o += '<circle cx="' + r(36 * f) + '" cy="6" r="6.5" fill="' + skin + '"/>';
    o += '<circle cx="' + r(17 * f - 9) + '" cy="-2" r="2.8" fill="#2A221B"/><circle cx="' + r(17 * f + 9) + '" cy="-2" r="2.8" fill="#2A221B"/>';
    o += '<path d="M-37 -4a37 37 0 0 1 74 0q-14-20-37-20t-37 20z" transform="translate(' + r(-7 * f) + ' 0)" fill="' + hair + '"/>';
    o += '</g></g>';
    return o;
  }

  function draw(t) {
    t = Math.max(0, Math.min(1, t));
    last = t;
    /* половина відстані між ними */
    var d = key([[0, S], [0.25, 0.8 * S], [0.5, Math.max(0.55 * S, 128)], [0.72, 112], [1, 68]], t);
    var lean = key([[0, 9], [0.25, 3], [0.5, 0], [0.72, -3], [1, -6]], t);      /* + назовні, - одне до одного */
    var face = key([[0, -1], [0.2, -0.75], [0.48, 0.85], [1, 0.9]], t);        /* -1 назовні, +1 до партнера */
    var hold = key([[0.5, 0], [0.72, 1]], t);                                   /* беруться за руки */
    var hug = key([[0.76, 0], [1, 1]], t);                                      /* обійми */
    var wTilt = key([[0.8, 0], [1, 1]], t);

    var mx = CX - d, wx = CX + d;
    var mLean = -lean, wLean = lean;                 /* чоловік ліворуч: назовні = нахил ліворуч */
    function sh(x, ln, side) { var p = rot(side * 38, -132, ln); return [x + p[0], SEAT + p[1]]; }
    var mIn = sh(mx, mLean, 1), mOut = sh(mx, mLean, -1), wIn = sh(wx, wLean, -1), wOut = sh(wx, wLean, 1);

    /* внутрішні руки: коліна -> разом посередині -> обійми */
    var mid = [CX, SEAT - 30];
    var mHand = [lerp(mx + 16, mid[0] - 9, hold), lerp(SEAT - 28, mid[1], hold)];
    var wHand = [lerp(wx - 16, mid[0] + 9, hold), lerp(SEAT - 28, mid[1], hold)];
    var mBend = lerp(30, 34, hold), wBend = lerp(30, 34, hold);
    if (hug > 0) {
      mHand = [lerp(mHand[0], wOut[0] + 6, hug), lerp(mHand[1], wOut[1] + 22, hug)];
      mBend = lerp(mBend, -26, hug);
      wHand = [lerp(wHand[0], mx + 14, hug), lerp(wHand[1], SEAT - 78, hug)];
      wBend = lerp(wBend, 26, hug);
    }
    /* зовнішні руки: схрещені на грудях -> на колінах */
    var open = key([[0.1, 0], [0.4, 1]], t);
    var mOutHand = [mx + lerp(22, -18, open), SEAT - lerp(86, 26, open)];
    var wOutHand = [wx + lerp(-22, 18, open), SEAT - lerp(86, 26, open)];
    var closed = 1 - key([[0.15, 0], [0.45, 1]], t);  /* на початку внутрішня рука теж схрещена */
    mHand = [lerp(mHand[0], mx - 20, closed), lerp(mHand[1], SEAT - 74, closed)];
    wHand = [lerp(wHand[0], wx + 20, closed), lerp(wHand[1], SEAT - 74, closed)];

    var o = sofa();
    if (hug > 0.25) o += arm(mIn[0], mIn[1], mHand[0], mHand[1], mBend, C.mTop, C.mSkin);  /* рука за спиною жінки */
    o += bodyOf(wx, wLean, -face, -11 * wTilt, true);
    o += bodyOf(mx, mLean, face, 7 * wTilt, false);
    o += legs(mx, C.mLeg, C.mShoe) + legs(wx, C.wLeg, C.wShoe);
    o += arm(mOut[0], mOut[1], mOutHand[0], mOutHand[1], 26, C.mTop, C.mSkin);
    o += arm(wOut[0], wOut[1], wOutHand[0], wOutHand[1], 26, C.wTop, C.wSkin);
    if (hug <= 0.25) o += arm(mIn[0], mIn[1], mHand[0], mHand[1], mBend, C.mTop, C.mSkin);
    else o += '<circle cx="' + r(mHand[0]) + '" cy="' + r(mHand[1]) + '" r="12" fill="' + C.mSkin + '"/>';
    o += arm(wIn[0], wIn[1], wHand[0], wHand[1], wBend, C.wTop, C.wSkin);
    svg.innerHTML = o;
  }

  /* підлаштовує ширину сцени під контейнер: на вузькому екрані диван коротший */
  function fit() {
    var w = box.clientWidth || 1200, h = box.clientHeight || 400;
    halfW = Math.max(300, Math.min(900, w / (h / H) / 2));
    S = Math.max(150, Math.min(350, halfW - 195));
    svg.setAttribute('viewBox', r(CX - halfW) + ' 0 ' + r(2 * halfW) + ' ' + H);
    draw(last);
  }
  window.addEventListener('resize', fit);
  fit();
  return { draw: draw, fit: fit };
}
