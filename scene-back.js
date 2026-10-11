/* Сцена «пара на дивані, вид зі спини» + сузір'я над ними.
   t = 0: сидять по різних кінцях, дивляться в різні боки, зірки далеко одна від одної.
   t = 1: сидять поруч, вона поклала голову йому на плече, зірки зійшлися.
   Диван нерухомий. Інтерфейс той самий, що у scene.js:  Scene(box).draw(t)  */
function Scene(box) {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible';
  box.appendChild(svg);

  var CX = 600, TOP = 300, H = 520;          /* TOP = верх спинки дивана */
  var C = {
    sofa: '#6B6E45', sofaHi: '#7C7F52', sofaArm: '#5F623C', seam: '#5A5D38',
    mSkin: '#D9A77F', mHair: '#2A221B', mTop: '#CFBBA2',
    wSkin: '#E6B892', wHair: '#9C6B3F', wTop: '#F4EFE7',
    star: '#F4EFE7', gold: '#E3C56E'
  };
  var S = 330, halfW = 600, last = 0;

  function lerp(a, b, k) { return a + (b - a) * k; }
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
  function r(n) { return Math.round(n * 10) / 10; }

  /* людина зі спини. f: -1 голова повернута ліворуч, +1 праворуч; tilt у градусах */
  function person(x, f, tilt, woman) {
    var skin = woman ? C.wSkin : C.mSkin, hair = woman ? C.wHair : C.mHair, top = woman ? C.wTop : C.mTop;
    var sw = woman ? 46 : 54;                /* пів ширини плечей */
    var o = '<g transform="translate(' + r(x) + ' ' + (TOP + 14) + ') rotate(' + r(tilt) + ') scale(1.28)">';
    o += '<path d="M' + (-sw) + ' 60Q' + (-sw) + ' -34 ' + (-sw + 30) + ' -42L-12 -48L12 -48L' + (sw - 30) + ' -42Q' + sw + ' -34 ' + sw + ' 60Z" fill="' + top + '"/>';
    o += '<rect x="-11" y="-70" width="22" height="30" rx="8" fill="' + skin + '"/>';
    o += '<g transform="translate(' + r(4 * f) + ' -98)">';
    /* щока й вухо з того боку, куди повернута голова */
    o += '<ellipse cx="' + r(22 * f) + '" cy="6" rx="' + r(8 + 7 * Math.abs(f)) + '" ry="22" fill="' + skin + '"/>';
    o += '<ellipse cx="0" cy="0" rx="28" ry="33" fill="' + hair + '"/>';
    if (Math.abs(f) > 0.3) o += '<circle cx="' + r(30 * f) + '" cy="10" r="' + r(4 * Math.abs(f)) + '" fill="' + skin + '"/>';   /* ніс */
    if (woman) o += '<path d="M-29 -4C-34 46 -28 84 -18 100L20 100C30 84 34 46 29 -4Z" fill="' + hair + '"/>';
    o += '</g></g>';
    return o;
  }

  function sofa() {
    var w = S + 130;
    var o = '<rect x="' + (CX - w) + '" y="' + TOP + '" width="' + (2 * w) + '" height="' + (H - TOP + 60) + '" rx="40" fill="' + C.sofa + '"/>';
    o += '<path d="M' + (CX - w + 34) + ' ' + (TOP + 16) + 'H' + (CX + w - 34) + '" stroke="' + C.sofaHi + '" stroke-width="10" stroke-linecap="round"/>';
    o += '<path d="M' + CX + ' ' + (TOP + 34) + 'V' + (H + 10) + '" stroke="' + C.seam + '" stroke-width="4"/>';
    o += '<rect x="' + (CX - w - 34) + '" y="' + (TOP + 46) + '" width="76" height="' + (H - TOP) + '" rx="32" fill="' + C.sofaArm + '"/>';
    o += '<rect x="' + (CX + w - 42) + '" y="' + (TOP + 46) + '" width="76" height="' + (H - TOP) + '" rx="32" fill="' + C.sofaArm + '"/>';
    return o;
  }

  /* сузір'я: дві яскраві зірки над головами, між ними ланцюжок малих */
  function stars(ax, bx, t) {
    var ay = 70, by = 52, n = 4, zig = [-1, 0.7, -0.5, 0.9];
    var amp = Math.min(1, (bx - ax) / 320) * 30, pts = [[ax, ay]], o = '';
    for (var i = 1; i <= n; i++) pts.push([lerp(ax, bx, i / (n + 1)), lerp(ay, by, i / (n + 1)) + zig[i - 1] * amp]);
    pts.push([bx, by]);
    o += '<polyline points="' + pts.map(function (p) { return r(p[0]) + ',' + r(p[1]); }).join(' ') + '" fill="none" stroke="' + C.star + '" stroke-width="1.6" opacity=".55"/>';
    for (i = 1; i <= n; i++) o += '<circle cx="' + r(pts[i][0]) + '" cy="' + r(pts[i][1]) + '" r="3" fill="' + C.star + '"/>';
    var glow = 14 + 22 * key([[0.8, 0], [1, 1]], t);
    [pts[0], pts[n + 1]].forEach(function (p) {
      o += '<circle cx="' + r(p[0]) + '" cy="' + r(p[1]) + '" r="' + r(glow) + '" fill="' + C.gold + '" opacity=".2"/>';
      o += '<circle cx="' + r(p[0]) + '" cy="' + r(p[1]) + '" r="6" fill="' + C.gold + '"/>';
    });
    return o;
  }

  function draw(t) {
    t = Math.max(0, Math.min(1, t));
    last = t;
    var d = key([[0, S], [0.3, 0.74 * S], [0.6, Math.max(0.42 * S, 118)], [0.8, 100], [1, 66]], t);
    var face = key([[0, -1], [0.25, -0.5], [0.5, 0.45], [1, 0.9]], t);         /* -1 назовні, +1 до партнера */
    var tilt = key([[0, 5], [0.45, 0], [0.8, -3], [1, -8]], t);                /* + назовні, - до партнера */
    var reach = key([[0.55, 0], [0.8, 0.55], [1, 1]], t);                      /* його рука по спинці дивана */
    var rest = key([[0.82, 0], [1, 1]], t);                                    /* вона кладе голову на плече */
    var mx = CX - d, wx = CX + d;

    var o = stars(mx, wx, t);
    o += person(wx, -face, tilt - 9 * rest, true);
    o += person(mx, face, -tilt, false);
    if (reach > 0.02) {
      var sx = mx + 56, sy = TOP - 26, hx = lerp(sx + 10, wx + 44, reach), hy = lerp(TOP - 6, TOP - 30, reach);
      o += '<path d="M' + r(sx) + ' ' + r(sy) + 'Q' + r((sx + hx) / 2) + ' ' + r(TOP - 4 - 10 * reach) + ' ' + r(hx) + ' ' + r(hy) +
        '" fill="none" stroke="' + C.mTop + '" stroke-width="30" stroke-linecap="round"/>';
      o += '<circle cx="' + r(hx) + '" cy="' + r(hy) + '" r="15" fill="' + C.mSkin + '"/>';
    }
    o += sofa();
    svg.innerHTML = o;
  }

  function fit() {
    var w = box.clientWidth || 1200, h = box.clientHeight || 400;
    halfW = Math.max(300, Math.min(900, w / (h / H) / 2));
    S = Math.max(140, Math.min(330, halfW - 175));
    svg.setAttribute('viewBox', r(CX - halfW) + ' 0 ' + r(2 * halfW) + ' ' + H);
    draw(last);
  }
  window.addEventListener('resize', fit);
  fit();
  return { draw: draw, fit: fit };
}
