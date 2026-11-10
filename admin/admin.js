/* =========================================================
   library live · back office
   The circulation desk of sth.ventured. Same core as the member
   app (shared/core.js), seen from behind the counter, live in both
   directions: a booking made on a phone lands in the queue here
   within a second, and a table confirmed here lands on the phone.
   Guests book a zone (分区); the store assigns the exact table.
   ========================================================= */
import { connect, call, auth, onChange, getMode } from '../shared/api.js';
import { html, raw, fmt, toast, debounce, initialOf } from '../shared/ui.js';
import { BOOKING_STATUS, APP_STATUS, EVENT_KINDS, IDENTITIES, DEMO_PIN, yuan, hz, hzDate, addDays } from '../shared/core.js';
import { zoneOf, resourceOf, RESOURCES, planSVG } from '../shared/plan.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const shellEl = $('#shell');
const drawerEl = $('#drawer');
const icon = id => raw(`<svg aria-hidden="true"><use href="#i-${id}"/></svg>`);
const pad = n => String(n).padStart(2, '0');

const PAGES = {
  desk: { zh: '工作台', en: 'Workbench', k: 'Tonight at the desk · 今晚', icon: 'desk', load: () => call('admin.workbench'), view: viewDesk, badge: 'confirms', hot: true },
  board: { zh: '座位图', en: 'Floor board', k: 'Guests book a zone · the store assigns the table · 按区域订座，门店排桌', icon: 'map', load: loadBoard, view: viewBoard, after: afterBoard },
  verify: { zh: '核验', en: 'Front door', k: 'Booking code or member code · 入场核验', icon: 'key', load: loadVerify, view: viewVerify, after: afterVerify },
  bookings: { zh: '订单', en: 'Bookings', k: 'Every booking, every state · 订单状态 T1–T14', icon: 'ticket', load: () => call('admin.bookings', {}), view: viewBookings },
  members: { zh: '会员', en: 'The register', k: 'Members & renewals · 会员名册', icon: 'members', load: () => call('admin.members'), view: viewMembers },
  applications: { zh: '入会审核', en: 'Applications', k: 'Due diligence · 尽调', icon: 'letter', load: () => call('admin.applications'), view: viewApplications, badge: 'reviews' },
  invites: { zh: '邀请函', en: 'Invitations', k: 'Gift membership · 赠送会员', icon: 'seal', load: () => call('admin.invites'), view: viewInvites },
  day: { zh: '会员时间', en: 'Members’ hours', k: '10:00 – 19:00 · check-in · roundtables · meetings', icon: 'lamp', load: () => call('admin.day'), view: viewDay, badge: 'meetings' },
  events: { zh: '活动', en: 'Programme', k: 'Panels · podcasts · roundtables · maker', icon: 'calendar', load: () => call('admin.events'), view: viewEvents },
  layers: { zh: '内容分层', en: 'Layers', k: 'L0 – L3 · who sees what', icon: 'layers', load: () => call('admin.content'), view: viewLayers },
  ledger: { zh: '账目', en: 'Ledger', k: 'Mock payment channel · 模拟支付通道', icon: 'chart', load: () => call('admin.ledger'), view: viewLedger, badge: 'refunds' },
  audit: { zh: '操作日志', en: 'Audit log', k: 'Who did what, when · 留痕', icon: 'log', load: () => call('admin.audit'), view: viewAudit },
  settings: { zh: '规则与设置', en: 'Rules', k: 'Rules v0.3 · sessions · demo · 规则、场次与演示', icon: 'gear', load: () => call('admin.config'), view: viewSettings },
};
const NAV = [
  ['Tonight', '今晚', ['desk', 'board', 'verify', 'bookings']],
  ['Members', '会员', ['members', 'applications', 'invites']],
  ['Daytime', '白天', ['day']],
  ['Programme', '节目', ['events', 'layers']],
  ['Office', '账房', ['ledger', 'audit', 'settings']],
];

const S = {
  staff: null, page: null, params: {}, data: {}, badges: {}, drawer: null, seq: 0,
  skew: 0, offset: 0, mode: null, cache: new Map(), content: null, members: null, staffList: [],
  ui: { loginStaff: 'st1', boardSession: null, bkStatus: '', bkQ: '', memQ: '', memFilter: 'all', evFilter: 'upcoming', auditFilter: '', vcode: '', vresult: null, lastInvite: null },
};
const serverNow = () => Date.now() + S.skew;
const isAdmin = () => !!S.staff && S.staff.role === 'admin';
const remember = list => { (list || []).forEach(b => { if (b && b.id) S.cache.set(b.id, b); }); return list; };

/* ---------- vocabulary ---------- */
const MODE_ZH = { day: '会员时间', night: '演出时段', closed: '打烊' };
const ST_COLOR = { pending_payment: 'amber', payment_expired: 'grey', pending_confirm: 'red', confirmed: 'green', rejected: 'grey', confirm_timeout_closed: 'grey', cancelled: 'grey', fulfilled: 'blue', no_show: 'violet' };
const REASONS = { booth: '卡座订单', multi_resource: '多张桌', over_required: '超出所需桌数', extra_reserved: '多张会员预留', special_note: '有备注', session_all_manual: '本场全部人工' };
const TSTATE = { available: '空闲', reserved_open: '会员预留 · 可订', reserved_sealed: '会员预留', locking: '支付锁定中', pending: '尽调中', booked: '已订', offline: '线下占桌', paused: '已暂停', mine: '—' };
const REFUND_REASON = { rejected: '门店未接受', confirm_timeout: '确认超时', late_payment_conflict: '支付晚到，桌位已被占' };
const PAY_STATUS = { unpaid: '待支付', paid: '已支付', failed_closed: '超时关闭' };
const DEPOSIT_STATE = { unused: '未使用', partially_used: '部分抵扣', used: '已用完', valid_tonight_table_released: '桌位已释放，今晚仍可抵扣', expired: '未到店，已失效' };
const REG_STATUS = { registered: '已报名', attended: '已到场', cancelled: '已取消' };
const SOURCE = { checkin_count: '白天签到', event_attended: '到场参加活动', hosted_session: '做过分享', staff_grant: '店长授予', easter_egg: '彩蛋', membership: '会员' };
const MODE_TXT = { any: '全天', day: '白天', night: '夜间' };
const ACTION = {
  'booking.create': '下单', 'booking.confirm': '确认订单', 'booking.reject': '婉拒订单', 'booking.release': '释放桌位',
  'verify.booking': '核验入场', 'verify.member': '核验会员码', 'ticket.drink': '兑换赠饮', 'deposit.redeem': '订金抵扣',
  'table.pause': '暂停桌位', 'table.resume': '恢复桌位', 'hold.create': '线下占桌', 'hold.release': '释放线下占桌',
  'application.submit': '提交入会申请', 'application.approve': '通过申请', 'application.need_info': '请补资料', 'application.reject': '婉拒申请',
  'invite.create': '签发邀请', 'invite.disable': '停用邀请', 'invite.claim': '领取邀请', 'membership.paid': '会员付费',
  'checkin.reset': '更换签到码', 'meeting.accept': '同意会议', 'meeting.reject': '婉拒会议', 'meeting.counter': '提议调整会议',
  'event.create': '新建活动', 'event.update': '修改活动', 'registration.mark': '标记报名',
  'unlock.grant': '授予解锁', 'unlock.revoke': '撤销解锁', 'config.set': '修改规则', 'session.update': '修改场次',
};
const idn = k => (IDENTITIES[k] || { zh: k || '—' }).zh;
const zn = id => (zoneOf(id) || { zh: id }).zh;
const bstamp = s => html`<span class="stamp st-${ST_COLOR[s] || 'grey'}">${BOOKING_STATUS[s].deal}<small>${BOOKING_STATUS[s].zh}</small></span>`;
const linesText = b => (b.lines || []).map(l => (b.kind === 'booth' ? `${l.code}「${l.name || l.code}」` : `${l.code}×${l.seats}`)).join(' ') || '—';
const who = u => (u ? html`<b>${u.name}</b>${u.member_no ? html` <span class="muted mono">No.${u.member_no}</span>` : ''}` : '—');
const staffName = id => (S.staffList.find(s => s.id === id) || { name: id }).name;
const ruleText = r => {
  if (!r) return '会员身份';
  return ({ membership: '会员身份', checkin_count: `白天签到 ${r.n || 1} 次`, event_attended: `到场 ${r.n || 1} 次活动`, hosted_session: '做过一次分享', staff_grant: '店长授予', easter_egg: `彩蛋 · ${r.egg_key || ''}` })[r.type] || r.type;
};
const contentTitle = key => ((S.content || []).find(c => c.key === key) || { teaser: { title: key } }).teaser.title;

/* ---------- boot & routing ---------- */
async function boot() {
  await connect({ tokenKey: 'sv.admin.v2.token' });
  if (auth.token) {
    try { S.staff = await call('admin.me'); } catch { auth.clear(); }
  }
  S.staffList = await call('staff.list').catch(() => []);
  await syncClock();
  onChange(() => refresh());
  addEventListener('hashchange', route);
  if (!S.staff) return entrance();
  renderShell();
  route();
}

function entrance() {
  shellEl.classList.add('is-gate');
  closeDrawer();
  shellEl.innerHTML = html`<div class="entrance"><form class="entrance__card" data-form="login">
    <svg class="crest"><use href="#i-crest"/></svg>
    <p class="entrance__k">Staff only · 员工通道</p>
    <h1 class="entrance__h">library live 后台</h1>
    <p class="entrance__p">The circulation desk of sth.ventured.</p>
    <div class="staffpick" aria-label="你是谁">${S.staffList.map(s => html`<button type="button" aria-pressed="${String(S.ui.loginStaff === s.id)}" data-act="pick-staff" data-id="${s.id}"><span class="cameo">${initialOf(s.name)}</span><span><b>${s.name}</b><span>${s.title}</span></span></button>`)}</div>
    <div class="pin"><input name="pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN" aria-label="PIN" required></div>
    <p class="err" data-err></p>
    <button class="btn btn--green btn--lg">Enter <span>进入后台</span></button>
    <p class="entrance__demo">演示 PIN：${DEMO_PIN} · 店长可以审核入会、签发邀请、修改规则 · <a href="../app/">会员端 →</a></p>
  </form></div>`.s;
  $('.pin input')?.focus();
}

function renderShell() {
  shellEl.classList.remove('is-gate');
  const mode = getMode();
  shellEl.innerHTML = html`<aside class="side" id="side">
      <div class="brand"><svg><use href="#i-crest"/></svg><b>library live</b><span>The back office · 后台</span></div>
      <nav class="nav" id="nav" aria-label="后台导航"></nav>
      <div class="side__foot">
        <div class="who"><span class="cameo">${initialOf(S.staff.name)}</span><div><b>${S.staff.name}</b><span>${S.staff.title} · ${isAdmin() ? '全部权限' : '前台权限'}</span></div></div>
        <span class="live ${mode === 'server' ? '' : 'live--local'}"><i></i>${mode === 'server' ? 'LIVE · 与会员端实时同步' : mode === 'offline' ? 'OFFLINE · 离线' : 'LOCAL · 本机演示数据'}</span>
        <div class="side__btns">
          <a class="sbtn" href="../app/" target="_blank" rel="noopener">${icon('ext')}会员端</a>
          <button class="sbtn" data-act="logout">${icon('out')}退出</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="icon-btn top__menu" data-act="menu" aria-label="菜单">${icon('menu')}</button>
        <div class="top__t" id="toptitle"></div>
        <div class="top__r"><span class="lamp" id="lamp"></span><div class="clock" aria-label="杭州时间"><span class="clock__d" id="clockd"></span><span class="flaps" id="clock"></span></div></div>
      </header>
      <div class="page" id="page"></div>
    </div>`.s;
  tickClock(true);
  renderLamp();
}

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  nav.innerHTML = NAV.map(([en, zh, ids]) => html`<p class="nav__g">${en}<i>${zh}</i></p>${ids.map(id => {
    const p = PAGES[id];
    const n = p.badge ? S.badges[p.badge] : 0;
    return html`<a href="#/${id}" class="${S.page === id ? 'is-on' : ''}" ${raw(S.page === id ? 'aria-current="page"' : '')}>${icon(p.icon)}<span><b>${p.zh}</b><small>${p.en}</small></span>${n ? html`<span class="badge ${p.hot ? 'badge--hot' : ''}" aria-label="${n} 项待处理">${n}</span>` : html`<span></span>`}</a>`;
  })}`.s).join('');
}

async function route() {
  if (!S.staff) return;
  const [name, q] = location.hash.replace(/^#\/?/, '').split('?');
  const page = PAGES[name] ? name : 'desk';
  if (page !== name) history.replaceState(null, '', '#/' + page);
  const entering = S.page !== page;
  S.page = page;
  S.params = Object.fromEntries(new URLSearchParams(q || ''));
  shellEl.classList.remove('is-menu');
  stopPageTimer();
  renderNav();
  const p = PAGES[page];
  $('#toptitle').innerHTML = html`<span class="top__k">${p.k}</span><div class="top__h"><h1>${p.zh}</h1><span>${p.en}</span></div>`.s;
  document.title = `${p.zh} · library live 后台`;
  if (entering && S.drawer) closeDrawer();
  await load(true);
  loadBadges();
}

async function load(entering = false) {
  const seq = ++S.seq;
  const page = S.page;
  const pageEl = $('#page');
  if (entering && pageEl) pageEl.innerHTML = '';
  else if (pageEl) pageEl.classList.add('is-stale');
  try {
    const data = await PAGES[page].load();
    if (seq !== S.seq) return;
    S.data[page] = data;
    renderPage(entering);
  } catch (e) {
    if (seq === S.seq) { pageEl?.classList.remove('is-stale'); handleError(e); }
  }
}

function renderPage(entering = false) {
  const pageEl = $('#page');
  if (!pageEl || !S.data[S.page]) return;
  const keep = window.scrollY;
  pageEl.classList.remove('is-stale');
  pageEl.innerHTML = PAGES[S.page].view(S.data[S.page]).s;
  if (entering) {
    window.scrollTo(0, 0);
    pageEl.style.animation = 'none';
    void pageEl.offsetWidth;
    pageEl.style.animation = '';
  } else window.scrollTo(0, keep);
  PAGES[S.page].after?.();
  tick();
}

async function loadBadges() {
  try { S.badges = await call('admin.badges'); renderNav(); } catch { /* not fatal */ }
}

const refresh = debounce(async () => {
  if (!S.staff || !S.page) return;
  loadBadges();
  const a = document.activeElement;
  const typing = a && a.matches('input, textarea, select') && ($('#page')?.contains(a) || drawerEl.contains(a));
  if (!typing) await load(false);
  if (S.drawer && !typing) refreshDrawer();
}, 250);

/* ---------- the house clock (follows the demo clock, so 19:00 can happen on cue) ---------- */
async function syncClock() {
  try {
    const r = await call('demo.state');
    S.skew = Date.parse(r.now) - Date.now();
    S.offset = r.offsetMs;
    const changed = S.mode !== null && S.mode !== r.mode;
    S.mode = r.mode;
    tickClock(true);
    renderLamp();
    return changed;
  } catch { return false; }
}
let lastClock = '';
function tickClock(force = false) {
  const now = serverNow();
  const t = hz(now);
  const s = `${pad(t.h)}${pad(t.mi)}`;
  const el = $('#clock');
  if (!el) return;
  const p = fmt.parts(now);
  $('#clockd').innerHTML = html`${p.dowEn} · ${p.d} ${p.mon} · HANGZHOU${S.offset ? html`<em>DEMO</em>` : ''}`.s;
  if (force || !el.children.length) {
    el.innerHTML = html`<span class="fc">${s[0]}</span><span class="fc">${s[1]}</span><span class="fc fc--sep">:</span><span class="fc">${s[2]}</span><span class="fc">${s[3]}</span>`.s;
  } else if (s !== lastClock) {
    const cells = $$('.fc:not(.fc--sep)', el);
    [...s].forEach((c, i) => { if (cells[i].textContent !== c) { cells[i].textContent = c; cells[i].classList.remove('is-flip'); void cells[i].offsetWidth; cells[i].classList.add('is-flip'); } });
  }
  lastClock = s;
}
function renderLamp() {
  const el = $('#lamp');
  if (!el || !S.mode) return;
  el.className = `lamp lamp--${S.mode}`;
  el.innerHTML = html`<i></i>${S.mode}<b>${MODE_ZH[S.mode]}</b>`.s;
}
function tick() {
  const now = serverNow();
  $$('[data-countdown]').forEach(el => {
    const left = Math.max(0, Date.parse(el.dataset.countdown) - now);
    el.textContent = `${pad(Math.floor(left / 60e3))}:${pad(Math.floor((left % 60e3) / 1e3))}`;
    el.closest('.memo')?.classList.toggle('is-urgent', left < 5 * 60e3);
  });
  $$('[data-ring]').forEach(el => {
    const left = Math.max(0, Date.parse(el.dataset.ring) - now);
    el.style.strokeDashoffset = String(188.5 * (1 - left / Number(el.dataset.span)));
    el.closest('.ring')?.classList.toggle('is-late', left < 5 * 60e3);
  });
}
setInterval(() => { tickClock(); tick(); }, 1000);
setInterval(async () => { if (S.staff && await syncClock()) refresh(); }, 15e3);

/* ---------- shared bits ---------- */
function card(title, en, body, { sub = '', tools = '', cls = '' } = {}) {
  return html`<section class="card ${cls}">
    <div class="card__h"><div class="card__t"><b>${title}</b><span>${en}</span>${sub ? html`<p>${sub}</p>` : ''}</div>${tools ? html`<div class="card__tools">${tools}</div>` : ''}</div>
    <div class="card__b">${body}</div>
  </section>`;
}
const kpi = (l, en, v, small, href, hot = false) => html`<a class="kpi ${hot ? 'kpi--hot' : ''}" href="${href}"><span class="kpi__l">${l}<span>${en}</span></span><span class="kpi__v">${v}${small ? html`<small>${small}</small>` : ''}</span></a>`;
function meter(taken, cap) {
  const f = cap ? Math.min(1, taken / cap) : 0;
  return html`<span style="display:grid;gap:4px;min-width:90px"><span class="num" style="font-size:11px;color:var(--muted)">${taken} / ${cap}</span><span class="bar ${f >= 1 ? 'is-full' : ''}"><i style="width:${Math.round(f * 100)}%"></i></span></span>`;
}
function ring(deadline, span, label) {
  const left = Math.max(0, Date.parse(deadline) - serverNow());
  return html`<div class="ring ${left < 5 * 60e3 ? 'is-late' : ''}"><svg viewBox="0 0 78 78" aria-hidden="true"><circle class="ring__bg" cx="39" cy="39" r="30"/><circle class="ring__fg" cx="39" cy="39" r="30" data-ring="${deadline}" data-span="${span}" style="stroke-dashoffset:${188.5 * (1 - left / span)}"/></svg><div class="ring__t"><b data-countdown="${deadline}">${pad(Math.floor(left / 60e3))}:${pad(Math.floor((left % 60e3) / 1e3))}</b><span>${label}</span></div></div>`;
}
function zoneMeters(zones) {
  return html`<div class="zm">${zones.map(z => {
    const zz = zoneOf(z.id);
    const used = z.total - z.free;
    const f = z.total ? used / z.total : 0;
    return html`<div class="zm__r"><span><b>${zz.zh}</b><small>${zz.en}${z.reserved ? ' · member-reserved' : ''}</small></span><span class="bar ${z.free === 0 ? 'is-full' : ''}"><i style="width:${Math.round(f * 100)}%"></i></span><span class="num">${used}/${z.total} ${z.unit === 'seat' ? '座' : '桌'}</span></div>`;
  })}</div>`;
}
function feed(list) {
  if (!list || !list.length) return html`<p class="empty">还没有操作。</p>`;
  return html`<div class="feed">${list.map(a => html`<div><time>${fmt.time(a.at)}</time><span><b>${ACTION[a.action] || a.action}</b> <span class="muted">${a.after || a.reason || ''}</span></span></div>`)}</div>`;
}
function brow(b) {
  return html`<button class="brow" data-act="${b.status === 'pending_confirm' ? 'confirm' : 'booking'}" data-id="${b.id}"><span class="mono">${b.code}</span><span><b>${zn(b.zone)}</b> · ${b.party_size} 人 · ${b.user ? b.user.name : ''}<small>${fmt.mdOf(b.date)} · ${linesText(b)}${b.note ? ` · 「${b.note}」` : ''}</small></span>${bstamp(b.status)}</button>`;
}

/* ---------- workbench ---------- */
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  const v = h * 60 + m;
  return v < 6 * 60 ? v + 24 * 60 : v; // 02:00 belongs to the night before
}
function houseStrip(d) {
  const m = d.mode;
  const s = d.session;
  const t = d.times || {};
  const now = hz(serverNow());
  const nowMin = minutesOf(`${now.h}:${now.mi}`);
  const marks = m === 'day'
    ? [['会员时间至', t.switch_at], ['今晚开场', s ? s.show_start : ''], ['留位截止', t.hold_deadline]]
    : [['会员预留释放', t.switch_at], ['开场', s ? s.show_start : ''], ['留位截止 · 线上停订', t.hold_deadline], ['打烊', t.night_close_at]];
  const next = marks.find(([, v]) => v && minutesOf(v) > nowMin);
  const title = m === 'day'
    ? html`<b>会员时间<i>Members’ hours</i></b><p>白天只对会员开放：签到、开放座谈、会议。今晚：${s ? `${s.title} · ${s.show_start} 开场` : '没有演出'}。</p>`
    : m === 'night' && s
      ? html`<b>${s.title}<i>${s.en}</i></b><p>${s.performers} · ${s.show_start} 开场 · 会员预留 ${s.reserved.join(' · ')} ${nowMin >= minutesOf(t.switch_at) ? '已向所有人开放' : `${t.switch_at} 开放`} · ${s.confirm_policy === 'all_manual' ? '本场全部人工确认' : '分级确认'}</p>`
      : html`<b>打烊<i>Closed</i></b><p>${t.day_open_at} 开门，先是会员时间。</p>`;
  return html`<section class="house ${m === 'day' ? 'house--day' : ''}">
    <div class="house__mode"><b>${m.toUpperCase()}</b><span>${MODE_ZH[m]}</span></div>
    <div class="house__t">${title}</div>
    <div class="house__times">${marks.filter(([, v]) => v).map(([l, v]) => html`<div><span>${l}</span><b class="${next && next[1] === v ? 'is-next' : ''}">${v}</b></div>`)}</div>
  </section>`;
}
function memo(b) {
  const z = zoneOf(b.zone);
  const start = (b.history.find(h => h.status === 'pending_confirm') || {}).at;
  const span = start ? Math.max(60e3, Date.parse(b.confirm_deadline_at) - Date.parse(start)) : 30 * 60e3;
  const left = Math.max(0, Date.parse(b.confirm_deadline_at) - serverNow());
  const paid = b.payment && b.payment.status === 'paid' ? `${b.payment.kind === 'deposit' ? '订金' : '门票'} ${yuan(b.payment.amount)} 已付` : '无需预付';
  return html`<article class="memo ${left < 5 * 60e3 ? 'is-urgent' : ''}">
    ${ring(b.confirm_deadline_at, span, 'LEFT')}
    <div>
      <p class="memo__k"><span class="mono">${b.code}</span>Term sheet · 尽调中</p>
      <h3>${z.zh}<i>${z.en}</i></h3>
      <p class="memo__meta">${b.user ? b.user.name : '—'}${b.user && b.user.member_no ? ` · No.${b.user.member_no}` : ''} · ${idn(b.identity_snapshot)} · ${b.party_size} 人 · ${b.units} ${b.kind === 'booth' ? '张卡座' : '张桌'} · ${paid}</p>
      <p class="memo__meta">${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)} · 系统预留 ${b.lines.map(l => l.code).join('、')}${b.kind === 'booth' ? ' · 可在区内调整' : ''}</p>
      <div class="memo__why">${(b.manual_reasons || []).map(r => html`<span class="tag tag--red">${REASONS[r] || r}</span>`)}</div>
      ${b.note ? html`<blockquote>「${b.note}」</blockquote>` : ''}
      ${b.explanation ? html`<blockquote>多订说明：${b.explanation}</blockquote>` : ''}
    </div>
    <div class="memo__acts"><button class="btn btn--green btn--sm" data-act="confirm" data-id="${b.id}">${icon('check')}<span>确认 · 排桌</span></button><button class="btn btn--ghost btn--red btn--sm" data-act="reject" data-id="${b.id}"><span>婉拒</span></button></div>
  </article>`;
}
function arrivalsTable(list) {
  if (!list.length) return html`<p class="empty">今晚还没有已确认的订单。</p>`;
  return html`<div class="tablewrap"><table class="table"><thead><tr><th>凭证</th><th>客人</th><th>区域 · 桌号</th><th class="num">人数</th><th>状态</th><th></th></tr></thead><tbody>
    ${list.map(b => html`<tr data-act="booking" data-id="${b.id}" tabindex="0"><td class="mono">${b.code}</td><td>${who(b.user)}</td><td>${zn(b.zone)}<br><span class="muted mono">${linesText(b)}</span></td><td class="num">${b.party_size}</td><td>${bstamp(b.status)}${b.table_released ? html` <span class="tag tag--amber">桌位已释放</span>` : ''}</td>
      <td class="num">${b.status === 'confirmed' ? html`<button class="btn btn--ghost btn--sm" data-act="admit" data-code="${b.code}"><span>核验</span></button>` : html`<span class="muted mono">${b.verified_at ? fmt.time(b.verified_at) : ''}</span>`}</td></tr>`)}
  </tbody></table></div>`;
}
function viewDesk(d) {
  remember(d.pending);
  remember(d.arrivals);
  const k = d.kpis;
  return html`${houseStrip(d)}
    <div class="kpis">
      ${kpi('尽调中', 'To confirm', k.confirms, '', '#/board', k.confirms > 0)}
      ${kpi('今晚到店', 'Arrived', k.arrived, `/ ${k.arrivals}`, '#/verify')}
      ${kpi('待审核', 'Applications', k.reviews, '', '#/applications')}
      ${kpi('会议申请', 'Meetings', k.meetings, '', '#/day')}
      ${kpi('退款中', 'Refunds', k.refunds, '', '#/ledger')}
      ${kpi('今日签到', 'Check-ins', k.checkins, '', '#/day')}
      ${kpi('有效会员', 'Members', k.members, '', '#/members')}
    </div>
    <div class="grid g-21">
      <div class="grid">
        ${card('尽调中 · 等门店确认', 'Pending confirmation', d.pending.length ? html`<div class="memos">${d.pending.map(memo)}</div>`
          : html`<p class="empty"><b>No deals on the table.</b>没有等待确认的订单。卡座、多桌和带备注的订单会出现在这里。</p>`,
          { sub: '客人按分区下单；在这里确认，并在区内安排具体桌号。30 分钟内未确认会自动关闭，原路退款。' })}
        ${card('今晚到店', `Arrivals${d.session ? ` · ${d.session.title}` : ''}`, arrivalsTable(d.arrivals), { tools: html`<a class="btn btn--ghost btn--sm" href="#/verify">${icon('key')}<span>去核验</span></a>` })}
      </div>
      <div class="grid">
        ${card('今晚分区', 'Zones tonight', d.zones.length ? zoneMeters(d.zones) : html`<p class="empty">今晚没有场次。</p>`, { tools: html`<a class="btn btn--ghost btn--sm" href="#/board">${icon('map')}<span>座位图</span></a>` })}
        ${d.refunds.length ? card('退款处理中', 'Refunds in flight', html`<div class="minilist">${d.refunds.map(r => html`<div><span><b>${r.user ? r.user.name : '—'}</b><small>${REFUND_REASON[r.reason] || r.reason} · ${fmt.rel(r.created_at, serverNow())}</small></span><span class="num">${yuan(r.amount)}</span></div>`)}</div><p class="hint" style="margin-top:8px">模拟支付通道：约 20 秒后原路到账。</p>`) : ''}
        ${card('今天的活动', 'Today', d.events.length ? html`<div class="minilist">${d.events.map(e => html`<div><span><b>${e.title}</b><small>${fmt.time(e.start_at)}</small></span>${meter(e.taken, e.capacity)}</div>`)}</div>` : html`<p class="empty">今天没有排活动。</p>`)}
        ${card('最近操作', 'Recent', feed(d.audit), { tools: html`<a class="btn btn--ghost btn--sm" href="#/audit"><span>全部</span></a>` })}
      </div>
    </div>`;
}

/* ---------- floor board ---------- */
async function loadBoard() {
  const d = await call('admin.board', { session_id: S.ui.boardSession || undefined });
  S.ui.boardSession = d.session.id;
  remember(d.bookings);
  return d;
}
const LEGEND = html`<div class="legend"><span><i></i>空闲</span><span><i class="l-res"></i>会员预留</span><span><i class="l-lock"></i>支付锁定</span><span><i class="l-pend"></i>尽调中</span><span><i class="l-book"></i>已订</span><span><i class="l-off"></i>线下占桌</span><span><i class="l-pause"></i>暂停</span></div>`;
function viewBoard(d) {
  const s = d.session;
  const groups = [['pending_confirm', '尽调中 · 等门店确认'], ['pending_payment', '待支付 · 10 分钟锁定'], ['confirmed', '已交割 · 待到店'], ['fulfilled', '已到店'], ['other', '其他']];
  const live = ['pending_confirm', 'pending_payment', 'confirmed', 'fulfilled'];
  const by = k => d.bookings.filter(b => (k === 'other' ? !live.includes(b.status) : b.status === k));
  return html`
    <div class="dates">${d.sessions.map(x => html`<button class="date" aria-pressed="${String(x.id === s.id)}" data-act="board-date" data-id="${x.id}"><span>${fmt.dowEnOf(x.date)}</span><b>${fmt.dayOf(x.date)}</b><small>${x.status === 'on_sale' ? fmt.monthEnOf(x.date) : x.status === 'paused' ? 'PAUSED' : 'OFF'}</small></button>`)}</div>
    <div class="sessbar">
      <div class="sessbar__t"><b>${s.title} · ${s.en}</b><span>${fmt.mdOf(s.date)} ${fmt.dowOf(s.date)} · ${s.performers} · ${s.show_start} 开场 · 留位至 ${s.hold_deadline} · 会员预留 ${s.reserved.join(' · ')}</span></div>
      <span class="toolbar__sp"></span>
      <label>Sales <span class="seg">${[['on_sale', '开售'], ['paused', '暂停线上预订']].map(([v, l]) => html`<button aria-pressed="${String(s.status === v)}" data-act="session" data-id="${s.id}" data-k="status" data-v="${v}">${l}</button>`)}</span></label>
      <label>Confirm <span class="seg">${[['tiered', '分级确认'], ['all_manual', '全部人工']].map(([v, l]) => html`<button aria-pressed="${String(s.confirm_policy === v)}" data-act="session" data-id="${s.id}" data-k="confirm_policy" data-v="${v}">${l}</button>`)}</span></label>
    </div>
    <div class="boardgrid">
      <div class="planframe">${raw(planSVG({ states: d.states, admin: true, layout: 'night' }))}${LEGEND}</div>
      <div class="grid">
        ${card('分区余量', 'Zones', zoneMeters(d.zones), { sub: '客人只选分区；具体桌号由门店在确认时安排。点平面图上的桌可以暂停、线下占桌。' })}
        ${card('这一场的订单', `Bookings · ${d.bookings.length}`, d.bookings.length
          ? html`<div class="blist">${groups.map(([k, l]) => { const list = by(k); return list.length ? html`<p class="blist__g">${l} · ${list.length}</p>${list.map(brow)}` : ''; })}</div>`
          : html`<p class="empty">这一场还没有订单。</p>`)}
        ${d.holds.length ? card('线下占桌', 'Phone & walk-in holds', html`<div class="minilist">${d.holds.map(h => html`<div><span><b>${h.codes.join('、')}</b><small>${h.note} · ${staffName(h.staff_id)} · ${fmt.rel(h.created_at, serverNow())}</small></span><button class="btn btn--ghost btn--sm" data-act="hold-release" data-id="${h.id}"><span>释放</span></button></div>`)}</div>`) : ''}
      </div>
    </div>`;
}
function markSel() {
  $$('.sp-res.is-sel').forEach(n => n.classList.remove('is-sel'));
  if (S.drawer && S.drawer.type === 'table') $(`.sp-res[data-code="${S.drawer.code}"]`)?.classList.add('is-sel');
}
function afterBoard() { markSel(); }

function tierText(d, tier) {
  const p = d.prices && d.prices[tier];
  if (!p) return tier;
  const r = d.deposit_ratio || 0.3;
  return `${tier} 档 · 会员低消 ${yuan(p.member)}（订金 ${yuan(p.member * r)}） · 非会员低消 ${yuan(p.guest)}（订金 ${yuan(p.guest * r)}）`;
}
function drawerTable({ code }) {
  const d = S.data.board;
  const r = resourceOf(code);
  const z = zoneOf(r.zone);
  const head = html`<p class="k">${z.zh} · ${z.en}</p><h2>${code}${r.card.name ? html`<i>${r.card.name}</i>` : ''}</h2><p>${r.card.story || `${r.capacity} 座 · ${r.type === 'table' ? '四人方桌' : r.type === 'bar' ? '吧台' : '两人桌'}`}</p>`;
  if (!d) return { label: code, head, body: html`<p class="empty">…</p>` };
  const st = d.states[code] || { state: 'available', taken: 0 };
  const s = d.session;
  const live = ['pending_payment', 'pending_confirm', 'confirmed', 'fulfilled'];
  const here = d.bookings.filter(b => live.includes(b.status) && b.lines.some(l => l.code === code));
  const h = st.hold ? d.holds.find(x => x.id === st.hold) : null;
  const paused = st.state === 'paused';
  const free = ['available', 'reserved_open'].includes(st.state) && !(r.unit === 'seats' && st.taken > 0);
  return {
    label: `${code} 桌位`,
    head,
    body: html`<div class="dsec"><div class="dsec__h"><b>这一晚</b><span>${fmt.mdOf(s.date)} · ${s.title}</span></div>
        <dl class="kv"><dt>状态</dt><dd>${TSTATE[st.state] || st.state}</dd>
          <dt>容量</dt><dd>${r.capacity} 人 · ${r.unit === 'whole' ? '整桌预订' : `按座位，已占 ${st.taken} / ${r.capacity}`}</dd>
          ${r.type === 'booth' ? html`<dt>低消</dt><dd>${tierText(d, r.tier)}</dd>` : ''}
          ${st.reserved ? html`<dt>会员预留</dt><dd>每晚为会员预留，19:00 后空着的向所有人开放</dd>` : ''}
        </dl></div>
      ${here.length ? html`<div class="dsec"><div class="dsec__h"><b>这张桌上的订单</b><span>Bookings</span></div><div class="blist">${here.map(brow)}</div></div>` : ''}
      ${h ? html`<div class="dsec"><div class="dsec__h"><b>线下占桌</b><span>Hold</span></div><p class="quote">${h.note} · ${staffName(h.staff_id)} · ${fmt.rel(h.created_at, serverNow())}</p></div>` : ''}
      ${free && !paused ? html`<form class="dsec" data-form="hold" data-code="${code}"><div class="dsec__h"><b>线下占桌</b><span>Phone booking</span></div>
        <label class="f"><span>备注</span><input class="inp" name="note" maxlength="60" placeholder="电话预订 · 王先生 4 位 · 21:00 到"></label>
        <div style="margin-top:10px"><button class="btn btn--ghost">${icon('phone')}<span>占下这张桌</span></button></div>
        <p class="hint" style="margin-top:6px">占下后会员端立即显示为已订。</p></form>` : ''}`,
    foot: [
      html`<button class="btn ${paused ? 'btn--green' : 'btn--ghost'}" data-act="table-pause" data-code="${code}" data-v="${paused ? '0' : '1'}">${icon('pause')}<span>${paused ? '恢复这张桌' : '暂停这张桌'}</span></button>`,
      h ? html`<button class="btn btn--ghost" data-act="hold-release" data-id="${h.id}"><span>释放线下占桌</span></button>` : '',
    ],
  };
}

/* confirm: the store assigns the exact table inside the zone the guest chose */
async function openConfirm(id) {
  const b = S.cache.get(id);
  openDrawer('confirm', { id, board: null, pick: b ? b.lines.map(l => l.code) : [] });
  try {
    const dr = S.drawer;
    dr.board = await call('admin.board', { session_id: b ? b.session.id : undefined });
    remember(dr.board.bookings);
    if (!b && S.cache.get(id)) dr.pick = S.cache.get(id).lines.map(l => l.code);
    if (S.drawer === dr) renderDrawer();
  } catch (e) { handleError(e); }
}
function dealHead(b, k) {
  const z = zoneOf(b.zone);
  return html`<p class="k">${k}</p><h2>${b.code}<i>${z.zh}</i></h2><p>${b.user ? b.user.name : ''} · ${idn(b.identity_snapshot)} · ${b.party_size} 人 · ${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)}${b.session ? ` · ${b.session.title}` : ''}</p>`;
}
function drawerConfirm({ id, board, pick }) {
  const b = S.cache.get(id);
  if (!b) return { label: '确认订单', head: html`<h2>…</h2>`, body: html`<p class="empty">…</p>` };
  const head = dealHead(b, 'Term sheet · 尽调中');
  if (b.status !== 'pending_confirm') return { label: '确认订单', head, body: html`<p class="empty"><b>Already handled.</b>这笔订单现在是「${BOOKING_STATUS[b.status].zh}」。</p>`, foot: html`<button class="btn btn--ghost" data-act="booking" data-id="${b.id}"><span>查看订单</span></button>` };
  const z = zoneOf(b.zone);
  const booth = b.kind === 'booth';
  const st = board ? board.states : null;
  const options = RESOURCES.filter(r => r.zone === b.zone);
  const ok = r => { const x = st && st[r.code]; return !!x && (x.booking === b.id || ['available', 'reserved_open'].includes(x.state)); };
  const start = (b.history.find(h => h.status === 'pending_confirm') || {}).at;
  const span = start ? Math.max(60e3, Date.parse(b.confirm_deadline_at) - Date.parse(start)) : 30 * 60e3;
  const ready = !booth || pick.length === b.units;
  return {
    label: `确认 ${b.code}`,
    head,
    body: html`<div class="dsec" style="display:flex;gap:16px;align-items:center">${ring(b.confirm_deadline_at, span, 'LEFT')}<p class="hint">门店需在 ${fmt.time(b.confirm_deadline_at)} 前确认；超时自动关闭，${b.payment && b.payment.status === 'paid' ? `${yuan(b.payment.amount)} 原路退回` : '无需退款'}。</p></div>
      <div class="dsec"><div class="dsec__h"><b>${booth ? '安排桌号' : '座位'}</b><span>${booth ? `Assign ${b.units} of ${options.length}` : 'Seats'}</span></div>
        ${booth ? html`<p class="hint" style="margin-bottom:10px">客人选的是「${z.zh}」。系统先预留了 ${b.lines.map(l => l.code).join('、')}，可以换成区内别的空桌。选 ${b.units} 张。</p>
          ${st ? html`<div class="tpick">${options.map(r => { const x = st[r.code] || {}; const mine = x.booking === b.id; return html`<button class="tcard" data-act="pick-table" data-code="${r.code}" aria-pressed="${String(pick.includes(r.code))}" ${raw(ok(r) ? '' : 'disabled')}><span class="mono">${r.code}${mine ? ' · 系统预留' : ''}</span><b>${r.card.name}</b><p>${r.card.story}</p>${ok(r) ? '' : html`<em class="tag">${TSTATE[x.state] || '—'}</em>`}</button>`; })}</div>` : html`<p class="hint">…</p>`}`
          : html`<p class="hint">按座位预订的订单由系统分配座位：${linesText(b)}。确认后客人立即收到通知。</p>`}
      </div>
      <div class="dsec"><div class="dsec__h"><b>为什么要人工确认</b><span>Why manual</span></div>
        <div class="memo__why">${(b.manual_reasons || []).map(r => html`<span class="tag tag--red">${REASONS[r] || r}</span>`)}</div>
        ${b.note ? html`<p class="quote" style="margin-top:10px">「${b.note}」</p>` : ''}
        ${b.explanation ? html`<p class="quote" style="margin-top:10px">多订说明：${b.explanation}</p>` : ''}
      </div>
      <div class="dsec"><div class="dsec__h"><b>钱</b><span>Money</span></div><dl class="kv">
        <dt>预付</dt><dd>${b.payment && b.payment.status === 'paid' ? `${yuan(b.payment.amount)} · ${b.payment.kind === 'deposit' ? '订金，抵当晚消费' : '门票'}` : '无'}</dd>
        ${booth ? html`<dt>低消</dt><dd>${yuan(b.identity_snapshot === 'member_active' ? b.price.min_spend_member : b.price.min_spend_guest)} / 桌 · ${idn(b.identity_snapshot)}价</dd>` : ''}
      </dl></div>`,
    foot: [
      html`<button class="btn btn--green" data-act="confirm-go" ${raw(ready ? '' : 'disabled')}>${icon('check')}<span>${booth ? `确认 · 交割 ${pick.join('、') || ''}` : '确认 · 交割'}</span></button>`,
      html`<button class="btn btn--ghost btn--red" data-act="reject" data-id="${b.id}"><span>婉拒</span></button>`,
    ],
  };
}

/* reject: say why, and suggest another zone */
const REJECT_QUICK = ['这一晚该区域已排满', '人数超出卡座容量', '备注里的要求今晚做不到', '这一晚有包场'];
async function openReject(id) {
  const b = S.cache.get(id);
  openDrawer('reject', { id, board: null });
  try {
    const dr = S.drawer;
    dr.board = await call('admin.board', { session_id: b ? b.session.id : undefined });
    if (S.drawer === dr) renderDrawer();
  } catch (e) { handleError(e); }
}
function drawerReject({ id, board }) {
  const b = S.cache.get(id);
  if (!b) return { label: '婉拒订单', head: html`<h2>…</h2>`, body: html`<p class="empty">…</p>` };
  const head = dealHead(b, 'Pass · 本轮未进');
  if (b.status !== 'pending_confirm') return { label: '婉拒订单', head, body: html`<p class="empty"><b>Already handled.</b>这笔订单现在是「${BOOKING_STATUS[b.status].zh}」。</p>` };
  const zones = board ? board.zones.filter(z => z.id !== b.zone && z.free > 0) : [];
  return {
    label: `婉拒 ${b.code}`,
    head,
    body: html`<form id="rjform" data-form="reject">
      <label class="f"><span>原因 <i>会发给客人</i></span><textarea class="ta" name="reason" maxlength="120" placeholder="这一晚该区域已排满，抱歉。"></textarea></label>
      <div class="chips" style="margin-top:8px">${REJECT_QUICK.map(t => html`<button type="button" class="chip" data-act="rj-quick" data-v="${t}">${t}</button>`)}</div>
      <label class="f" style="margin-top:14px"><span>建议 <i>可选</i></span><input class="inp" name="suggestion" maxlength="120" placeholder="可以改订沙龙沙发，或者明晚的墙边卡座。"></label>
      <label class="f"><span>建议改订的区域 <i>客人的订单页会出现改订按钮</i></span><select class="sel" name="suggestion_zone"><option value="">不建议</option>${zones.map(z => html`<option value="${z.id}">${zoneOf(z.id).zh} · 余 ${z.free} ${z.unit === 'seat' ? '座' : '桌'}</option>`)}</select></label>
      <p class="hint" style="margin-top:12px">${b.payment && b.payment.status === 'paid' ? `${yuan(b.payment.amount)} 将原路退回（模拟通道约 20 秒到账）。` : '这笔订单没有预付款。'}</p>
    </form>`,
    foot: [
      html`<button class="btn btn--red" data-act="reject-go">${icon('close')}<span>确认婉拒</span></button>`,
      html`<button class="btn btn--ghost" data-act="confirm" data-id="${b.id}"><span>返回确认</span></button>`,
    ],
  };
}

/* ---------- the front door ---------- */
async function loadVerify() {
  const [codes, wb] = await Promise.all([call('demo.codes'), call('admin.workbench')]);
  remember(wb.arrivals);
  return { codes, arrivals: wb.arrivals };
}
function demoCodes(c) {
  return html`<p>Demo · 演示：点一下填入</p><div class="chips">${c.members.map(m => html`<button type="button" class="chip" data-act="fill-code" data-code="${m.code}">${m.code}<small>${m.name}的会员码</small></button>`)}${c.bookings.slice(0, 6).map(b => html`<button type="button" class="chip" data-act="fill-code" data-code="${b.code}">${b.code}<small>${b.name} · ${zn(b.zone)}</small></button>`)}</div>`;
}
function pass(r) {
  if (r.kind === 'member') {
    const m = r.member;
    const ms = m.membership || {};
    return html`<div class="pass"><span class="pass__stamp">Member<small>会员有效</small></span>
      <div class="pass__h"><span class="cameo cameo--lg">${initialOf(m.name)}</span><div><h3>${m.name}<i>No.${m.member_no}</i></h3><p>${m.company_role || '—'} · 有效期至 ${ms.end_at ? fmt.date(ms.end_at) : '—'} · 剩 ${ms.days_left ?? '—'} 天</p></div></div>
      <div class="pass__sec"><h4>Tonight · 今晚的订单</h4>${r.bookings.length
        ? html`<div class="minilist">${r.bookings.map(b => html`<button data-act="admit" data-code="${b.code}"><span><b>${zn(b.zone)}</b> <span class="mono muted">${b.code}</span><small>${linesText(b)} · ${b.party_size} 人</small></span>${bstamp(b.status)}</button>`)}</div>`
        : html`<p class="hint">今晚没有订单。会员本人可以入场，散座按现场情况安排。</p>`}</div>
    </div>`;
  }
  const b = r.booking;
  const u = b.user || {};
  return html`<div class="pass"><span class="pass__stamp ${r.repeat ? 'is-repeat' : ''}">${r.repeat ? 'Already in' : 'Admitted'}<small>${r.repeat ? '已入场' : '欢迎光临'}</small></span>
    <div class="pass__h"><span class="cameo cameo--lg">${initialOf(u.name)}</span><div><h3>${u.name || '—'}<i>${b.code}</i></h3><p>${zn(b.zone)} · ${b.party_size} 人 · ${idn(b.identity_snapshot)}${u.member_no ? ` · No.${u.member_no}` : ''}${b.verified_at ? ` · ${fmt.time(b.verified_at)} 入场` : ''}</p></div></div>
    <div class="pass__tables">${b.lines.map(l => html`<span><b>${l.name || l.code}</b><small>${l.code} · ${l.seats} 座</small></span>`)}</div>
    ${b.table_released ? html`<p class="hint" style="margin-top:8px">已过留位时间，原桌位已释放：请现场重新安排。订金今晚仍可抵扣。</p>` : ''}
    ${b.ticket ? html`<div class="pass__sec"><h4>Tickets · 门票</h4><div class="money"><div><span>门票</span><b>× ${b.ticket.count}</b></div><div><span>赠饮</span><b>${b.ticket.drink_redeemed ? '已兑换' : '未兑换'}</b></div></div>
      ${b.ticket.drink_redeemed ? '' : html`<div class="redeem"><button class="btn btn--brass btn--sm" data-act="drink" data-id="${b.id}"><span>兑换赠饮 · 每张门票一杯特调</span></button></div>`}</div>` : ''}
    ${b.deposit ? html`<div class="pass__sec"><h4>Deposit · 订金抵扣</h4><div class="money"><div><span>订金</span><b>${yuan(b.deposit.paid)}</b></div><div><span>已抵扣</span><b>${yuan(b.deposit.redeemed)}</b></div><div><span>余额</span><b class="is-left">${yuan(b.deposit.left)}</b></div></div>
      ${b.deposit.left > 0 ? html`<form class="redeem" data-form="redeem" data-id="${b.id}"><input class="inp" name="amount" inputmode="decimal" aria-label="抵扣金额（元）" value="${b.deposit.left / 100}"><input class="inp" name="note" maxlength="60" placeholder="账单号 / 备注"><button class="btn btn--green btn--sm"><span>抵扣</span></button></form>`
        : html`<p class="hint" style="margin-top:8px">订金已全部抵扣。</p>`}</div>` : ''}
  </div>`;
}
function viewVerify(d) {
  const r = S.ui.vresult;
  const inside = d.arrivals.filter(b => b.status === 'fulfilled');
  const waiting = d.arrivals.filter(b => b.status === 'confirmed');
  return html`<div class="desk">
    <div>
      <form class="door" data-form="verify" autocomplete="off">
        <p class="door__k">The front door · 入场核验</p>
        <h2 class="door__h">请出示订单凭证或会员码</h2>
        <p class="door__p">订单凭证形如 LL-7K2Q，只能入场一次；会员码是会员卡上的 6 位数字，每 30 秒更新。</p>
        <div class="codein" id="codein"><input name="code" data-bind="vcode" value="${S.ui.vcode}" placeholder="LL-____" maxlength="12" aria-label="订单凭证或会员码" autocapitalize="characters" spellcheck="false"></div>
        <div><button class="btn btn--brass btn--lg">${icon('key')}Verify<span>核验</span></button></div>
        <p class="door__err" data-err role="alert"></p>
        <div class="demo-codes" id="democodes">${demoCodes(d.codes)}</div>
      </form>
    </div>
    <div class="grid">
      ${r ? pass(r) : html`<div class="empty"><b>Waiting at the door.</b>核验后，这里显示桌号、门票赠饮和订金余额。</div>`}
      ${card('今晚待到店', `Expected · ${waiting.length}`, waiting.length ? html`<div class="minilist">${waiting.map(b => html`<button data-act="admit" data-code="${b.code}"><span><b>${b.user ? b.user.name : ''}</b> <span class="mono muted">${b.code}</span><small>${zn(b.zone)} · ${linesText(b)} · ${b.party_size} 人</small></span><span class="btn btn--ghost btn--sm"><span>核验</span></span></button>`)}</div>` : html`<p class="empty">没有待到店的订单。</p>`)}
      ${card('已入场', `Inside · ${inside.length}`, inside.length ? html`<div class="minilist">${inside.map(b => html`<button data-act="booking" data-id="${b.id}"><span><b>${b.user ? b.user.name : ''}</b> <span class="mono muted">${b.code}</span><small>${zn(b.zone)} · ${linesText(b)}</small></span><span class="num muted">${b.verified_at ? fmt.time(b.verified_at) : ''}</span></button>`)}</div>` : html`<p class="empty">还没有人入场。</p>`)}
    </div>
  </div>`;
}
let pageTimer = null;
function stopPageTimer() { clearInterval(pageTimer); pageTimer = null; }
function afterVerify() {
  if (!S.ui.vresult) $('#codein input')?.focus();
  stopPageTimer();
  pageTimer = setInterval(async () => {
    if (S.page !== 'verify') { stopPageTimer(); return; }
    try {
      const c = await call('demo.codes');
      const box = $('#democodes');
      if (box) box.innerHTML = demoCodes(c).s;
      if (S.data.verify) S.data.verify.codes = c;
    } catch { /* ignore */ }
  }, 8000);
}
async function verifyCode(code) {
  try {
    const r = await call('admin.verify', { code });
    S.ui.vresult = r;
    S.ui.vcode = '';
    if (r.kind === 'booking') remember([r.booking]);
    toast(r.kind === 'member' ? `会员 ${r.member.name} · No.${r.member.member_no}` : r.repeat ? `${r.booking.code} 已经入场过了` : `欢迎 · ${r.booking.user ? r.booking.user.name : ''} · ${zn(r.booking.zone)}`);
    if (S.drawer) closeDrawer();
    if (S.page !== 'verify') location.hash = '#/verify';
    else await load(false);
    loadBadges();
    return r;
  } catch (e) {
    const err = S.page === 'verify' && $('.door [data-err]');
    if (err) {
      err.textContent = e.rule ? `${e.message}（${e.rule}）` : e.message;
      $('#codein')?.classList.add('is-bad');
      setTimeout(() => $('#codein')?.classList.remove('is-bad'), 450);
    } else handleError(e);
    return null;
  }
}
async function reverify() {
  const r0 = S.ui.vresult;
  if (!r0 || r0.kind !== 'booking') return load(false);
  try {
    const r = await call('admin.verify', { code: r0.booking.code });
    S.ui.vresult = { ...r, repeat: r0.repeat };
    remember([r.booking]);
    await load(false);
  } catch (e) { handleError(e); }
}

/* ---------- bookings ---------- */
const BK_FILTERS = [['', '全部'], ['pending_confirm', '尽调中'], ['pending_payment', '待支付'], ['confirmed', '已交割'], ['fulfilled', '已到店'], ['rejected', '本轮未进'], ['confirm_timeout_closed', '确认超时'], ['payment_expired', '超时未付'], ['no_show', '未到店'], ['cancelled', '已取消']];
function viewBookings(list) {
  remember(list);
  const q = S.ui.bkQ.trim().toLowerCase();
  const rows = list.filter(b => (!S.ui.bkStatus || b.status === S.ui.bkStatus) && (!q || [b.code, b.user && b.user.name, b.user && b.user.phone, zn(b.zone), linesText(b)].join(' ').toLowerCase().includes(q)));
  const count = k => list.filter(b => b.status === k).length;
  return html`<p class="lede">按分区订座：客人选区域与人数，<b>门店在确认时安排具体桌号</b>。状态沿用规格 T1–T14：待支付锁定 10 分钟；卡座、多桌、带备注的订单 30 分钟内人工确认，超时自动关闭并原路退款。</p>
    <div class="toolbar"><div class="chips">${BK_FILTERS.filter(([k]) => !k || count(k)).map(([k, l]) => html`<button class="chip" aria-pressed="${String(S.ui.bkStatus === k)}" data-act="bk-filter" data-v="${k}">${l}<em>${k ? count(k) : list.length}</em></button>`)}</div><span class="toolbar__sp"></span><label class="search">${icon('search')}<input data-bind="bkQ" data-live="1" value="${S.ui.bkQ}" placeholder="凭证 / 姓名 / 手机 / 区域" aria-label="搜索订单"></label></div>
    <section class="card"><div class="tablewrap"><table class="table"><thead><tr><th>凭证</th><th>场次</th><th>区域 · 桌号</th><th class="num">人数</th><th>客人</th><th>下单身份</th><th>状态</th><th class="num">预付</th><th class="num">下单</th></tr></thead><tbody>
    ${rows.map(b => html`<tr data-act="booking" data-id="${b.id}" tabindex="0"><td class="mono">${b.code}</td><td class="nowrap">${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)}</td><td>${zn(b.zone)}<br><span class="muted mono">${linesText(b)}</span></td><td class="num">${b.party_size}</td><td>${who(b.user)}</td><td>${idn(b.identity_snapshot)}</td><td>${bstamp(b.status)}</td><td class="num mono">${b.price.total_due ? yuan(b.price.total_due) : '—'}</td><td class="num muted mono nowrap">${fmt.rel(b.created_at, serverNow())}</td></tr>`)}
    </tbody></table></div>${rows.length ? '' : html`<p class="empty" style="margin:16px">没有符合条件的订单。</p>`}</section>`;
}
function bookingFoot(b) {
  if (b.status === 'pending_confirm') return [html`<button class="btn btn--green" data-act="confirm" data-id="${b.id}">${icon('check')}<span>确认 · 排桌</span></button>`, html`<button class="btn btn--ghost btn--red" data-act="reject" data-id="${b.id}"><span>婉拒</span></button>`];
  if (b.status === 'confirmed') return [html`<button class="btn btn--green" data-act="admit" data-code="${b.code}">${icon('key')}<span>核验入场</span></button>`, b.table_released ? '' : html`<button class="btn btn--ghost" data-act="release" data-id="${b.id}"><span>释放桌位 · ${b.session ? b.session.hold_deadline : '21:30'} 后</span></button>`];
  if (b.status === 'fulfilled' && b.deposit && b.deposit.left > 0) return [html`<button class="btn btn--ghost" data-act="admit" data-code="${b.code}"><span>订金抵扣</span></button>`];
  return [];
}
function drawerBooking({ id }) {
  const b = S.cache.get(id);
  if (!b) return { label: '订单', head: html`<h2>…</h2>`, body: html`<p class="empty">…</p>` };
  const z = zoneOf(b.zone);
  const reasons = (b.manual_reasons || []).map(r => REASONS[r] || r).join('、');
  const pay = b.payment;
  return {
    label: `订单 ${b.code}`,
    head: html`<p class="k">${b.label.deal} · ${b.label.zh}</p><h2>${b.code}<i>${z.zh}</i></h2><p>${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)}${b.session ? ` · ${b.session.title} · ${b.session.show_start} 开场` : ''}</p>`,
    body: html`<div class="dsec"><div class="dsec__h"><b>订单</b><span>Booking · rules ${b.rules_version || 'v0.3'}</span></div><dl class="kv">
        <dt>客人</dt><dd>${b.user ? `${b.user.name} · ${b.user.phone}${b.user.member_no ? ` · No.${b.user.member_no}` : ''}` : '—'}</dd>
        <dt>下单身份</dt><dd>${idn(b.identity_snapshot)}</dd>
        <dt>区域</dt><dd>${z.zh} · ${z.en}</dd>
        <dt>人数</dt><dd>${b.party_size} 人 · ${b.units} ${b.kind === 'booth' ? '张卡座' : '张桌'}</dd>
        <dt>桌号</dt><dd>${linesText(b)}${b.status === 'pending_confirm' && b.kind === 'booth' ? html` <span class="tag tag--amber">系统预留，确认时可调整</span>` : ''}${b.table_released ? html` <span class="tag tag--amber">已释放</span>` : ''}</dd>
        <dt>确认方式</dt><dd>${b.confirm_mode === 'instant' ? '即时成功' : `人工确认${reasons ? `（${reasons}）` : ''}`}</dd>
        ${b.note ? html`<dt>备注</dt><dd>${b.note}</dd>` : ''}
        ${b.explanation ? html`<dt>多订说明</dt><dd>${b.explanation}</dd>` : ''}
        ${b.reject_reason ? html`<dt>婉拒原因</dt><dd>${b.reject_reason}${b.suggestion ? html`<br><span class="muted">建议：${b.suggestion}${b.suggestion_zone ? ` → ${zn(b.suggestion_zone)}` : ''}</span>` : ''}</dd>` : ''}
      </dl></div>
      <div class="dsec"><div class="dsec__h"><b>钱</b><span>Money · mock channel</span></div><dl class="kv">
        <dt>应付</dt><dd>${b.price.total_due ? `${yuan(b.price.total_due)} · ${b.kind === 'booth' ? `订金，低消 ${yuan(b.identity_snapshot === 'member_active' ? b.price.min_spend_member : b.price.min_spend_guest)} 的 30%` : `门票 × ${b.price.tickets}`}` : '无需预付（会员散座）'}</dd>
        ${pay ? html`<dt>支付</dt><dd>${PAY_STATUS[pay.status] || pay.status}${pay.paid_at ? ` · ${fmt.full(pay.paid_at)}` : ''}</dd>` : ''}
        ${b.deposit ? html`<dt>订金</dt><dd>已抵扣 ${yuan(b.deposit.redeemed)} · 余 ${yuan(b.deposit.left)} · ${DEPOSIT_STATE[b.deposit.state] || b.deposit.state}</dd>` : ''}
        ${b.ticket ? html`<dt>门票</dt><dd>× ${b.ticket.count} · ${b.ticket.verification === 'verified' ? '已核验' : '未核验'} · 赠饮${b.ticket.drink_redeemed ? '已兑换' : '未兑换'}</dd>` : ''}
        ${b.refund ? html`<dt>退款</dt><dd>${yuan(b.refund.amount)} · ${b.refund.status === 'succeeded' ? `已到账 ${fmt.time(b.refund.settled_at)}` : '处理中 · 约 20 秒到账'}</dd>` : ''}
      </dl></div>
      <div class="dsec"><div class="dsec__h"><b>时间线</b><span>History</span></div><ul class="timeline">${b.history.map(h => html`<li>${BOOKING_STATUS[h.status] ? `${BOOKING_STATUS[h.status].zh} · ${BOOKING_STATUS[h.status].deal}` : h.status}${h.note === 'table_released' ? ' · 桌位释放' : ''}<time>${fmt.full(h.at)}</time>${h.by ? html`<small>${staffName(h.by)}</small>` : ''}${h.reason ? html`<small>${REFUND_REASON[h.reason] || h.reason}</small>` : ''}</li>`)}</ul></div>`,
    foot: bookingFoot(b),
  };
}

/* ---------- members ---------- */
function viewMembers(list) {
  const q = S.ui.memQ.trim().toLowerCase();
  const f = S.ui.memFilter;
  const pass1 = m => f === 'all' || (f === 'active' && m.membership.active) || (f === 'soon' && m.membership.expiring_soon) || (f === 'expired' && !m.membership.active);
  const rows = list.filter(m => pass1(m) && (!q || [m.name, m.en, m.member_no, m.phone, m.company_role, m.city].join(' ').toLowerCase().includes(q)));
  const n = { all: list.length, active: list.filter(m => m.membership.active).length, soon: list.filter(m => m.membership.expiring_soon).length, expired: list.filter(m => !m.membership.active).length };
  return html`<div class="toolbar"><div class="chips">${[['all', '全部'], ['active', '有效'], ['soon', '7 天内到期'], ['expired', '已到期']].map(([k, l]) => html`<button class="chip" aria-pressed="${String(f === k)}" data-act="mem-filter" data-v="${k}">${l}<em>${n[k]}</em></button>`)}</div><span class="toolbar__sp"></span><label class="search">${icon('search')}<input data-bind="memQ" data-live="1" value="${S.ui.memQ}" placeholder="姓名 / No. / 手机 / 公司" aria-label="搜索会员"></label></div>
  <section class="card"><div class="tablewrap"><table class="table"><thead><tr><th>No.</th><th>会员</th><th>公司 · 角色</th><th>有效期</th><th>来源</th><th class="num">签到</th><th class="num">订座</th><th>已解锁</th></tr></thead><tbody>
  ${rows.map(m => html`<tr data-act="member" data-id="${m.id}" tabindex="0"><td class="mono">${m.member_no}</td><td><div class="who2"><span class="cameo">${initialOf(m.name)}</span><span><b>${m.name}</b><span>${m.en || ''}${m.city ? ` · ${m.city}` : ''}</span></span></div></td><td>${m.company_role || '—'}</td>
    <td class="nowrap">${fmt.date(m.membership.end_at)}<br>${m.membership.active ? (m.membership.expiring_soon ? html`<span class="tag tag--amber">${m.membership.days_left} 天后到期</span>` : html`<span class="muted">剩 ${m.membership.days_left} 天</span>`) : html`<span class="tag tag--red">已到期 ${m.membership.expired_days} 天</span>`}</td>
    <td>${m.membership.source === 'gift' ? '赠送' : '付费'}</td><td class="num">${m.checkins}</td><td class="num">${m.bookings}</td><td>${m.unlocks.length ? html`<span class="chips">${m.unlocks.map(k => html`<span class="tag tag--layer">${k}</span>`)}</span>` : html`<span class="muted">—</span>`}</td></tr>`)}
  </tbody></table></div>${rows.length ? '' : html`<p class="empty" style="margin:16px">没有符合条件的会员。</p>`}</section>`;
}
async function openMember(id) {
  openDrawer('member', { id, data: null });
  try {
    const dr = S.drawer;
    const [m, content] = await Promise.all([call('admin.member', { id }), S.content ? Promise.resolve(S.content) : call('admin.content')]);
    S.content = content;
    dr.data = m;
    if (S.drawer === dr) renderDrawer();
  } catch (e) { handleError(e); }
}
function drawerMember({ data: m }) {
  if (!m) return { label: '会员', head: html`<h2>…</h2>`, body: html`<p class="empty">…</p>` };
  const ms = m.membership;
  remember(m.bookings);
  const grantable = (S.content || []).filter(c => c.unlock_rule && c.unlock_rule.type === 'staff_grant' && !m.unlocks.some(u => u.key === c.key && !u.revoked_at));
  return {
    label: m.name,
    head: html`<p class="k">${ms ? `No.${ms.member_no} · ` : ''}${idn(m.identity)}</p><h2>${m.name}${m.en ? html`<i>${m.en}</i>` : ''}</h2><p>${[m.company_role, m.city, m.phone].filter(Boolean).join(' · ')}</p>`,
    body: html`
      ${ms ? html`<div class="dsec"><div class="dsec__h"><b>会籍</b><span>Membership</span></div><dl class="kv">
        <dt>状态</dt><dd>${ms.active ? `有效 · 剩 ${ms.days_left} 天` : `已到期 ${ms.expired_days} 天${ms.can_renew ? ' · 可直接续费' : ' · 需重新申请'}`}</dd>
        <dt>有效期至</dt><dd>${fmt.full(ms.end_at)}</dd><dt>入会</dt><dd>${fmt.date(ms.since)}</dd></dl>
        <ul class="timeline" style="margin-top:12px">${ms.segments.map(s => html`<li>${s.source === 'gift' ? '赠送' : '付费'} · ${fmt.date(s.start_at)} → ${fmt.date(s.end_at)}</li>`)}</ul></div>` : ''}
      ${m.intro ? html`<div class="dsec"><div class="dsec__h"><b>自我介绍</b><span>Intro</span></div><p class="quote">${m.intro}</p></div>` : ''}
      <div class="dsec"><div class="dsec__h"><b>已解锁</b><span>Layers L2 – L3</span></div>
        ${m.unlocks.length ? html`<div class="minilist">${m.unlocks.map(u => html`<div><span><b>${contentTitle(u.key)}</b><small>${SOURCE[u.source] || u.source} · ${fmt.date(u.at)}${u.revoked_at ? ' · 已撤销' : ''}</small></span>${!u.revoked_at && isAdmin() ? html`<button class="btn btn--ghost btn--sm" data-act="revoke" data-id="${u.id}"><span>撤销</span></button>` : ''}</div>`)}</div>` : html`<p class="hint">还没有解锁更深的内容。</p>`}
        ${grantable.length ? html`<form class="redeem" data-form="grant" data-user="${m.id}"><select class="sel" name="key" style="flex:1">${grantable.map(c => html`<option value="${c.key}">${c.teaser.title}</option>`)}</select><button class="btn btn--green btn--sm" ${raw(isAdmin() ? '' : 'disabled')}><span>授予</span></button></form>${isAdmin() ? '' : html`<p class="hint">授予需要店长权限。</p>`}` : ''}
      </div>
      <div class="dsec"><div class="dsec__h"><b>订座</b><span>Bookings · ${m.bookings.length}</span></div>${m.bookings.length ? html`<div class="blist">${m.bookings.map(brow)}</div>` : html`<p class="hint">没有订座记录。</p>`}</div>
      <div class="dsec"><div class="dsec__h"><b>白天签到</b><span>Check-ins · ${m.checkins.length}</span></div>${m.checkins.length ? html`<div class="minilist">${m.checkins.map(c => html`<div><span>${fmt.date(c.at)} ${fmt.time(c.at)}</span><span class="muted">+${c.companions} 位朋友</span></div>`)}</div>` : html`<p class="hint">还没有签到。</p>`}</div>
      <div class="dsec"><div class="dsec__h"><b>活动</b><span>Programme</span></div>${m.registrations.length ? html`<div class="minilist">${m.registrations.map(r => html`<div><span>${r.event ? r.event.title : '—'}<small>${r.event ? fmt.date(r.event.start_at) : ''}</small></span><span>${REG_STATUS[r.status] || r.status}${r.hosted ? ' · 讲者' : ''}</span></div>`)}</div>` : html`<p class="hint">还没有报名活动。</p>`}</div>`,
  };
}

/* ---------- applications ---------- */
const APP_COLS = [['under_review', 'Under review', '审核中', 'var(--brass)'], ['need_info', 'Need info', '待补资料', '#C4861C'], ['approved_awaiting_payment', 'Approved', '已通过 · 待付款', 'var(--green)'], ['rejected', 'Declined', '未通过', 'var(--muted)']];
function viewApplications(list) {
  return html`<p class="lede">入会走「尽调」：店长审核申请，通过后申请人支付首月会员费（模拟支付）即生效。前台可以查看，<b>审核需要店长权限</b>。受邀的朋友走邀请函，不需要审核。</p>
    <div class="holes">${APP_COLS.map(([k, en, zh, c]) => {
      const items = list.filter(a => a.status === k);
      return html`<div class="col"><div class="col__h"><b>${en}</b><span>${zh}</span><em>${items.length}</em></div>
        ${items.map(a => html`<button class="appcard" style="--c:${c}" data-act="app" data-id="${a.id}"><span class="appcard__h"><b>${a.profile.name}</b><time>${fmt.rel(a.created_at, serverNow())}</time></span><p>${a.profile.company_role}</p><small>${a.profile.city}${a.profile.referrer ? ` · 推荐人 ${a.profile.referrer}` : ''}</small></button>`)}
        ${items.length ? '' : html`<p class="hint" style="text-align:center;padding:10px 0">空</p>`}</div>`;
    })}</div>`;
}
function drawerApp({ id }) {
  const a = (S.data.applications || []).find(x => x.id === id);
  if (!a) return { label: '申请', head: html`<h2>…</h2>`, body: html`<p class="empty">这份申请已经处理完了。</p>` };
  const p = a.profile;
  const open = ['under_review', 'need_info'].includes(a.status);
  const dis = raw(isAdmin() ? '' : 'disabled');
  return {
    label: `${p.name} 的申请`,
    head: html`<p class="k">${APP_STATUS[a.status].en} · ${APP_STATUS[a.status].zh}</p><h2>${p.name}</h2><p>${p.city} · ${p.phone}</p>`,
    body: html`<div class="dsec"><div class="dsec__h"><b>申请资料</b><span>Profile</span></div><dl class="kv"><dt>公司 / 角色</dt><dd>${p.company_role}</dd><dt>城市</dt><dd>${p.city}</dd><dt>推荐人</dt><dd>${p.referrer || '—'}</dd><dt>手机</dt><dd>${p.phone}</dd><dt>提交</dt><dd>${fmt.full(a.created_at)}</dd></dl></div>
      ${p.intro ? html`<div class="dsec"><div class="dsec__h"><b>自我介绍</b><span>Intro</span></div><p class="quote">${p.intro}</p></div>` : ''}
      <div class="dsec"><div class="dsec__h"><b>记录</b><span>History</span></div><ul class="timeline">${a.history.map(h => html`<li>${APP_STATUS[h.status] ? APP_STATUS[h.status].zh : h.status}<time>${fmt.full(h.at)}</time>${h.note ? html`<small>${h.note}</small>` : ''}</li>`)}</ul></div>
      ${open ? html`<div class="dsec"><div class="dsec__h"><b>审核意见</b><span>Note to applicant</span></div><textarea class="ta" id="appnote" maxlength="200" placeholder="通过可以不写；请补资料或婉拒时，这段话会发给申请人。"></textarea>${isAdmin() ? '' : html`<p class="hint" style="margin-top:6px">审核需要店长权限（${(S.staffList.find(s => s.role === 'admin') || { name: '店长' }).name}）。</p>`}</div>` : ''}`,
    foot: open ? [
      html`<button class="btn btn--green" data-act="review" data-v="approve" ${dis}>${icon('check')}<span>通过 · 待付款</span></button>`,
      html`<button class="btn btn--ghost" data-act="review" data-v="need_info" ${dis}><span>请补充资料</span></button>`,
      html`<button class="btn btn--ghost btn--red" data-act="review" data-v="reject" ${dis}><span>婉拒</span></button>`,
    ] : [],
  };
}

/* ---------- invitations ---------- */
const INV_ST = { issued: ['amber', 'Issued', '待领取'], claimed: ['green', 'Claimed', '已领取'], expired: ['grey', 'Expired', '已过期'], disabled: ['grey', 'Disabled', '已停用'] };
const inviteLink = t => `${location.origin}${location.pathname.replace(/admin\/(index\.html)?$/, '')}app/#/invite/${t}`;
function viewInvites(list) {
  const inv = S.ui.lastInvite;
  return html`<div class="grid g-12">
    <div class="grid">
      ${card('签发邀请函', 'New invitation', html`<form data-form="invite" autocomplete="off">
        <label class="f"><span>写给谁 <i>会出现在邀请函上</i></span><input class="inp" name="note" maxlength="60" placeholder="致 一位做机器人的朋友"></label>
        <label class="f"><span>绑定手机 <i>可选；绑定后只有这个号码能领取</i></span><input class="inp" name="phone" inputmode="tel" maxlength="11" placeholder="139 0000 0000"></label>
        <p class="err" data-err></p>
        <button class="btn btn--green" ${raw(isAdmin() ? '' : 'disabled')}>${icon('seal')}<span>签发 · 赠送 3 个月会员</span></button>
        ${isAdmin() ? '' : html`<p class="hint" style="margin-top:8px">签发邀请需要店长权限。</p>`}
      </form>`, { sub: '受邀人领取当天开始，赠送 3 个自然月会员，与付费会员权益相同；到期后主动续费，不自动扣款。' })}
      ${inv ? html`<div class="envelope"><svg><use href="#i-sealbig"/></svg><p class="envelope__k">sth.ventured · invitation</p><p class="envelope__t">${inv.token}</p><p class="envelope__p">${inv.note}${inv.bound_phone ? ` · 仅限 ${inv.bound_phone}` : ''} · 最晚 ${fmt.date(inv.claim_deadline)} 领取</p>
        <div class="envelope__link"><input class="inp" readonly value="${inviteLink(inv.token)}" aria-label="邀请链接"><button class="btn btn--ghost btn--sm" data-act="copy" data-v="${inviteLink(inv.token)}"><span>复制</span></button></div></div>` : ''}
    </div>
    ${card('全部邀请', `Invitations · ${list.length}`, html`<div class="tablewrap"><table class="table"><thead><tr><th>邀请码</th><th>写给</th><th>状态</th><th>领取人</th><th>最晚领取</th><th></th></tr></thead><tbody>
      ${list.map(i => { const st = INV_ST[i.status] || ['grey', i.status, i.status]; return html`<tr><td class="mono nowrap">${i.token}</td><td>${i.note}${i.bound_phone ? html`<br><span class="muted mono">仅限 ${i.bound_phone}</span>` : ''}</td><td><span class="stamp st-${st[0]}">${st[1]}<small>${st[2]}</small></span></td><td>${i.claimer ? who(i.claimer) : html`<span class="muted">—</span>`}</td><td class="mono nowrap">${fmt.date(i.claim_deadline)}</td><td class="num">${i.status === 'issued' && isAdmin() ? html`<button class="btn btn--ghost btn--sm" data-act="invite-disable" data-id="${i.id}"><span>停用</span></button>` : ''}</td></tr>`; })}
    </tbody></table></div>`)}
  </div>`;
}

/* ---------- members' hours ---------- */
function patternSVG(p) {
  const n = p.length;
  const c = 10;
  return html`<svg class="pattern" viewBox="0 0 ${n * c} ${n * c}" role="img" aria-label="今天的签到图案">${raw(p.map((row, y) => row.map((v, x) => (v ? `<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" fill="#201B16"/>` : '')).join('')).join(''))}</svg>`;
}
const MTG_ST = { submitted: ['red', '待处理'], accepted: ['green', '已确认'], counter_proposed: ['amber', '等会员确认调整'], user_accepted: ['green', '已确认'], rejected: ['grey', '未能安排'], user_declined: ['grey', '会员婉拒'], cancelled: ['grey', '已取消'] };
function meetingRow(m) {
  const st = MTG_ST[m.status] || ['grey', m.status];
  return html`<div class="mtg"><div class="mtg__h"><b>${m.user ? m.user.name : '—'}${m.user && m.user.member_no ? html` <span class="muted mono">No.${m.user.member_no}</span>` : ''}</b><span class="mono">${fmt.mdOf(m.date)} ${m.start}–${m.end} · ${m.party_size} 人</span><span class="stamp st-${st[0]}">${st[1]}</span></div>
    ${m.needs ? html`<p>需求：${m.needs}</p>` : ''}
    ${m.counter ? html`<p>门店提议：${m.counter.start}–${m.counter.end}${m.counter.note ? ` · ${m.counter.note}` : ''}</p>` : ''}
    ${m.reply ? html`<p>回复：${m.reply}</p>` : ''}
    ${m.status === 'submitted' ? html`<form data-form="meeting" data-id="${m.id}" autocomplete="off"><input class="inp inp--wide" name="note" maxlength="120" placeholder="回复（可选）" aria-label="回复"><button class="btn btn--green btn--sm" name="action" value="accept"><span>同意</span></button><button class="btn btn--ghost btn--red btn--sm" name="action" value="reject"><span>婉拒</span></button>
      <input class="inp" name="start" value="${m.start}" aria-label="建议开始时间"><input class="inp" name="end" value="${m.end}" aria-label="建议结束时间"><button class="btn btn--ghost btn--sm" name="action" value="counter"><span>提议调整</span></button></form>` : ''}
  </div>`;
}
function viewDay(d) {
  const pending = d.meetings.filter(m => m.status === 'submitted');
  const rest = d.meetings.filter(m => m.status !== 'submitted');
  return html`${d.mode !== 'day' ? html`<p class="lede">现在不是会员时间（10:00–19:00）。签到码只在白天有效；可以先看今天的码和会议安排。</p>` : html`<p class="lede">白天只对会员开放：读书、开放座谈、会面。会员扫门口的签到码签到，写上同行人数，<b>朋友不用注册</b>。多人会议需要留座、摆桌椅时提前申请，会议不能跨过 19:00。</p>`}
  <div class="grid g-12">
    <div class="grid">
      <div class="daysign"><p class="daysign__k">Members’ hours · 会员时间</p><p class="daysign__h">今日签到码</p>${patternSVG(d.pattern)}<p class="daysign__code">${d.code}</p><p class="daysign__p">${d.date.replaceAll('-', '.')} ${fmt.dowOf(d.date)} · 每天一换，像图书馆的日戳。打印出来贴在门口。</p>
        <div class="btns no-print"><button class="btn btn--ghost btn--sm" data-act="ci-reset">${icon('reset')}<span>换一个码</span></button><button class="btn btn--ghost btn--sm" data-act="print"><span>打印门牌</span></button></div></div>
      ${card('今日签到', `Check-ins · ${d.checkins.length} 位会员 · ${d.checkins.reduce((s, c) => s + 1 + c.companions, 0)} 人`, d.checkins.length ? html`<div class="minilist">${d.checkins.map(c => html`<div><span>${who(c.user)}<small>${fmt.time(c.at)}</small></span><span class="muted">+${c.companions} 位朋友</span></div>`)}</div>` : html`<p class="empty">今天还没有人签到。</p>`)}
    </div>
    <div class="grid">
      ${card('会议申请', `Meetings · ${pending.length} 待处理`, d.meetings.length ? html`${pending.map(meetingRow)}${rest.map(meetingRow)}` : html`<p class="empty">没有会议申请。</p>`, { sub: '同意、婉拒，或提议调整时间（会员确认后生效）。' })}
      ${card('开放座谈', 'Roundtables today', d.roundtables.length ? html`<div class="minilist">${d.roundtables.map(e => html`<div><span><b>${e.title}</b><small>${fmt.time(e.start_at)} · 主持 ${e.host}</small></span>${meter(e.taken, e.capacity)}</div>`)}</div>` : html`<p class="empty">今天没有排座谈。</p>`)}
    </div>
  </div>`;
}

/* ---------- programme ---------- */
function evcard(e) {
  const p = fmt.parts(e.start_at);
  const past = Date.parse(e.end_at) < serverNow();
  return html`<button class="evcard ${past ? 'evcard--past' : ''}" data-act="event" data-id="${e.id}">
    <span class="evcard__d"><span>${p.dowEn}</span><b>${p.d}</b><small>${p.mon}</small></span>
    <span class="evcard__t"><span>${EVENT_KINDS[e.kind].en} · ${EVENT_KINDS[e.kind].zh}</span><b>${e.title}</b><p>${fmt.time(e.start_at)}–${fmt.time(e.end_at)} · ${e.location}${e.host ? ` · ${e.host}` : ''}${e.attended ? ` · 到场 ${e.attended}` : ''}</p></span>
    ${meter(e.taken, e.capacity)}
    <span class="chips"><span class="tag tag--layer">L${e.layer}</span>${e.status !== 'published' ? html`<span class="tag tag--amber">${e.status === 'draft' ? '草稿' : '已取消'}</span>` : ''}${e.public_signup ? html`<span class="tag">公开报名</span>` : ''}</span>
  </button>`;
}
function viewEvents(list) {
  const now = serverNow();
  const f = S.ui.evFilter;
  const up = list.filter(e => Date.parse(e.end_at) >= now).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = list.filter(e => Date.parse(e.end_at) < now).sort((a, b) => b.start_at.localeCompare(a.start_at));
  const rows = f === 'upcoming' ? up : f === 'past' ? past : [...up, ...past];
  return html`<div class="toolbar"><div class="chips">${[['upcoming', '即将', up.length], ['past', '已结束', past.length], ['all', '全部', list.length]].map(([k, l, n]) => html`<button class="chip" aria-pressed="${String(f === k)}" data-act="ev-filter" data-v="${k}">${l}<em>${n}</em></button>`)}</div><span class="toolbar__sp"></span><button class="btn btn--green" data-act="event-new">${icon('plus')}<span>新建活动</span></button></div>
    <p class="lede">L1 活动只有会员能看到全文；非会员只看到标题和一句话（INV-11）。到场与讲者在报名名单里标记，会自动解锁对应的 L2 内容。</p>
    <div class="evlist">${rows.map(evcard)}</div>${rows.length ? '' : html`<p class="empty">没有活动。</p>`}`;
}
async function openEvent(id) {
  openDrawer('event', { id, regs: null });
  if (!id) return;
  try {
    const dr = S.drawer;
    dr.regs = await call('admin.event.registrations', { id });
    if (S.drawer === dr) renderDrawer();
  } catch (e) { handleError(e); }
}
function regRow(r) {
  const att = r.status === 'attended';
  return html`<div class="reg"><span><b>${r.user ? r.user.name : '—'}</b>${r.user && r.user.member_no ? html` <span class="muted mono">No.${r.user.member_no}</span>` : ''}<small>${REG_STATUS[r.status] || r.status}${r.hosted ? ' · 讲者' : ''}</small></span>
    <span class="btns"><button class="btn btn--sm ${att ? 'btn--green' : 'btn--ghost'}" data-act="reg-mark" data-id="${r.id}" data-status="${att ? 'registered' : 'attended'}"><span>${att ? '已到场 ✓' : '标记到场'}</span></button><button class="btn btn--sm ${r.hosted ? 'btn--green' : 'btn--ghost'}" data-act="reg-host" data-id="${r.id}" data-v="${r.hosted ? '0' : '1'}"><span>${r.hosted ? '讲者 ✓' : '标记讲者'}</span></button></span></div>`;
}
function drawerEvent({ id, regs }) {
  const e = id ? (S.data.events || []).find(x => x.id === id) : null;
  const v = e
    ? { kind: e.kind, title: e.title, en: e.en, date: hzDate(e.start_at), from: fmt.time(e.start_at), to: fmt.time(e.end_at), capacity: e.capacity, layer: e.layer, public_signup: e.public_signup, host: e.host, guests: e.guests, location: e.location, hook: (e.teaser && e.teaser.hook) || '', intro: e.intro, status: e.status }
    : { kind: 'panel', title: '', en: '', date: addDays(hzDate(serverNow()), 7), from: '15:00', to: '17:00', capacity: 20, layer: 1, public_signup: false, host: '', guests: '', location: '3F · library live', hook: '', intro: '', status: 'published' };
  const sel = b => raw(b ? 'selected' : '');
  return {
    label: e ? e.title : '新建活动',
    head: html`<p class="k">${e ? `${EVENT_KINDS[e.kind].en} · ${e.taken}/${e.capacity}` : 'New event · 新建'}</p><h2>${e ? e.title : '新建活动'}</h2>${e && e.en ? html`<p>${e.en}</p>` : ''}`,
    body: html`<form id="evform" data-form="event" autocomplete="off">
      <input type="hidden" name="id" value="${id || ''}">
      <div class="f-row"><label class="f"><span>类型</span><select class="sel" name="kind">${Object.entries(EVENT_KINDS).map(([k, x]) => html`<option value="${k}" ${sel(v.kind === k)}>${x.zh} · ${x.en}</option>`)}</select></label>
        <label class="f"><span>谁能看到</span><select class="sel" name="layer"><option value="1" ${sel(v.layer === 1)}>L1 · 会员</option><option value="0" ${sel(v.layer === 0)}>L0 · 所有人</option></select></label></div>
      <label class="f"><span>标题</span><input class="inp" name="title" maxlength="40" value="${v.title}" required></label>
      <label class="f"><span>英文标题 <i>可选</i></span><input class="inp" name="en" maxlength="60" value="${v.en}"></label>
      <div class="f-row f-row--3"><label class="f"><span>日期</span><input class="inp" type="date" name="date" value="${v.date}"></label><label class="f"><span>开始</span><input class="inp" type="time" name="from" value="${v.from}"></label><label class="f"><span>结束</span><input class="inp" type="time" name="to" value="${v.to}"></label></div>
      <div class="f-row"><label class="f"><span>名额</span><input class="inp" type="number" min="1" max="300" name="capacity" value="${v.capacity}"></label><label class="f"><span>地点</span><input class="inp" name="location" maxlength="30" value="${v.location}"></label></div>
      <div class="f-row"><label class="f"><span>主持 / 讲者</span><input class="inp" name="host" maxlength="20" value="${v.host}"></label><label class="f"><span>嘉宾 <i>可选</i></span><input class="inp" name="guests" maxlength="40" value="${v.guests}"></label></div>
      <label class="f"><span>一句话 <i>非会员只看到标题和这一句</i></span><input class="inp" name="hook" maxlength="40" value="${v.hook}"></label>
      <label class="f"><span>介绍</span><textarea class="ta" name="intro" maxlength="400">${v.intro}</textarea></label>
      <div class="f-row"><label class="f"><span>状态</span><select class="sel" name="status">${[['published', '发布'], ['draft', '草稿'], ['cancelled', '取消']].map(([k, l]) => html`<option value="${k}" ${sel(v.status === k)}>${l}</option>`)}</select></label>
        <label class="check" style="align-self:end;min-height:38px"><input type="checkbox" name="public_signup" ${raw(v.public_signup ? 'checked' : '')}> 非会员也可以报名</label></div>
      <p class="err" data-err></p>
    </form>
    ${id ? html`<div class="dsec" style="margin-top:20px"><div class="dsec__h"><b>报名</b><span>${regs ? `${regs.length} 人` : '…'}</span></div>
      ${regs ? (regs.length ? regs.map(regRow) : html`<p class="hint">还没有人报名。</p>`) : html`<p class="hint">…</p>`}
      <p class="hint" style="margin-top:8px">标记「到场」解锁现场回放（L2）；标记「讲者」解锁讲者名录（L2）。</p></div>` : ''}`,
    foot: [html`<button class="btn btn--green" data-act="event-save">${icon('check')}<span>${id ? '保存' : '发布'}</span></button>`, html`<button class="btn btn--ghost" data-act="drawer-close"><span>关闭</span></button>`],
  };
}
async function saveEvent() {
  const form = $('#evform');
  if (!form) return;
  const v = Object.fromEntries(new FormData(form));
  v.public_signup = form.public_signup.checked;
  try {
    const e = await call('admin.event.save', v);
    toast(v.id ? '活动已保存，会员端同步' : `「${e.title}」已发布`);
    if (S.page === 'events') await load(false);
    else S.data.events = await call('admin.events');
    S.drawer = { type: 'event', id: e.id, regs: await call('admin.event.registrations', { id: e.id }) };
    renderDrawer();
  } catch (err) {
    const el = $('[data-err]', form);
    if (el) el.textContent = err.message; else handleError(err);
  }
}

/* ---------- layers ---------- */
const L0 = [['今晚节目单', 'Playbill · 首页'], ['按区域订座', '平面图 · 非会员可订 3 天'], ['公开活动', 'L0 活动 · 可报名'], ['入会申请 · 邀请函', '尽调 · 赠送会员']];
function viewLayers(items) {
  S.content = items;
  const L = n => items.filter(c => c.layer === n);
  const lcard = c => html`<button class="lcard" data-act="layer" data-key="${c.key}"><em>${MODE_TXT[c.mode] || c.mode}</em><b>${c.teaser.title}</b><small>${ruleText(c.unlock_rule)} · ${c.unlocked.length} 人已解锁${c.locked_placeholder ? ' · 未解锁时显示锁' : ''}</small></button>`;
  return html`<p class="lede">同一家店，四层读者。<b>L0 图书馆</b>是所有人看到的；从 <b>L1</b> 开始是会员的机器层（ASCII 终端）；L2 靠到店、到场、分享解锁；L3 是彩蛋和店长授予。看不见的层不出现，接口也不返回正文。</p>
  <div class="strata">
    <div class="stratum s0"><div class="stratum__l"><b>L0</b><span>图书馆 · Library</span><small>所有人 · 非会员</small></div><div class="stratum__b">${L0.map(([t, s]) => html`<div class="lcard"><em>public</em><b>${t}</b><small>${s}</small></div>`)}</div></div>
    <div class="stratum s1"><div class="stratum__l"><b>L1</b><span>会员 · Terminal</span><small>会员身份即可见</small></div><div class="stratum__b">${L(1).map(lcard)}</div></div>
    <div class="stratum s2"><div class="stratum__l"><b>L2</b><span>解锁 · Earned</span><small>签到 · 到场 · 分享</small></div><div class="stratum__b">${L(2).map(lcard)}</div></div>
    <div class="stratum s3"><div class="stratum__l"><b>L3</b><span>隐藏 · Hidden</span><small>彩蛋与店长授予</small></div><div class="stratum__b">${L(3).map(lcard)}</div></div>
  </div>`;
}
async function openLayer(key) {
  openDrawer('layer', { key });
  const c = (S.content || []).find(x => x.key === key);
  if (c && c.unlock_rule && c.unlock_rule.type === 'staff_grant' && !S.members) {
    try { S.members = await call('admin.members'); if (S.drawer && S.drawer.key === key) renderDrawer(); } catch (e) { handleError(e); }
  }
}
function drawerLayer({ key }) {
  const c = (S.content || []).find(x => x.key === key);
  if (!c) return { label: key, head: html`<h2>${key}</h2>`, body: html`<p class="empty">…</p>` };
  const grant = c.unlock_rule && c.unlock_rule.type === 'staff_grant';
  const have = new Set(c.unlocked.map(u => u.user && u.user.id));
  const candidates = (S.members || []).filter(m => m.membership.active && !have.has(m.id));
  return {
    label: c.teaser.title,
    head: html`<p class="k">L${c.layer} · ${MODE_TXT[c.mode] || c.mode}</p><h2>${c.teaser.title}</h2><p>${c.teaser.hook}</p>`,
    body: html`<div class="dsec"><div class="dsec__h"><b>规则</b><span>Rule</span></div><dl class="kv"><dt>层级</dt><dd>L${c.layer}</dd><dt>解锁</dt><dd>${ruleText(c.unlock_rule)}</dd><dt>时段</dt><dd>${MODE_TXT[c.mode] || c.mode}</dd><dt>未解锁时</dt><dd>${c.layer === 1 ? '非会员只看到标题' : c.locked_placeholder ? '显示一把锁和解锁提示' : '完全不出现'}</dd></dl></div>
      ${c.layer > 1 ? html`<div class="dsec"><div class="dsec__h"><b>已解锁</b><span>${c.unlocked.length} 人</span></div>${c.unlocked.length ? html`<div class="minilist">${c.unlocked.map(u => html`<div><span>${who(u.user)}<small>${SOURCE[u.source] || u.source} · ${fmt.date(u.at)}</small></span>${isAdmin() ? html`<button class="btn btn--ghost btn--sm" data-act="revoke" data-id="${u.id}"><span>撤销</span></button>` : ''}</div>`)}</div>` : html`<p class="hint">还没有人解锁。</p>`}</div>` : ''}
      ${grant ? html`<div class="dsec"><div class="dsec__h"><b>授予</b><span>Grant</span></div>${S.members ? html`<form class="redeem" data-form="grant" data-key="${c.key}"><select class="sel" name="user" style="flex:1">${candidates.map(m => html`<option value="${m.id}">No.${m.member_no} · ${m.name}</option>`)}</select><button class="btn btn--green btn--sm" ${raw(isAdmin() && candidates.length ? '' : 'disabled')}><span>授予</span></button></form>${isAdmin() ? '' : html`<p class="hint">授予需要店长权限。</p>`}` : html`<p class="hint">…</p>`}</div>` : ''}`,
  };
}

/* ---------- ledger ---------- */
const PAY_KIND = { membership: '会员费', deposit: '订金', ticket: '门票' };
function viewLedger(d) {
  const t = d.totals;
  return html`<div class="kpis kpis--5">${[['会员费', 'Membership', t.membership], ['订金', 'Deposits', t.deposit], ['门票', 'Tickets', t.ticket], ['已退款', 'Refunded', t.refunded], ['订金已抵扣', 'Redeemed', t.redeemed]].map(([l, en, v]) => html`<div class="kpi"><span class="kpi__l">${l}<span>${en}</span></span><span class="kpi__v" style="font-size:24px">${yuan(v)}</span></div>`)}</div>
  <p class="lede">演示用的模拟支付通道（provider = mock）：付款即到账，退款约 20 秒后到账。会员费不退，用户自助取消与撤回都没有开放（Q-10 / Q-13 / Q-16，老板拍板前保持关闭）。</p>
  <div class="grid g-21">
    ${card('收款', `Payments · ${d.payments.length}`, html`<div class="tablewrap"><table class="table"><thead><tr><th>时间</th><th>类型</th><th>客人</th><th>订单</th><th class="num">金额</th></tr></thead><tbody>
      ${d.payments.map(p => html`<tr><td class="mono nowrap">${fmt.md(p.paid_at)} ${fmt.time(p.paid_at)}</td><td>${PAY_KIND[p.kind] || p.kind}</td><td>${who(p.user)}</td><td class="mono">${p.booking_code || '—'}</td><td class="num mono">${yuan(p.amount)}</td></tr>`)}
    </tbody></table></div>`)}
    <div class="grid">
      ${card('退款', `Refunds · ${d.refunds.length}`, d.refunds.length ? html`<div class="minilist">${d.refunds.map(r => html`<div><span>${who(r.user)}<small>${REFUND_REASON[r.reason] || r.reason} · ${fmt.rel(r.created_at, serverNow())}</small></span><span style="text-align:right"><span class="num">${yuan(r.amount)}</span><br><span class="stamp st-${r.status === 'succeeded' ? 'green' : 'amber'}">${r.status === 'succeeded' ? '已到账' : '处理中'}</span></span></div>`)}</div>` : html`<p class="empty">没有退款。</p>`)}
      ${card('订金抵扣', `Redemptions · ${d.redemptions.length}`, d.redemptions.length ? html`<div class="minilist">${d.redemptions.map(r => html`<div><span><span class="mono">${r.booking_code}</span><small>${r.bill_note || '—'} · ${staffName(r.staff_id)} · ${fmt.time(r.at)}</small></span><span class="num">${yuan(r.amount)}</span></div>`)}</div>` : html`<p class="empty">还没有抵扣。</p>`)}
    </div>
  </div>`;
}

/* ---------- audit: the machine underneath, printed on green-bar paper ---------- */
function stampTime(t) {
  const x = hz(t);
  return `${pad(x.m)}-${pad(x.d)} ${pad(x.h)}:${pad(x.mi)}:${pad(new Date(t).getUTCSeconds())}`;
}
function viewAudit(list) {
  const types = [...new Set(list.map(a => a.object_type))];
  const f = S.ui.auditFilter;
  const rows = list.filter(a => !f || a.object_type === f);
  return html`<div class="toolbar"><div class="chips"><button class="chip" aria-pressed="${String(!f)}" data-act="audit-filter" data-v="">all<em>${list.length}</em></button>${types.map(t => html`<button class="chip" aria-pressed="${String(f === t)}" data-act="audit-filter" data-v="${t}">${t}<em>${list.filter(a => a.object_type === t).length}</em></button>`)}</div></div>
  <div class="printout"><ol><li class="is-head"><span>DATE TIME</span><span>ACTOR</span><span>ACTION</span><span>OBJECT · DETAIL</span></li>
    ${rows.map(a => html`<li title="${ACTION[a.action] || a.action}"><span>${stampTime(a.at)}</span><span>${a.actor_name}</span><span>${a.action}</span><span>${a.object_type}:${a.object_id}${a.after ? ` -> ${a.after}` : ''}${a.reason ? ` # ${a.reason}` : ''}</span></li>`)}
  </ol></div>`;
}

/* ---------- rules & settings ---------- */
const CFG_EDIT = [
  ['lockMinutes', '支付锁定', '下单后桌位锁定、等待支付', 'min'], ['confirmMinutes', '门店确认时限', '超时自动关闭，原路退款', 'min'],
  ['windowMember', '会员可订', '提前预订天数', 'day'], ['windowGuest', '非会员可订', '提前预订天数', 'day'],
  ['ticketPrice', '门票', '非会员散座，每人，含一杯特调', 'fen'], ['memberPrice', '会员月费', '首月与续费', 'fen'],
  ['prices.S.member', 'S 档低消 · 会员', '舞台前圆卡座', 'fen'], ['prices.S.guest', 'S 档低消 · 非会员', '舞台前圆卡座', 'fen'],
  ['prices.A.member', 'A 档低消 · 会员', '墙边卡座', 'fen'], ['prices.A.guest', 'A 档低消 · 非会员', '墙边卡座', 'fen'],
  ['prices.B.member', 'B 档低消 · 会员', '沙龙沙发', 'fen'], ['prices.B.guest', 'B 档低消 · 非会员', '沙龙沙发', 'fen'],
];
const UNIT = { min: '分钟', day: '天', fen: '元' };
const LOCKED_TXT = { userWithdrawEnabled: ['会员自助撤回订单', '待门店确认时，用户能否自己撤回'], userCancelPolicy: ['用户取消政策', '已确认订单能否取消、退多少'], membershipRefund: ['会员费退款', '会员费是否可退'] };
const CLOCKS = [['real', '现在'], ['14:00', '14:00 白天'], ['18:58', '18:58'], ['19:02', '19:02 入夜'], ['21:40', '21:40 留位截止后'], ['23:10', '23:10'], ['+10', '+10 分'], ['+31', '+31 分']];
function viewSettings(d) {
  const c = d.config;
  const get = k => k.split('.').reduce((o, p) => (o ? o[p] : undefined), c);
  const dis = raw(isAdmin() ? '' : 'disabled');
  const fixed = [
    ['日夜切换', '19:00 释放会员预留卡座', c.switchAt], ['会员时间', '白天只对会员开放', `${c.dayOpenAt}–${c.switchAt}`], ['打烊', '', c.nightCloseAt],
    ['线上停订', '之后请到现场', c.onlineCutoff], ['留位截止', '之后可释放未到店的桌位', c.holdDeadline], ['订金比例', '低消的 30%，抵当晚消费', `${Math.round(c.depositRatio * 100)}%`],
    ['门票上限', `每人每场 ${c.ticketLimit} 张：购票人 + ${c.ticketCompanions} 位同行`, c.ticketLimit], ['每人每场最多', '桌', c.maxResources],
    ['每晚会员预留', '张卡座（B05 · B06）', c.reservedCount], ['邀请赠送', '个自然月', c.giftMonths], ['邀请最晚领取', '', c.giftClaimDeadline], ['到期免审续费', '天内', c.renewWithoutReviewDays],
  ];
  return html`<div class="grid g-2">
    <div class="grid">
      ${card('可调整的规则', 'Adjustable · 店长', html`<div class="rules">${CFG_EDIT.map(([k, l, s, u]) => { const v = get(k); return html`<div class="rule"><span><b>${l}</b><small>${s}</small><span class="mono">${k}</span></span><form data-form="config" data-key="${k}" data-unit="${u}"><input class="inp" name="value" inputmode="numeric" value="${u === 'fen' ? v / 100 : v}" aria-label="${l}（${UNIT[u]}）" ${dis}><button class="btn btn--ghost btn--sm" ${dis}><span>${UNIT[u]} · 保存</span></button></form></div>`; })}
        <div class="rule"><span><b>非会员门票销售</b><small>关闭后非会员不能买散座门票</small><span class="mono">ticketSalesEnabled</span></span><span class="seg">${[['1', '开'], ['0', '关']].map(([v, l]) => html`<button aria-pressed="${String(!!c.ticketSalesEnabled === (v === '1'))}" data-act="cfg-toggle" data-key="ticketSalesEnabled" data-v="${v}" ${dis}>${l}</button>`)}</span></div>
      </div>${isAdmin() ? '' : html`<p class="hint" style="margin-top:8px">修改规则需要店长权限。</p>`}`, { sub: '改动立即生效，会员端同步；已下的订单按下单时的规则快照处理。' })}
      ${card('禁止自定', 'Locked until the owner decides', html`<div class="rules">${Object.entries(d.locked).map(([k, q]) => html`<div class="rule is-locked"><span><b>${(LOCKED_TXT[k] || [k])[0]}</b><small>${(LOCKED_TXT[k] || ['', ''])[1]}</small><span class="mono">${k} = ${String(c[k])}</span></span><span class="rule__v">${icon('lock')}${q} · 老板拍板前不能打开</span></div>`)}</div>`)}
    </div>
    <div class="grid">
      ${card('固定规则', 'Fixed in v0.3', html`<div class="rules">${fixed.map(([l, s, v]) => html`<div class="rule"><span><b>${l}</b>${s ? html`<small>${s}</small>` : ''}</span><span class="rule__v">${v}</span></div>`)}</div>`)}
      ${card('场次', `Sessions · ${d.sessions.length}`, html`<div class="tablewrap"><table class="table"><thead><tr><th>日期</th><th>节目</th><th>线上预订</th><th>确认方式</th></tr></thead><tbody>${d.sessions.map(s => html`<tr><td class="nowrap">${fmt.mdOf(s.date)} ${fmt.dowOf(s.date)}</td><td>${s.title}<br><span class="muted">${s.performers}</span></td>
        <td><span class="seg">${[['on_sale', '开售'], ['paused', '暂停']].map(([v, l]) => html`<button aria-pressed="${String(s.status === v)}" data-act="session" data-id="${s.id}" data-k="status" data-v="${v}">${l}</button>`)}</span></td>
        <td><span class="seg">${[['tiered', '分级'], ['all_manual', '全人工']].map(([v, l]) => html`<button aria-pressed="${String(s.confirm_policy === v)}" data-act="session" data-id="${s.id}" data-k="confirm_policy" data-v="${v}">${l}</button>`)}</span></td></tr>`)}</tbody></table></div>`)}
      ${card('演示', 'Demo controls', html`<p class="hint" style="margin-bottom:10px">演示时钟全站同步：会员端、后台一起跳到这个时间。19:00 一到，会员预留卡座的火漆在会员端裂开。</p>
        <div class="chips">${CLOCKS.map(([k, l]) => html`<button class="chip" data-act="clock" data-v="${k}">${l}</button>`)}</div>
        <div class="btns" style="margin-top:16px"><a class="btn btn--ghost btn--sm" href="../app/" target="_blank" rel="noopener">${icon('ext')}<span>打开会员端</span></a><button class="btn btn--ghost btn--red btn--sm" data-act="reset" ${dis}>${icon('reset')}<span>重置演示数据</span></button></div>`)}
    </div>
  </div>`;
}

/* ---------- drawer ---------- */
const DRAWERS = { booking: drawerBooking, confirm: drawerConfirm, reject: drawerReject, table: drawerTable, member: drawerMember, app: drawerApp, event: drawerEvent, layer: drawerLayer };
function openDrawer(type, props = {}) {
  S.drawer = { type, ...props };
  renderDrawer();
  markSel();
  requestAnimationFrame(() => requestAnimationFrame(() => drawerEl.classList.add('is-open')));
}
function renderDrawer() {
  if (!S.drawer) return;
  const prev = $('.drawer__b', drawerEl);
  const keep = prev ? prev.scrollTop : 0;
  const v = DRAWERS[S.drawer.type](S.drawer);
  const foot = [].concat(v.foot || []).filter(Boolean);
  drawerEl.innerHTML = html`<div class="scrim" data-act="drawer-close"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${v.label}">
      <header class="drawer__h"><div>${v.head}</div><button class="icon-btn" data-act="drawer-close" aria-label="关闭">${icon('close')}</button></header>
      <div class="drawer__b">${v.body}</div>
      ${foot.length ? html`<footer class="drawer__f">${foot}</footer>` : ''}
    </aside>`.s;
  const b = $('.drawer__b', drawerEl);
  if (b) b.scrollTop = keep;
  tick();
}
function closeDrawer() {
  drawerEl.classList.remove('is-open');
  S.drawer = null;
  markSel();
  setTimeout(() => { if (!S.drawer) drawerEl.innerHTML = ''; }, 420);
}
async function refreshDrawer() {
  const d = S.drawer;
  if (!d) return;
  try {
    if (d.type === 'booking') remember(await call('admin.bookings', {}));
    if (d.type === 'confirm' || d.type === 'reject') {
      const b = S.cache.get(d.id);
      d.board = await call('admin.board', { session_id: b ? b.session.id : undefined });
      remember(d.board.bookings);
    }
    if (d.type === 'member') d.data = await call('admin.member', { id: d.id });
    if (d.type === 'app' && S.page !== 'applications') S.data.applications = await call('admin.applications');
    if (d.type === 'table' && S.page !== 'board') S.data.board = await loadBoard();
    if (d.type === 'event' && d.id) d.regs = await call('admin.event.registrations', { id: d.id });
    if (d.type === 'layer') { S.content = await call('admin.content'); if (S.members) S.members = await call('admin.members'); }
    if (S.drawer === d) renderDrawer();
  } catch (e) { handleError(e); }
}

/* ---------- actions ---------- */
async function busy(el, fn) {
  el?.classList.add('is-busy');
  try { return await fn(); } finally { el?.classList.remove('is-busy'); }
}
function handleError(e, errEl) {
  if (e && e.code === 'auth') {
    auth.clear();
    S.staff = null;
    toast('请重新登录', 'error');
    entrance();
    return;
  }
  const msg = (e && e.message) || '出了点问题';
  const text = e && e.rule ? `${msg}（${e.rule}）` : msg;
  if (errEl) errEl.textContent = text;
  else toast(text, 'error');
}
async function act(method, args, okMsg) {
  try {
    const r = await call(method, args);
    if (okMsg) toast(okMsg);
    await load(false);
    loadBadges();
    return r || {};
  } catch (e) { handleError(e); return null; }
}

const ACTIONS = {
  'pick-staff': d => { S.ui.loginStaff = d.id; $$('.staffpick button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === d.id))); $('.pin input')?.focus(); },
  menu: () => shellEl.classList.toggle('is-menu'),
  logout: () => {
    if (!confirm('退出后台？')) return;
    call('auth.logout').catch(() => {});
    auth.clear();
    S.staff = null;
    S.page = null;
    entrance();
  },
  reset: (d, el) => busy(el, async () => {
    if (!confirm('把所有演示数据恢复到初始状态？会员端也会一起重置。')) return;
    S.cache.clear();
    S.ui.vresult = null;
    S.ui.lastInvite = null;
    S.members = null;
    await act('admin.reset', {}, '演示数据已重置');
  }),
  clock: async d => {
    const v = d.v;
    const args = v === 'real' ? { action: 'real' } : v.startsWith('+') ? { action: 'plus', minutes: Number(v.slice(1)) } : { action: 'set', hhmm: v };
    try {
      const r = await call('demo.clock', args);
      toast(`演示时钟 → ${fmt.md(r.now)} ${fmt.dow(r.now)} ${fmt.time(r.now)} · ${MODE_ZH[r.mode]}`);
      await syncClock();
      await load(false);
      loadBadges();
    } catch (e) { handleError(e); }
  },
  booking: d => openDrawer('booking', { id: d.id }),
  confirm: d => openConfirm(d.id),
  reject: d => openReject(d.id),
  'pick-table': d => {
    const dr = S.drawer;
    const b = dr && S.cache.get(dr.id);
    if (!b) return;
    const i = dr.pick.indexOf(d.code);
    if (i >= 0) dr.pick.splice(i, 1);
    else if (dr.pick.length < b.units) dr.pick.push(d.code);
    else dr.pick = [...dr.pick.slice(1), d.code];
    renderDrawer();
  },
  'confirm-go': (d, el) => busy(el, async () => {
    const dr = S.drawer;
    const b = dr && S.cache.get(dr.id);
    if (!b) return;
    try {
      const r = await call('admin.booking.confirm', { id: b.id, codes: b.kind === 'booth' ? dr.pick : undefined });
      remember([r]);
      toast(`已交割 · ${r.code} · ${r.lines.map(l => l.code).join('、')}，客人已收到通知`);
      closeDrawer();
      await load(false);
      loadBadges();
    } catch (e) { handleError(e); }
  }),
  'reject-go': (d, el) => busy(el, async () => {
    const form = $('#rjform');
    const dr = S.drawer;
    if (!form || !dr) return;
    const fd = new FormData(form);
    try {
      const r = await call('admin.booking.reject', { id: dr.id, reason: fd.get('reason'), suggestion: fd.get('suggestion'), suggestion_zone: fd.get('suggestion_zone') });
      remember([r]);
      toast(`已婉拒 ${r.code}${r.refund ? `，${yuan(r.refund.amount)} 原路退回` : ''}`);
      closeDrawer();
      await load(false);
      loadBadges();
    } catch (e) { handleError(e); }
  }),
  'rj-quick': d => { const ta = $('#rjform textarea[name="reason"]'); if (ta) { ta.value = `${d.v}，抱歉。`; ta.focus(); } },
  release: (d, el) => busy(el, async () => {
    if (!confirm('释放这笔订单的桌位？订金今晚仍可抵扣。')) return;
    const r = await act('admin.booking.release', { id: d.id }, '桌位已释放，客人已收到通知');
    if (r && r.id) { remember([r]); renderDrawer(); }
  }),
  admit: (d, el) => busy(el, () => verifyCode(d.code)),
  'fill-code': d => { S.ui.vcode = d.code; const inp = $('#codein input'); if (inp) { inp.value = d.code; inp.focus(); } },
  drink: (d, el) => busy(el, async () => {
    try { await call('admin.ticket.drink', { booking_id: d.id }); toast('赠饮已兑换'); await reverify(); } catch (e) { handleError(e); }
  }),
  'board-date': d => { S.ui.boardSession = d.id; if (S.drawer && S.drawer.type === 'table') closeDrawer(); load(false); },
  session: (d, el) => busy(el, () => act('admin.session.update', { id: d.id, [d.k]: d.v }, d.k === 'status' ? (d.v === 'paused' ? '这一场已暂停线上预订' : '这一场恢复开售') : (d.v === 'all_manual' ? '这一场改为全部人工确认' : '这一场改为分级确认'))),
  table: d => openDrawer('table', { code: d.id }),
  'table-pause': (d, el) => busy(el, async () => {
    const r = await act('admin.table.pause', { session_id: S.ui.boardSession, code: d.code, paused: d.v === '1' }, d.v === '1' ? `${d.code} 已暂停` : `${d.code} 已恢复`);
    if (r && r.warning) toast(r.warning, 'error');
    renderDrawer();
  }),
  'hold-release': (d, el) => busy(el, async () => { await act('admin.hold.release', { id: d.id }, '线下占桌已释放'); renderDrawer(); }),
  'bk-filter': d => { S.ui.bkStatus = d.v; renderPage(); },
  member: d => openMember(d.id),
  'mem-filter': d => { S.ui.memFilter = d.v; renderPage(); },
  revoke: (d, el) => busy(el, async () => {
    if (!confirm('撤销这条解锁？会员端会立刻看不到这一项。')) return;
    await act('admin.unlock.revoke', { id: d.id }, '已撤销');
    refreshDrawer();
  }),
  app: d => openDrawer('app', { id: d.id }),
  review: (d, el) => busy(el, async () => {
    const note = $('#appnote') ? $('#appnote').value : '';
    if (d.v === 'reject' && !confirm('婉拒这份申请？申请人会收到通知。')) return;
    const r = await act('admin.application.review', { id: S.drawer.id, action: d.v, note }, ({ approve: '已通过，申请人可以付款入会', need_info: '已请申请人补充资料', reject: '已婉拒，申请人会收到通知' })[d.v]);
    if (r) { S.data.applications = await call('admin.applications'); renderDrawer(); }
  }),
  'invite-disable': (d, el) => busy(el, async () => { if (!confirm('停用这张邀请函？')) return; await act('admin.invite.disable', { id: d.id }, '邀请已停用'); }),
  copy: async d => { try { await navigator.clipboard.writeText(d.v); toast('已复制'); } catch { toast(d.v); } },
  'ci-reset': (d, el) => busy(el, async () => { if (!confirm('换一个今天的签到码？门口旧的码会失效。')) return; await act('admin.checkin.reset', {}, '签到码已更换'); }),
  print: () => print(),
  'ev-filter': d => { S.ui.evFilter = d.v; renderPage(); },
  'event-new': () => openEvent(null),
  event: d => openEvent(d.id),
  'event-save': (d, el) => busy(el, saveEvent),
  'reg-mark': (d, el) => busy(el, async () => { await act('admin.registration.mark', { id: d.id, status: d.status }, d.status === 'attended' ? '已标记到场 · 解锁现场回放' : '已取消到场标记'); refreshDrawer(); }),
  'reg-host': (d, el) => busy(el, async () => { await act('admin.registration.mark', { id: d.id, hosted: d.v === '1' }, d.v === '1' ? '已标记讲者 · 解锁讲者名录' : '已取消讲者标记'); refreshDrawer(); }),
  layer: d => openLayer(d.key),
  'audit-filter': d => { S.ui.auditFilter = d.v; renderPage(); },
  'cfg-toggle': (d, el) => busy(el, () => act('admin.config.set', { key: d.key, value: d.v === '1' }, '规则已更新，会员端同步')),
  'drawer-close': () => closeDrawer(),
};

const FORMS = {
  login: async (form, fd) => {
    const err = $('[data-err]', form);
    err.textContent = '';
    await busy(form.querySelector('button:not([type])'), async () => {
      try {
        const r = await call('admin.login', { staffId: S.ui.loginStaff, pin: fd.get('pin') });
        auth.set(r.token);
        S.staff = r.staff;
        renderShell();
        S.page = null;
        route();
      } catch (e) { err.textContent = e.message; }
    });
  },
  verify: async form => {
    const err = $('[data-err]', form);
    err.textContent = '';
    const code = String(form.code.value || '').trim();
    if (!code) { err.textContent = '请输入订单凭证或会员码'; return; }
    await busy(form.querySelector('button:not([type])'), () => verifyCode(code));
  },
  redeem: (form, fd) => busy(form.querySelector('button'), async () => {
    try {
      const bv = await call('admin.deposit.redeem', { booking_id: form.dataset.id, amount: fd.get('amount'), note: fd.get('note') });
      remember([bv]);
      const r0 = S.ui.vresult;
      S.ui.vresult = { kind: 'booking', repeat: r0 ? r0.repeat : true, booking: bv };
      toast(`已抵扣 · 余 ${yuan(bv.deposit.left)}`);
      await load(false);
    } catch (e) { handleError(e); }
  }),
  hold: (form, fd) => busy(form.querySelector('button'), async () => {
    await act('admin.hold.create', { session_id: S.ui.boardSession, code: form.dataset.code, note: fd.get('note') }, `${form.dataset.code} 已线下占桌，会员端显示已订`);
    renderDrawer();
  }),
  grant: (form, fd) => busy(form.querySelector('button'), async () => {
    const args = form.dataset.user ? { user_id: form.dataset.user, key: fd.get('key') } : { user_id: fd.get('user'), key: form.dataset.key };
    await act('admin.unlock.grant', args, '已授予 · 会员端立即可见');
    refreshDrawer();
  }),
  invite: async (form, fd) => {
    const err = $('[data-err]', form);
    err.textContent = '';
    await busy(form.querySelector('button'), async () => {
      try {
        S.ui.lastInvite = await call('admin.invite.create', { note: fd.get('note'), phone: fd.get('phone') });
        toast(`邀请函 ${S.ui.lastInvite.token} 已签发`);
        await load(false);
      } catch (e) { err.textContent = e.message; }
    });
  },
  meeting: (form, fd, e) => {
    const action = e.submitter ? e.submitter.value : 'accept';
    return busy(e.submitter, () => act('admin.meeting.respond', { id: form.dataset.id, action, note: fd.get('note'), start: fd.get('start'), end: fd.get('end') }, ({ accept: '已同意，会员会收到通知', reject: '已婉拒', counter: '已提议调整，等会员确认' })[action]));
  },
  config: (form, fd) => {
    let v = String(fd.get('value')).trim();
    if (form.dataset.unit === 'fen') v = String(Math.round(Number(v) * 100));
    return busy(form.querySelector('button'), () => act('admin.config.set', { key: form.dataset.key, value: v }, '规则已更新，会员端同步'));
  },
  reject: () => ACTIONS['reject-go']({}, $('[data-act="reject-go"]')),
  event: () => saveEvent(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('[disabled]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('#')) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.drawer) closeDrawer();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act], [data-act][role="button"]:not(button)')) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form, new FormData(form), e);
});
const liveSearch = debounce(() => {
  const a = document.activeElement;
  const key = a && a.dataset && a.dataset.bind;
  const pos = a ? a.selectionStart : null;
  renderPage();
  if (key) { const again = $(`[data-bind="${key}"]`); if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); } }
}, 160);
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind) return;
  S.ui[el.dataset.bind] = el.value;
  if (el.dataset.live) liveSearch();
});

boot();
