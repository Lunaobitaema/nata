// Сервер сайту natalyakovalenko.com.ua (Cloudflare Worker).
// Статичні сторінки віддає Cloudflare сам (папка репозиторію), а цей код обробляє:
//   /pay/uah, /pay/eur      — створення замовлення і перехід на оплату WayForPay
//   /pay/return             — повернення клієнтки з WayForPay
//   /api/wfp                — підтвердження оплати від WayForPay (serviceUrl)
//   /api/order              — статус замовлення для сторінки «Дякуємо»
//   /api/pay-methods        — які способи оплати підключені
//   /api/tg                 — повідомлення від Telegram (webhook бота)
//   /api/setup              — одноразове підключення бота до сайту
//   /admin, /api/admin/*    — адмінка
//   cron (кожні 10 хв)      — розсилка лекцій за розкладом
//
// Секрети (Cloudflare → Worker → Settings → Variables and Secrets, тип Secret):
//   BOT_TOKEN          токен Telegram-бота від @BotFather
//   APP_SECRET         довільний довгий рядок (30+ символів), з нього виводяться службові ключі
//   ADMIN_CODE         код, яким адміністратор підключається в боті: /admin КОД
//   WFP_UAH_ACCOUNT, WFP_UAH_SECRET   мерчант WayForPay для гривні
//   WFP_EUR_ACCOUNT, WFP_EUR_SECRET   мерчант WayForPay для євро
//   PAY_EUR            "1" — показати кнопку оплати в євро (за замовчуванням вимкнено)
//   WFP_TEST           "1" — оплати через тестовий мерчант WayForPay (гроші не списуються)
//   RESEND_API_KEY     (необов'язково) ключ Resend для листа з посиланням на курс
//   MAIL_FROM          (необов'язково) адреса відправника, напр. "Наталя Коваленко <kurs@natalyakovalenko.com.ua>"

import COURSE from './course.json';
import ADMIN_HTML from './admin.html';
import { hmacMd5 } from './md5.js';

const WFP_TEST_ACCOUNT = 'test_merch_n1';
const WFP_TEST_SECRET = 'flk3409refn54t54t*FNJRET'; // публічні тестові дані з документації WayForPay
const LESSONS = COURSE.lessons.length;
const enc = new TextEncoder();

// ───────────────────────── утиліти ─────────────────────────

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();

function randomToken(len = 24) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => abc[x % abc.length]).join('');
}

async function hmacSha256(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

const siteUrl = (env) => (env.SITE_URL || 'https://natalyakovalenko.com.ua').replace(/\/$/, '');
const botUser = (env) => env.BOT_USERNAME || 'natalyakovalenko_bot';
const botLink = (env, token) => `https://t.me/${botUser(env)}?start=${token}`;
const timeLabel = () => `${COURSE.schedule.hour}:${String(COURSE.schedule.minute).padStart(2, '0')}`;

// ───────────────────────── час за Києвом ─────────────────────────

function zoneParts(ms, tz = COURSE.schedule.timezone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

function zonedToUtc(y, m, d, h, mi, tz = COURSE.schedule.timezone) {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess -= asUtc - Date.UTC(y, m - 1, d, h, mi);
  }
  return guess;
}

// наступний слот розсилки: завжди НАСТУПНИЙ календарний день (за Києвом) о 11:00
function nextSlot(fromMs, days = 1) {
  const p = zoneParts(fromMs);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return zonedToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), COURSE.schedule.hour, COURSE.schedule.minute);
}

function fmtKyiv(ms) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('uk-UA', { timeZone: COURSE.schedule.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

// ───────────────────────── база даних ─────────────────────────

let schemaReady = false;
async function db(env) {
  if (!schemaReady) {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS orders (
        ref TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, method TEXT, amount REAL, currency TEXT,
        status TEXT NOT NULL DEFAULT 'created', test INTEGER DEFAULT 0,
        created_at INTEGER, paid_at INTEGER, email TEXT, phone TEXT, name TEXT, card TEXT, wfp_status TEXT,
        chat_id INTEGER, tg_username TEXT, tg_name TEXT, activated_at INTEGER,
        next_step INTEGER DEFAULT 1, next_at INTEGER, done_at INTEGER, paused INTEGER DEFAULT 0,
        note TEXT, source TEXT)`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_due ON orders(next_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_chat ON orders(chat_id)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS lessons (n INTEGER PRIMARY KEY, file_id TEXT, file_type TEXT, doc_id TEXT, doc_name TEXT, updated_at INTEGER)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS admins (chat_id INTEGER PRIMARY KEY, name TEXT, added_at INTEGER)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS fwd (admin_chat INTEGER, admin_msg INTEGER, user_chat INTEGER, at INTEGER, PRIMARY KEY (admin_chat, admin_msg))'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, kind TEXT, text TEXT, at INTEGER)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
    ]);
    schemaReady = true;
  }
  return env.DB;
}

const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const logEvent = (env, ref, kind, text) => run(env, 'INSERT INTO log (ref, kind, text, at) VALUES (?, ?, ?, ?)', ref || null, kind, String(text).slice(0, 1000), now());
async function getMeta(env, k) { const r = await one(env, 'SELECT v FROM meta WHERE k = ?', k); return r ? r.v : null; }
const setMeta = (env, k, v) => run(env, 'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));

// ───────────────────────── Telegram ─────────────────────────

async function tg(env, method, payload) {
  if (!env.BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN not set' };
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
}

const say = (env, chat_id, text, extra = {}) => tg(env, 'sendMessage', { chat_id, text, disable_web_page_preview: true, ...extra });

async function notifyAdmins(env, text) {
  const admins = await all(env, 'SELECT chat_id FROM admins');
  await Promise.all(admins.map((a) => say(env, a.chat_id, text)));
  return admins.length;
}

const webhookSecret = async (env) => (await hmacSha256(env.APP_SECRET || 'x', 'tg-webhook')).slice(0, 48);

// ───────────────────────── WayForPay ─────────────────────────

// Оплата в євро вмикається змінною PAY_EUR = "1" (і мерчантом WFP_EUR_*). Поки вимкнено — кнопки на сайті немає.
const eurEnabled = (env) => env.PAY_EUR === '1';

function merchant(env, method) {
  if (method === 'eur' && !eurEnabled(env)) return null;
  if (env.WFP_TEST === '1') return { account: WFP_TEST_ACCOUNT, secret: WFP_TEST_SECRET, test: true };
  if (method === 'uah' && env.WFP_UAH_ACCOUNT && env.WFP_UAH_SECRET) return { account: env.WFP_UAH_ACCOUNT, secret: env.WFP_UAH_SECRET };
  if (method === 'eur' && env.WFP_EUR_ACCOUNT && env.WFP_EUR_SECRET) return { account: env.WFP_EUR_ACCOUNT, secret: env.WFP_EUR_SECRET };
  return null;
}

const payMethods = (env) => ({ uah: !!merchant(env, 'uah'), eur: !!merchant(env, 'eur'), test: env.WFP_TEST === '1' });

async function startPayment(env, method, url) {
  const m = merchant(env, method);
  const price = COURSE.prices[method];
  if (!m || !price) return html(page('Оплата недоступна', '<p>Цей спосіб оплати ще не підключено. Спробуйте інший або напишіть нам.</p>'), 404);
  await db(env);
  const ref = `NK-${method.toUpperCase()}-${Date.now().toString(36)}-${randomToken(4)}`;
  const token = randomToken(24);
  const t = Math.floor(now() / 1000);
  const source = (url.searchParams.get('src') || '').slice(0, 120);
  await run(env, 'INSERT INTO orders (ref, token, method, amount, currency, status, test, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ref, token, method, price.amount, price.currency, 'created', m.test ? 1 : 0, now(), source);
  const site = siteUrl(env);
  const domain = new URL(site).hostname;
  const f = {
    merchantAccount: m.account,
    merchantAuthType: 'SimpleSignature',
    merchantDomainName: domain,
    merchantTransactionSecureType: 'AUTO',
    orderReference: ref,
    orderDate: String(t),
    amount: String(price.amount),
    currency: price.currency,
    'productName[]': COURSE.product,
    'productPrice[]': String(price.amount),
    'productCount[]': '1',
    returnUrl: `${site}/pay/return?ref=${encodeURIComponent(ref)}`,
    serviceUrl: `${site}/api/wfp`,
    language: 'UA',
  };
  f.merchantSignature = hmacMd5(m.secret, [f.merchantAccount, f.merchantDomainName, f.orderReference, f.orderDate, f.amount, f.currency, f['productName[]'], f['productCount[]'], f['productPrice[]']].join(';'));
  const inputs = Object.entries(f).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return html(page('Перехід до оплати', `<p>Переходимо до захищеної сторінки оплати WayForPay…</p>
<form id="f" method="post" action="https://secure.wayforpay.com/pay" accept-charset="utf-8">${inputs}<button class="btn" type="submit">Перейти до оплати</button></form>
<script>document.getElementById('f').submit()</script>`));
}

async function wfpCallback(env, request) {
  await db(env);
  const raw = await request.text();
  let d;
  try { d = JSON.parse(raw); } catch {
    try { const p = new URLSearchParams(raw); const k = [...p.keys()][0]; d = JSON.parse(k); } catch { d = null; }
  }
  if (!d || !d.orderReference) return json({ error: 'bad request' }, 400);
  const order = await one(env, 'SELECT * FROM orders WHERE ref = ?', d.orderReference);
  if (!order) { await logEvent(env, d.orderReference, 'wfp', 'unknown order'); return json({ error: 'unknown order' }, 404); }
  const m = merchant(env, order.method) || (order.test ? { secret: WFP_TEST_SECRET } : null);
  if (!m) return json({ error: 'merchant not configured' }, 500);
  const expected = hmacMd5(m.secret, [d.merchantAccount, d.orderReference, d.amount, d.currency, d.authCode, d.cardPan, d.transactionStatus, d.reasonCode].join(';'));
  if (!safeEqual(expected, d.merchantSignature)) {
    await logEvent(env, order.ref, 'wfp', 'bad signature');
    return json({ error: 'bad signature' }, 403);
  }
  const status = d.transactionStatus;
  if (status === 'Approved' && order.status !== 'paid') {
    if (Number(d.amount) !== Number(order.amount) || d.currency !== order.currency) {
      await logEvent(env, order.ref, 'wfp', `amount mismatch ${d.amount} ${d.currency}`);
    } else {
      await run(env, `UPDATE orders SET status = 'paid', paid_at = ?, email = ?, phone = ?, card = ?, wfp_status = ?,
        name = COALESCE(name, ?) WHERE ref = ?`,
      now(), d.email || null, d.phone || null, d.cardPan || null, status, [d.clientFirstName, d.clientLastName].filter(Boolean).join(' ') || null, order.ref);
      await logEvent(env, order.ref, 'paid', `${d.amount} ${d.currency}`);
      const fresh = await one(env, 'SELECT * FROM orders WHERE ref = ?', order.ref);
      await notifyAdmins(env, `💳 Нова оплата${order.test ? ' (ТЕСТ)' : ''}: ${d.amount} ${d.currency}\n${d.email || ''} ${d.phone || ''}\nЗамовлення ${order.ref}`);
      await sendAccessEmail(env, fresh).catch((e) => logEvent(env, order.ref, 'email', `error ${e.message}`));
    }
  } else if (['Refunded', 'Voided'].includes(status)) {
    await run(env, "UPDATE orders SET status = 'refunded', paused = 1, wfp_status = ? WHERE ref = ?", status, order.ref);
    await logEvent(env, order.ref, 'refund', status);
    await notifyAdmins(env, `↩️ Повернення коштів: ${order.ref} (${status}). Розсилку зупинено.`);
  } else if (['Declined', 'Expired'].includes(status) && order.status === 'created') {
    await run(env, "UPDATE orders SET status = 'declined', wfp_status = ? WHERE ref = ?", status, order.ref);
  } else {
    await run(env, 'UPDATE orders SET wfp_status = ? WHERE ref = ?', status || null, order.ref);
  }
  const time = Math.floor(now() / 1000);
  return json({ orderReference: d.orderReference, status: 'accept', time, signature: hmacMd5(m.secret, `${d.orderReference};accept;${time}`) });
}

async function sendAccessEmail(env, order) {
  if (!env.RESEND_API_KEY || !order.email) return false;
  const vars = { bot: botLink(env, order.token), time: timeLabel(), site: siteUrl(env) };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Наталя Коваленко <kurs@natalyakovalenko.com.ua>', to: [order.email], subject: COURSE.texts.email_subject, text: fill(COURSE.texts.email_body, vars) }),
  });
  await logEvent(env, order.ref, 'email', r.ok ? 'sent' : `error ${r.status}`);
  return r.ok;
}

// ───────────────────────── курс: розсилка ─────────────────────────

async function lessonFiles(env) {
  const rows = await all(env, 'SELECT * FROM lessons');
  return Object.fromEntries(rows.map((r) => [r.n, r]));
}

// надіслати лекцію n у чат (без зміни прогресу)
async function sendLesson(env, chat_id, n, files) {
  const L = COURSE.lessons[n - 1];
  const f = files[n] || {};
  const caption = `${L.title}\n\n${L.text}`;
  let res;
  if (f.file_id) {
    const method = f.file_type === 'document' ? 'sendDocument' : 'sendVideo';
    const field = f.file_type === 'document' ? 'document' : 'video';
    res = await tg(env, method, { chat_id, [field]: f.file_id, caption: caption.slice(0, 1024), supports_streaming: true });
    if (res.ok && caption.length > 1024) await say(env, chat_id, caption.slice(1024));
  } else {
    res = await say(env, chat_id, caption);
  }
  if (res.ok && f.doc_id) await tg(env, 'sendDocument', { chat_id, document: f.doc_id });
  return { ok: !!res.ok, error: res.description, missingVideo: !f.file_id };
}

async function deliverStep(env, o, files) {
  const step = o.next_step || 1;
  if (step <= LESSONS) {
    const r = await sendLesson(env, o.chat_id, step, files);
    if (!r.ok) return deliveryFailed(env, o, r.error);
    if (r.missingVideo) await notifyAdmins(env, `⚠️ Лекцію ${step} надіслано БЕЗ відео (відео не привʼязане). Учасниця: ${o.tg_name || o.email || o.ref}`);
    const nextStep = step + 1;
    const nextAt = nextStep <= LESSONS ? nextSlot(now()) : nextSlot(now(), COURSE.schedule.final_after_days);
    await run(env, 'UPDATE orders SET next_step = ?, next_at = ? WHERE ref = ?', nextStep, nextAt, o.ref);
    await logEvent(env, o.ref, 'lesson', `lesson ${step} sent`);
  } else {
    const r = await say(env, o.chat_id, COURSE.texts.final);
    if (!r.ok) return deliveryFailed(env, o, r.description);
    await run(env, 'UPDATE orders SET next_at = NULL, done_at = ? WHERE ref = ?', now(), o.ref);
    await logEvent(env, o.ref, 'done', 'final message sent');
  }
  return true;
}

async function deliveryFailed(env, o, error) {
  const blocked = /blocked|deactivated|chat not found/i.test(error || '');
  if (blocked) await run(env, 'UPDATE orders SET paused = 1 WHERE ref = ?', o.ref);
  else await run(env, 'UPDATE orders SET next_at = ? WHERE ref = ?', now() + 30 * 60 * 1000, o.ref); // повтор через 30 хв
  await logEvent(env, o.ref, 'error', error);
  await notifyAdmins(env, `❗ Не вдалося надіслати учасниці ${o.tg_name || o.email || o.ref}: ${error}${blocked ? '\nСхоже, вона заблокувала бота. Розсилку поставлено на паузу.' : '\nСпробую ще раз за 30 хвилин.'}`);
  return false;
}

async function runSchedule(env) {
  await db(env);
  await setMeta(env, 'cron_last', now());
  const due = await all(env, `SELECT * FROM orders WHERE next_at IS NOT NULL AND next_at <= ? AND paused = 0 AND done_at IS NULL
    AND chat_id IS NOT NULL AND status IN ('paid', 'manual') ORDER BY next_at LIMIT 40`, now());
  if (!due.length) return 0;
  const files = await lessonFiles(env);
  let sent = 0;
  for (const o of due) if (await deliverStep(env, o, files)) sent++;
  return sent;
}

// ───────────────────────── бот ─────────────────────────

async function handleUpdate(env, u) {
  await db(env);
  const msg = u.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const chat = msg.chat.id;
  const from = msg.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'друже';
  const text = (msg.text || '').trim();
  const isAdmin = !!(await one(env, 'SELECT 1 AS x FROM admins WHERE chat_id = ?', chat));

  // підключення адміністратора: /admin КОД
  if (text.startsWith('/admin')) {
    const code = text.split(/\s+/)[1] || '';
    if (env.ADMIN_CODE && safeEqual(code, env.ADMIN_CODE)) {
      await run(env, 'INSERT OR REPLACE INTO admins (chat_id, name, added_at) VALUES (?, ?, ?)', chat, name, now());
      await say(env, chat, `✅ ${name}, вас додано як адміністратора.\n\nВи отримуватимете сповіщення про оплати й повідомлення від учасниць, а також коди входу в адмінку.\n\nЯк привʼязати відео: надішліть сюди відео з підписом L1 (для лекції 1), L2 … L${LESSONS}. Файл-додаток (PDF) — з підписом L1 файл.\n\nКоманди:\n/lessons — стан відео\n/preview 1 — надіслати собі лекцію 1`);
    } else {
      await say(env, chat, 'Невірний код.');
    }
    return;
  }

  if (isAdmin) {
    // привʼязка відео / файлів: підпис L1 … L5 (+ «файл»)
    const cap = (msg.caption || '').trim();
    const mm = cap.match(/^L(\d+)\s*(файл|file|doc)?/i);
    if (mm && (msg.video || msg.document || msg.animation)) {
      const n = +mm[1];
      if (n < 1 || n > LESSONS) { await say(env, chat, `Номер лекції має бути від 1 до ${LESSONS}.`); return; }
      const isAttachment = !!mm[2];
      if (isAttachment) {
        if (!msg.document) { await say(env, chat, 'Для підпису «файл» надішліть документ (PDF тощо).'); return; }
        await run(env, `INSERT INTO lessons (n, doc_id, doc_name, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(n) DO UPDATE SET doc_id = excluded.doc_id, doc_name = excluded.doc_name, updated_at = excluded.updated_at`, n, msg.document.file_id, msg.document.file_name || 'файл', now());
        await say(env, chat, `📎 Файл «${msg.document.file_name || 'файл'}» привʼязано до лекції ${n}.`);
      } else {
        const v = msg.video || msg.animation;
        const fileId = v ? v.file_id : msg.document.file_id;
        const type = v ? 'video' : 'document';
        await run(env, `INSERT INTO lessons (n, file_id, file_type, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(n) DO UPDATE SET file_id = excluded.file_id, file_type = excluded.file_type, updated_at = excluded.updated_at`, n, fileId, type, now());
        const dur = v && v.duration ? ` (${Math.round(v.duration / 60)} хв)` : '';
        await say(env, chat, `🎬 Відео${dur} привʼязано до лекції ${n}: ${COURSE.lessons[n - 1].title}`);
      }
      await logEvent(env, null, 'lesson-file', `L${n} ${isAttachment ? 'doc' : 'video'} by ${name}`);
      return;
    }
    if (text === '/lessons') {
      const f = await lessonFiles(env);
      const lines = COURSE.lessons.map((L, i) => `${f[i + 1]?.file_id ? '✅' : '❌'} L${i + 1} ${L.title}${f[i + 1]?.doc_id ? ' 📎' : ''}`);
      await say(env, chat, lines.join('\n'));
      return;
    }
    const pv = text.match(/^\/preview\s+(\d+)/);
    if (pv) {
      const n = +pv[1];
      if (n >= 1 && n <= LESSONS) await sendLesson(env, chat, n, await lessonFiles(env));
      else if (n === LESSONS + 1) await say(env, chat, COURSE.texts.final);
      else await say(env, chat, `Вкажіть номер від 1 до ${LESSONS + 1} (${LESSONS + 1} — фінальне повідомлення).`);
      return;
    }
    // відповідь адміністратора на переслане повідомлення учасниці
    if (msg.reply_to_message) {
      const link = await one(env, 'SELECT user_chat FROM fwd WHERE admin_chat = ? AND admin_msg = ?', chat, msg.reply_to_message.message_id);
      if (link) {
        const r = msg.text ? await say(env, link.user_chat, msg.text)
          : await tg(env, 'copyMessage', { chat_id: link.user_chat, from_chat_id: chat, message_id: msg.message_id });
        await say(env, chat, r.ok ? '✉️ Відповідь надіслано.' : `Не вдалося надіслати: ${r.description}`);
        return;
      }
    }
  }

  // /start з токеном покупки
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      const mine = await one(env, 'SELECT * FROM orders WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1', chat);
      if (mine && mine.done_at) await say(env, chat, COURSE.texts.course_done);
      else if (mine) await say(env, chat, fill(COURSE.texts.already_active, { next: fmtKyiv(mine.next_at) }));
      else await say(env, chat, fill(COURSE.texts.no_token, { site: siteUrl(env) + COURSE.landing }));
      return;
    }
    const o = await one(env, "SELECT * FROM orders WHERE token = ? AND status IN ('paid', 'manual')", token);
    if (!o) { await say(env, chat, COURSE.texts.bad_token); await logEvent(env, null, 'start', `bad token from ${chat}`); return; }
    if (o.chat_id && o.chat_id !== chat) { await say(env, chat, COURSE.texts.token_used); await logEvent(env, o.ref, 'start', `token reuse attempt from ${chat}`); return; }
    if (o.activated_at) {
      await say(env, chat, o.done_at ? COURSE.texts.course_done : fill(COURSE.texts.already_active, { next: fmtKyiv(o.next_at) }));
      return;
    }
    const first = nextSlot(now());
    await run(env, 'UPDATE orders SET chat_id = ?, tg_username = ?, tg_name = ?, activated_at = ?, next_step = 1, next_at = ?, paused = 0 WHERE ref = ?',
      chat, from.username || null, name, now(), first, o.ref);
    await say(env, chat, fill(COURSE.texts.welcome, { name: from.first_name || name, time: timeLabel() }));
    await logEvent(env, o.ref, 'activated', `chat ${chat}`);
    await notifyAdmins(env, `🌱 ${name}${from.username ? ' (@' + from.username + ')' : ''} запустила бота. Перша лекція: ${fmtKyiv(first)}.`);
    return;
  }

  if (text === '/help') { await say(env, chat, fill(COURSE.texts.help, { time: timeLabel() })); return; }
  if (isAdmin) { await say(env, chat, 'Команди адміністратора: /lessons, /preview N. Щоб привʼязати відео, надішліть його з підписом L1…L5.'); return; }

  // будь-яке інше повідомлення учасниці → адміністраторам
  const o = await one(env, 'SELECT * FROM orders WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1', chat);
  const who = `${name}${from.username ? ' (@' + from.username + ')' : ''}${o ? `, ${o.email || o.ref}, урок ${Math.min((o.next_step || 1) - 1, LESSONS)}/${LESSONS}` : ', без покупки'}`;
  const admins = await all(env, 'SELECT chat_id FROM admins');
  for (const a of admins) {
    const h = await say(env, a.chat_id, `💬 Повідомлення від ${who}.\nЩоб відповісти, зробіть «Відповісти» на повідомленні нижче.`);
    const c = await tg(env, 'copyMessage', { chat_id: a.chat_id, from_chat_id: chat, message_id: msg.message_id });
    for (const r of [h, c]) {
      const mid = r?.result?.message_id;
      if (r.ok && mid) await run(env, 'INSERT OR REPLACE INTO fwd (admin_chat, admin_msg, user_chat, at) VALUES (?, ?, ?, ?)', a.chat_id, mid, chat, now());
    }
  }
  await say(env, chat, COURSE.texts.message_received);
}

async function setupBot(env, origin) {
  const url = `${origin}/api/tg`;
  const a = await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ['message'], drop_pending_updates: false });
  const b = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Почати / мій курс' }, { command: 'help', description: 'Допомога' }] });
  const me = await tg(env, 'getMe', {});
  return { webhook: a.ok ? 'ok' : a.description, commands: b.ok ? 'ok' : b.description, bot: me.ok ? '@' + me.result.username : me.description };
}

// ───────────────────────── адмінка ─────────────────────────

const SESSION_DAYS = 14;

async function makeSession(env) {
  const exp = now() + SESSION_DAYS * 864e5;
  return `${exp}.${await hmacSha256(env.APP_SECRET, `adm.${exp}`)}`;
}

async function isAuthed(env, request) {
  if (!env.APP_SECRET) return false;
  const c = (request.headers.get('cookie') || '').match(/(?:^|;\s*)nk_adm=([^;]+)/);
  if (!c) return false;
  const [exp, sig] = c[1].split('.');
  if (!exp || +exp < now()) return false;
  return safeEqual(sig, await hmacSha256(env.APP_SECRET, `adm.${exp}`));
}

async function adminApi(env, request, path) {
  await db(env);
  const method = request.method;

  if (path === 'login/request' && method === 'POST') {
    const last = +(await getMeta(env, 'login_sent') || 0);
    if (now() - last < 60_000) return json({ ok: false, error: 'Код уже надіслано. Зачекайте хвилину.' }, 429);
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await setMeta(env, 'login_code', JSON.stringify({ hash: await hmacSha256(env.APP_SECRET, code), exp: now() + 10 * 60_000, tries: 0 }));
    await setMeta(env, 'login_sent', now());
    const n = await notifyAdmins(env, `🔐 Код входу в адмінку: ${code}\nДіє 10 хвилин. Якщо ви не входили — просто ігноруйте.`);
    if (!n) return json({ ok: false, error: 'Немає жодного адміністратора в боті. Спершу надішліть боту /admin КОД.' }, 400);
    return json({ ok: true });
  }

  if (path === 'login' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const st = JSON.parse((await getMeta(env, 'login_code')) || 'null');
    if (!st || st.exp < now() || st.tries >= 5) return json({ ok: false, error: 'Код недійсний або застарів. Запросіть новий.' }, 401);
    st.tries++;
    await setMeta(env, 'login_code', JSON.stringify(st));
    if (!safeEqual(st.hash, await hmacSha256(env.APP_SECRET, String(body.code || '').trim()))) return json({ ok: false, error: 'Невірний код.' }, 401);
    await setMeta(env, 'login_code', 'null');
    return json({ ok: true }, 200, { 'set-cookie': `nk_adm=${await makeSession(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}` });
  }

  if (!(await isAuthed(env, request))) return json({ ok: false, error: 'auth' }, 401);
  if (method === 'POST' && !(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'bad content type' }, 415);

  if (path === 'logout') return json({ ok: true }, 200, { 'set-cookie': 'nk_adm=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });

  if (path === 'summary') {
    const paid = "status IN ('paid','manual') AND test = 0";
    const s = await one(env, `SELECT
      COUNT(*) FILTER (WHERE ${paid}) AS buyers,
      COUNT(*) FILTER (WHERE status = 'paid' AND test = 0 AND currency = 'UAH') AS uah_n,
      COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND test = 0 AND currency = 'UAH'), 0) AS uah_sum,
      COUNT(*) FILTER (WHERE status = 'paid' AND test = 0 AND currency = 'EUR') AS eur_n,
      COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND test = 0 AND currency = 'EUR'), 0) AS eur_sum,
      COUNT(*) FILTER (WHERE ${paid} AND activated_at IS NULL) AS not_started,
      COUNT(*) FILTER (WHERE ${paid} AND activated_at IS NOT NULL AND done_at IS NULL AND paused = 0) AS in_progress,
      COUNT(*) FILTER (WHERE ${paid} AND done_at IS NOT NULL) AS finished,
      COUNT(*) FILTER (WHERE ${paid} AND paused = 1) AS paused,
      COUNT(*) FILTER (WHERE status = 'refunded') AS refunded,
      COUNT(*) FILTER (WHERE status IN ('created','declined') AND test = 0) AS abandoned,
      COUNT(*) FILTER (WHERE ${paid} AND paid_at >= ?) AS week
      FROM orders`, now() - 7 * 864e5);
    const days = await all(env, `SELECT strftime('%Y-%m-%d', paid_at / 1000, 'unixepoch') AS day, COUNT(*) AS n,
      SUM(CASE WHEN currency = 'UAH' THEN amount ELSE 0 END) AS uah, SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END) AS eur
      FROM orders WHERE status = 'paid' AND test = 0 AND paid_at >= ? GROUP BY day ORDER BY day DESC`, now() - 30 * 864e5);
    const files = await lessonFiles(env);
    const lessons = COURSE.lessons.map((L, i) => ({ n: i + 1, title: L.title, video: !!files[i + 1]?.file_id, doc: files[i + 1]?.doc_name || null, updated: files[i + 1]?.updated_at || null }));
    const admins = await all(env, 'SELECT name, added_at FROM admins');
    const cron = +(await getMeta(env, 'cron_last') || 0);
    return json({ stats: s, days, lessons, admins, cron, pay: payMethods(env), email: !!env.RESEND_API_KEY, bot: botUser(env), prices: COURSE.prices, schedule: COURSE.schedule });
  }

  if (path === 'orders') {
    const url = new URL(request.url);
    const showTest = url.searchParams.get('test') === '1';
    const rows = await all(env, `SELECT * FROM orders WHERE status != 'created' ${showTest ? '' : 'AND test = 0'} ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 500`);
    return json({ orders: rows.map((o) => ({ ...o, link: ['paid', 'manual'].includes(o.status) ? botLink(env, o.token) : null, token: undefined, next_label: fmtKyiv(o.next_at) })) });
  }

  if (path === 'log') {
    const ref = new URL(request.url).searchParams.get('ref');
    return json({ log: ref ? await all(env, 'SELECT * FROM log WHERE ref = ? ORDER BY id DESC LIMIT 100', ref) : await all(env, 'SELECT * FROM log ORDER BY id DESC LIMIT 100') });
  }

  if (path === 'manual' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const ref = `NK-MAN-${Date.now().toString(36)}-${randomToken(4)}`;
    const token = randomToken(24);
    const amount = b.amount ? Number(b.amount) : null;
    await run(env, `INSERT INTO orders (ref, token, method, amount, currency, status, test, created_at, paid_at, name, email, phone, note)
      VALUES (?, ?, 'manual', ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
    ref, token, amount, b.currency || null, b.test ? 1 : 0, now(), now(), b.name || null, b.email || null, b.phone || null, b.note || null);
    await logEvent(env, ref, 'manual', 'added from admin');
    return json({ ok: true, ref, link: botLink(env, token) });
  }

  if (path === 'action' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const o = await one(env, 'SELECT * FROM orders WHERE ref = ?', b.ref);
    if (!o) return json({ ok: false, error: 'Замовлення не знайдено' }, 404);
    const a = b.action;
    if (a === 'note') { await run(env, 'UPDATE orders SET note = ? WHERE ref = ?', String(b.note || '').slice(0, 1000), o.ref); return json({ ok: true }); }
    if (a === 'pause') { await run(env, 'UPDATE orders SET paused = 1 WHERE ref = ?', o.ref); await logEvent(env, o.ref, 'admin', 'paused'); return json({ ok: true }); }
    if (a === 'resume') {
      // найближчий слот 11:00 (сьогодні, якщо ще не минув, інакше завтра), але не раніше запланованого
      const today = nextSlot(now(), 0);
      const slot = today > now() ? today : nextSlot(now());
      const next = o.done_at || !o.activated_at ? null : Math.max(o.next_at || 0, slot);
      await run(env, 'UPDATE orders SET paused = 0, next_at = ? WHERE ref = ?', next, o.ref);
      await logEvent(env, o.ref, 'admin', 'resumed'); return json({ ok: true });
    }
    if (a === 'new_link') {
      const token = randomToken(24);
      await run(env, 'UPDATE orders SET token = ?, chat_id = NULL, activated_at = NULL WHERE ref = ?', token, o.ref);
      await logEvent(env, o.ref, 'admin', 'new link issued');
      return json({ ok: true, link: botLink(env, token) });
    }
    if (a === 'send_next') {
      if (!o.chat_id) return json({ ok: false, error: 'Учасниця ще не запустила бота' }, 400);
      if (o.done_at) return json({ ok: false, error: 'Курс уже завершено' }, 400);
      const ok = await deliverStep(env, o, await lessonFiles(env));
      return json({ ok });
    }
    if (a === 'send_lesson') {
      if (!o.chat_id) return json({ ok: false, error: 'Учасниця ще не запустила бота' }, 400);
      const n = +b.n;
      if (!(n >= 1 && n <= LESSONS)) return json({ ok: false, error: 'Невірний номер лекції' }, 400);
      const r = await sendLesson(env, o.chat_id, n, await lessonFiles(env));
      await logEvent(env, o.ref, 'admin', `lesson ${n} re-sent: ${r.ok ? 'ok' : r.error}`);
      return json({ ok: r.ok, error: r.error });
    }
    if (a === 'message') {
      if (!o.chat_id) return json({ ok: false, error: 'Учасниця ще не запустила бота' }, 400);
      const r = await say(env, o.chat_id, String(b.text || '').slice(0, 4000));
      await logEvent(env, o.ref, 'admin', `message: ${r.ok ? 'ok' : r.description}`);
      return json({ ok: !!r.ok, error: r.description });
    }
    if (a === 'resend_email') {
      const ok = await sendAccessEmail(env, o).catch(() => false);
      return json({ ok, error: ok ? null : 'Лист не надіслано (немає email або не налаштовано пошту)' });
    }
    return json({ ok: false, error: 'Невідома дія' }, 400);
  }

  if (path === 'setup-bot' && method === 'POST') return json(await setupBot(env, new URL(request.url).origin));

  if (path === 'export.csv') {
    const rows = await all(env, "SELECT * FROM orders WHERE status != 'created' ORDER BY created_at DESC");
    const cols = ['ref', 'status', 'test', 'method', 'amount', 'currency', 'created_at', 'paid_at', 'name', 'email', 'phone', 'tg_name', 'tg_username', 'activated_at', 'next_step', 'done_at', 'paused', 'note', 'source'];
    const iso = (v) => (v ? new Date(v).toISOString() : '');
    const cell = (k, v) => `"${String(['created_at', 'paid_at', 'activated_at', 'done_at'].includes(k) ? iso(v) : v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((k) => cell(k, r[k])).join(','))].join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="uchasnytsi.csv"' } });
  }

  return json({ error: 'not found' }, 404);
}

// ───────────────────────── маленькі сторінки ─────────────────────────

function page(title, body) {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><link rel="icon" href="/favicon.svg"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#2B2D20;color:#F4EFE7;font:16px/1.6 Montserrat,system-ui,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:520px;text-align:center}h1{font-size:1.4rem}.btn{display:inline-block;margin-top:16px;background:#F4EFE7;color:#1B1C14;border:0;border-radius:999px;padding:14px 28px;font:700 .9rem Montserrat,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;cursor:pointer}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

// ───────────────────────── маршрутизація ─────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === '/api/pay-methods') return json(payMethods(env));

      const pay = p.match(/^\/pay\/(uah|eur)\/?$/);
      if (pay) return startPayment(env, pay[1], url);

      if (p === '/pay/return') {
        let ref = url.searchParams.get('ref') || '';
        if (!ref && request.method === 'POST') { const f = await request.formData().catch(() => null); ref = f?.get('orderReference') || ''; }
        return Response.redirect(`${url.origin}/perezavantazhennya/dyakuyu.html?ref=${encodeURIComponent(ref)}`, 303);
      }

      if (p === '/api/wfp' && request.method === 'POST') return wfpCallback(env, request);

      if (p === '/api/order') {
        await db(env);
        const o = await one(env, 'SELECT status, token, test FROM orders WHERE ref = ?', url.searchParams.get('ref') || '');
        if (!o) return json({ status: 'unknown' }, 404);
        const ok = ['paid', 'manual'].includes(o.status);
        return json({ status: o.status, test: !!o.test, bot: ok ? botLink(env, o.token) : null });
      }

      if (p === '/api/tg' && request.method === 'POST') {
        if (!safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), await webhookSecret(env))) return new Response('forbidden', { status: 403 });
        const update = await request.json().catch(() => null);
        if (update) ctx.waitUntil(handleUpdate(env, update).catch((e) => logEvent(env, null, 'bot-error', e.stack || e.message)));
        return new Response('ok');
      }

      if (p === '/api/setup') {
        if (!env.ADMIN_CODE || !safeEqual(url.searchParams.get('code'), env.ADMIN_CODE)) return html(page('Немає доступу', '<p>Невірний код.</p>'), 403);
        await db(env);
        const r = await setupBot(env, url.origin);
        return html(page('Підключення бота', `<p>Webhook: <b>${esc(r.webhook)}</b><br>Команди: <b>${esc(r.commands)}</b><br>Бот: <b>${esc(r.bot)}</b></p>
          <p>Тепер відкрийте бота в Telegram і надішліть йому:<br><code>/admin ВАШ_КОД</code></p><a class="btn" href="/admin">Відкрити адмінку</a>`));
      }

      if (p === '/admin' || p === '/admin/') return html(ADMIN_HTML, 200, { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      if (p.startsWith('/api/admin/')) return adminApi(env, request, p.slice('/api/admin/'.length));

      if (p.startsWith('/api/') || p.startsWith('/pay/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env).catch((e) => console.error(e)));
  },
};

// для тестів
export { nextSlot, zoneParts, handleUpdate, runSchedule, wfpCallback };
