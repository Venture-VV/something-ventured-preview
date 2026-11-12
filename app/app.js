/* =========================================================
   library live · member web app (MVP)
   Three things, done plainly: book a seat by zone, join a daytime
   roundtable, and accept a membership invitation.
   ========================================================= */
import { connect, call, auth, onChange } from '../shared/api.js';
import { html, raw, fmt, toast, debounce, initialOf } from '../shared/ui.js';
import { yuan, hz, hzDate, daysBetween } from '../shared/core.js';
import { zoneOf, planSVG } from '../shared/plan.js';

const $ = (s, el = document) => el.querySelector(s);
const viewEl = $('#view');
const tabbarEl = $('#tabbar');
const sheetEl = $('#sheet');
const icon = id => raw(`<svg aria-hidden="true"><use href="#i-${id}"/></svg>`);
const pad = n => String(n).padStart(2, '0');

const S = {
  me: null, skew: 0, route: '', id: '', query: {}, data: null, depth: 0, sheet: null,
  ui: { session: null, party: 2, note: '', quote: null, quoteErr: '', codeWait: 0, claimed: null, autoPay: null },
};
const serverNow = () => Date.now() + S.skew;
const user = () => S.me && S.me.user;
const isMember = () => S.me && S.me.identity === 'member_active';

/* ---------- dates, in plain Chinese ---------- */
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pdate = date => hz(Date.parse(`${date}T12:00:00+08:00`));
const md = date => { const x = pdate(date); return `${x.m}月${x.d}日`; };
const mdShort = date => { const x = pdate(date); return `${x.m}/${x.d}`; };
const wd = date => WD[pdate(date).dow];
const dayLabel = date => `${md(date)} ${wd(date)}`;
function relDay(date) {
  const d = daysBetween(hzDate(serverNow()), date);
  return d === -1 ? '今晚' : d === 0 ? '今天' : d === 1 ? '明天' : d === 2 ? '后天' : wd(date);
}
const dayHead = date => { const r = relDay(date); return r === wd(date) ? dayLabel(date) : `${r} · ${dayLabel(date)}`; };
const fullDate = t => { const x = hz(t); return `${x.y}年${x.m}月${x.d}日`; };
const left = t => { const ms = Math.max(0, Date.parse(t) - serverNow()); return `${pad(Math.floor(ms / 60e3))}:${pad(Math.floor((ms % 60e3) / 1e3))}`; };

/* ---------- order status, said the way a guest would say it ---------- */
const BADGE = {
  pending_payment: ['warn', '待支付'], pending_confirm: ['warn', '待确认'], confirmed: ['ok', '已确认'], fulfilled: ['brand', '已到店'],
  rejected: ['danger', '未接受'], confirm_timeout_closed: ['', '已关闭'], payment_expired: ['', '已取消'], cancelled: ['', '已取消'], no_show: ['', '未到店'],
};
const badge = s => { const [k, t] = BADGE[s] || ['', s]; return html`<span class="badge ${k ? `badge--${k}` : ''}">${t}</span>`; };

/* ---------- shared pieces ---------- */
const hero = (title, sub) => html`<header class="hero"><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</header>`;
const top = (title, back = 'book', right = '') => html`<header class="top"><button class="top__back" data-act="back" data-to="${back}" aria-label="返回">${icon('back')}</button><h1>${title}</h1>${right ? html`<div class="top__right">${right}</div>` : ''}</header>`;
const loginHref = next => `#/login?next=${encodeURIComponent(next)}`;

/* ---------- routes ---------- */
const ROUTES = {
  book: { tab: 'book', title: '订座', load: loadBook, view: viewBook },
  booking: { title: '填写预订', user: true, load: loadBooking, view: viewBooking, bar: true },
  order: { title: '订单详情', user: true, load: () => call('booking.get', { id: S.id }), view: viewOrder },
  orders: { title: '我的预订', user: true, load: () => call('bookings.mine'), view: viewOrders },
  talks: { tab: 'talks', title: '座谈', load: loadTalks, view: viewTalks },
  talk: { title: '座谈详情', load: () => call('event.get', { id: S.id }), view: viewTalk, bar: true },
  me: { tab: 'me', title: '我的', load: loadMe, view: viewMe },
  login: { title: '登录', view: viewLogin },
  invite: { title: '会员邀请', load: () => call('invite.view', { token: S.id }), view: viewInvite },
};

async function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  const def = ROUTES[name];
  if (!def) { location.replace('#/book'); return; }
  const changed = S.route !== name || S.id !== (id || '');
  S.route = name;
  S.id = id ? decodeURIComponent(id) : '';
  S.query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (def.user && !user()) { location.replace(loginHref(location.hash.replace(/^#\/?/, ''))); return; }
  if (changed) { S.data = null; closeSheet(); if (name !== 'invite') S.ui.claimed = null; }
  document.title = `${def.title} · library live`;
  await load(changed);
}

let seq = 0;
async function load(fresh) {
  const def = ROUTES[S.route];
  const n = ++seq;
  if (fresh) { tabs(def.tab); viewEl.className = 'view'; if (!def.load) S.data = {}; }
  try {
    const data = def.load ? await def.load() : {};
    if (n !== seq) return;
    S.data = data;
    render(fresh);
  } catch (e) {
    if (n !== seq) return;
    if (e.code === 'auth') { auth.clear(); await refreshMe(); location.replace(loginHref(location.hash.replace(/^#\/?/, ''))); return; }
    viewEl.innerHTML = html`${def.tab ? hero(def.title) : top(def.title)}<div class="empty">${e.message || '加载失败'}<br><button class="btn btn--secondary btn--sm" data-act="reload">重试</button></div>`.s;
  }
}

function render(fresh = false) {
  const def = ROUTES[S.route];
  if (!def || !S.data) return;
  const y = window.scrollY;
  viewEl.className = `view${def.tab ? '' : ' no-tabs'}${def.bar ? ' has-bar' : ''}`;
  viewEl.innerHTML = def.view(S.data).s;
  if (fresh) window.scrollTo(0, 0); else window.scrollTo(0, y);
  onScroll();
  tick();
  def.after?.();
}

function tabs(active) {
  tabbarEl.hidden = !active;
  if (!active) return;
  tabbarEl.innerHTML = [['book', '订座', 'seat'], ['talks', '座谈', 'talk'], ['me', '我的', 'me']]
    .map(([k, l, i]) => html`<a class="tab" href="#/${k}" ${raw(k === active ? 'aria-current="page"' : '')}>${icon(i)}<span>${l}</span></a>`.s).join('');
}

/* ---------- booking: pick a night and a zone ---------- */
async function loadBook() {
  const win = await call('sessions.window');
  const open = win.sessions.filter(s => s.status === 'on_sale' && !s.past_cutoff);
  if (!open.some(s => s.id === S.ui.session)) S.ui.session = open[0] ? open[0].id : null;
  const map = S.ui.session ? await call('session.map', { session_id: S.ui.session }) : null;
  return { win, map };
}
function zoneRow(z, map) {
  const info = zoneOf(z.id);
  const member = map.member_on_date;
  const booth = z.kind === 'booth';
  const noTickets = !booth && !member && !map.ticket_sales;
  const off = z.sealed || z.free <= 0 || noTickets;
  const tag = info.tags.find(t => !/人|会员预留/.test(t));
  const desc = booth ? `卡座，每桌最多 ${z.capacity} 人${tag ? ` · ${tag}` : ''}` : `${z.id === 'bar' ? '吧台座位' : `${z.capacity} 人桌`}，按人数订${tag ? ` · ${tag}` : ''}`;
  const price = booth
    ? html`低消 ${yuan(member ? z.price.min_member : z.price.min_guest)}/桌 · 订金 ${yuan(member ? z.price.deposit_member : z.price.deposit_guest)}`
    : member ? '会员免门票，到店点酒' : html`门票 ${yuan(map.ticket_price)}/人，含${map.ticket_drink}`;
  const state = z.sealed ? '19:00 开放' : noTickets ? '暂未开售' : z.free <= 0 ? '已订满' : booth ? `剩 ${z.free} 桌` : `剩 ${z.free} 座`;
  return html`<button class="zone ${off ? 'is-off' : ''}" data-act="zone" data-id="${z.id}" ${raw(off ? 'aria-disabled="true"' : '')}>
    <span class="zone__main"><span class="zone__name">${info.zh}</span><span class="zone__desc" style="display:block">${desc}</span><span class="zone__price" style="display:block">${price}</span>${z.sealed ? html`<span class="small" style="display:block;margin-top:2px">每晚为会员预留，19:00 后空着的开放给所有人</span>` : booth && !member ? html`<span class="small" style="display:block;margin-top:2px">会员低消 ${yuan(z.price.min_member)}/桌</span>` : ''}</span>
    <span class="zone__side"><span class="zone__left">${state}</span>${off ? '' : html`<svg class="row__chev" aria-hidden="true"><use href="#i-right"/></svg>`}</span>
  </button>`;
}
function viewBook({ win, map }) {
  const s = map && map.session;
  const dates = win.sessions.map(x => {
    const ok = x.status === 'on_sale' && !x.past_cutoff;
    const why = x.status === 'none' ? '无演出' : x.status !== 'on_sale' ? '暂停预订' : '已停止线上预订';
    return html`<button class="date" aria-pressed="${String(x.id === S.ui.session)}" data-act="date" data-id="${x.id || ''}" ${raw(ok ? '' : `disabled title="${why}"`)}><span>${relDay(x.date)}</span><b>${mdShort(x.date)}</b></button>`;
  });
  const tonightClosed = win.sessions[0] && win.sessions[0].past_cutoff;
  return html`${hero('订座', 'library live · 杭州武林路 9 号')}
    <div class="dates" aria-label="选择日期">${dates}</div>
    ${tonightClosed ? html`<p class="small" style="margin:8px 20px 0">今晚 21:30 后不再接受线上预订，可以直接到店。</p>` : ''}
    ${s ? html`<div class="show">${icon('clock')}<span>${dayLabel(s.date)} · ${s.show_start} 开场 · ${s.title}</span></div>` : ''}
    <section class="section">
      <div class="section__h"><h2>选择区域</h2>${map ? html`<button data-act="plan">看平面图</button>` : ''}</div>
      ${map ? html`<div class="list">${map.zones.map(z => zoneRow(z, map))}</div>` : html`<div class="list"><p class="empty">近期没有可以线上预订的场次。</p></div>`}
    </section>
    <ul class="rules">
      <li>${isMember() ? '会员可以预订 7 天内的场次。' : '非会员可以预订 3 天内的场次，会员 7 天。'}当晚 21:30 后请直接到店。</li>
      <li>卡座按桌付订金（低消的 30%），可抵当晚消费。门店会在 30 分钟内确认并安排桌号，未确认全额退款。</li>
      <li>散座和吧台按人数预订，付款后立即确认。</li>
      <li>订单确认后暂不支持在线取消，需要调整请联系门店。</li>
    </ul>`;
}

/* ---------- booking: how many people, then pay ---------- */
async function loadBooking() {
  const map = await call('session.map', { session_id: S.query.s });
  const z = map.zones.find(x => x.id === S.query.z);
  if (!z) throw new Error('这个区域不存在');
  const key = `${S.query.s}/${S.query.z}`;
  if (S.ui.bookingKey !== key) { S.ui.bookingKey = key; S.ui.party = z.kind === 'booth' ? Math.min(4, z.capacity) : 2; S.ui.note = ''; }
  S.ui.party = Math.min(S.ui.party, maxParty(z, map));
  await requote(true);
  return { map, z };
}
const maxParty = (z, map) => (z.kind === 'booth' ? z.capacity * 3 : map.member_on_date ? 8 : 4);
async function requote(silent = false) {
  try {
    S.ui.quote = await call('booking.quote', { session_id: S.query.s, zone: S.query.z, party_size: S.ui.party, note: S.ui.note, explanation: S.ui.note });
    S.ui.quoteErr = '';
  } catch (e) {
    S.ui.quote = null;
    S.ui.quoteErr = e.message;
  }
  if (!silent) renderQuote();
}
const requoteSoon = debounce(() => requote(), 300);
function quoteBlock() {
  if (S.ui.quoteErr) return html`<div class="note note--warn">${icon('alert')}<span>${S.ui.quoteErr}</span></div>`;
  const q = S.ui.quote;
  if (!q) return html`<div class="card"><p class="small">计算中…</p></div>`;
  const p = q.price;
  const lines = p.deposit_each
    ? html`<div><span>需要卡座</span><span>${q.units} 桌</span></div><div><span>订金 <small>低消 ${yuan(q.member ? p.min_member : p.min_guest)} 的 30%</small></span><span class="num">${yuan(p.deposit_each)} × ${q.units}</span></div>`
    : p.tickets ? html`<div><span>门票 <small>含${p.ticket_drink}</small></span><span class="num">${yuan(p.ticket_price)} × ${p.tickets}</span></div>`
      : html`<div><span>会员免门票</span><span>到店点酒即可</span></div>`;
  return html`<div class="card"><div class="price">${lines}<div class="total"><span>应付</span><span class="num">${yuan(p.total_due)}</span></div></div>
      ${p.deposit_each ? html`<p class="small" style="margin-top:8px">订金在当晚结账时抵扣消费。</p>` : ''}</div>
    <div class="note ${q.confirm_mode === 'manual' ? 'note--brand' : ''}" style="margin-top:12px">${icon('info')}<span>${q.confirm_mode === 'manual' ? '提交后，门店会在 30 分钟内确认并安排具体桌号。未确认会全额退款。' : '付款后立即确认，座位由系统安排。'}</span></div>
    ${q.warnings.map(w => html`<div class="note note--warn" style="margin-top:12px">${icon('alert')}<span>${w.text}</span></div>`)}`;
}
function barBlock() {
  const q = S.ui.quote;
  const total = q ? q.price.total_due : 0;
  return html`<div class="bar__sum"><small>应付</small><b class="num">${q ? yuan(total) : '—'}</b></div>
    <button class="btn" data-act="book-submit" ${raw(q ? '' : 'disabled')}>${q && total === 0 ? '确认预订' : '提交订单'}</button>`;
}
function renderQuote() {
  const a = $('#quote');
  const b = $('#bar');
  if (a) a.innerHTML = quoteBlock().s;
  if (b) b.innerHTML = barBlock().s;
}
function viewBooking({ map, z }) {
  const info = zoneOf(z.id);
  const s = map.session;
  const booth = z.kind === 'booth';
  const max = maxParty(z, map);
  const hint = booth ? `每桌最多 ${z.capacity} 人，人多会自动加桌` : map.member_on_date ? '会员和同行朋友都免门票' : '每人每场最多买 4 张门票';
  return html`${top('填写预订', 'book')}
    <section class="section"><div class="card">
      <p class="small">${dayHead(s.date)} · ${s.show_start} 开场</p>
      <h2 style="margin-top:4px;font-size:20px">${info.zh}</h2>
      <p class="small" style="margin-top:2px">${s.title}${s.performers ? ` · ${s.performers}` : ''}</p>
    </div></section>
    <section class="section"><div class="card">
      <div class="stepline"><div><b>人数</b><small>${hint}</small></div>
        <span class="stepper"><button type="button" data-act="party" data-d="-1" aria-label="减少" ${raw(S.ui.party <= 1 ? 'disabled' : '')}>${icon('minus')}</button><output aria-live="polite">${S.ui.party}</output><button type="button" data-act="party" data-d="1" aria-label="增加" ${raw(S.ui.party >= max ? 'disabled' : '')}>${icon('plus')}</button></span></div>
    </div></section>
    <section class="section">
      <label class="field"><span class="field__l">备注<small>选填</small></span><textarea class="textarea" data-bind="note" maxlength="120" placeholder="有特别需要可以写在这里，例如带了婴儿车">${S.ui.note}</textarea></label>
      <p class="small" style="margin-top:6px">写了备注的订单，需要门店确认后才算成功。</p>
    </section>
    <section class="section" id="quote">${quoteBlock()}</section>
    <div class="bar" id="bar">${barBlock()}</div>`;
}

/* ---------- order ---------- */
function orderStatus(b) {
  const refund = b.refund ? ` ${yuan(b.refund.amount)} ${b.refund.status === 'succeeded' ? '已退回原支付账户。' : '正在原路退回。'}` : '';
  switch (b.status) {
    case 'pending_payment': return ['warn', 'clock', '待支付', html`请在 <b class="cd" data-countdown="${b.lock_expires_at}">${left(b.lock_expires_at)}</b> 内完成支付，超时订单会自动取消。`];
    case 'pending_confirm': return ['warn', 'clock', '等待门店确认', html`门店会在 <b class="cd" data-countdown="${b.confirm_deadline_at}">${left(b.confirm_deadline_at)}</b> 内确认并安排桌号。如果没有确认，订金会全额退回。`];
    case 'confirmed': return ['ok', 'check', '预订成功', b.table_released ? '已过留位时间，桌位已释放。到店后前台会重新安排，订金今晚仍可抵扣。' : '到店时向前台出示下面的入场凭证。'];
    case 'fulfilled': return ['ok', 'check', '已到店', '欢迎光临。'];
    case 'rejected': return ['danger', 'alert', '门店没能接受这笔预订', `${b.reject_reason}${refund}`];
    case 'confirm_timeout_closed': return ['grey', 'info', '订单已关闭', `门店没有在时限内确认。${refund}`];
    case 'payment_expired': return ['grey', 'info', '订单已取消', '没有在时限内支付，订单已自动取消。'];
    case 'cancelled': return ['grey', 'info', '订单已取消', `付款晚于时限，桌位已被别人订走。${refund}`];
    case 'no_show': return ['grey', 'info', '未到店', '当晚没有到店，按规则订金不退。'];
    default: return ['grey', 'info', b.label ? b.label.zh : b.status, ''];
  }
}
function viewOrder(b) {
  const [tone, ic, title, text] = orderStatus(b);
  const info = zoneOf(b.zone);
  const s = b.session || {};
  const live = ['confirmed', 'fulfilled'].includes(b.status);
  const amount = !b.price.total_due ? '无需预付' : b.price.tickets ? `门票 ${yuan(b.price.total_due)}` : `订金 ${yuan(b.price.total_due)}`;
  const tables = b.lines.length ? b.lines.map(l => (b.kind === 'booth' ? `${l.code}（${l.name}）` : `${l.code} · ${l.seats} 座`)).join('、') : '门店确认时安排';
  return html`${top('订单详情', 'me')}
    <div class="status status--${tone}"><span class="status__icon">${icon(ic)}</span><div><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</div></div>
    ${live && b.status === 'confirmed' ? html`<section class="section" style="margin-top:0"><div class="card ticket"><small>入场凭证</small><b>${b.code}</b><small>${info.zh} · ${b.party_size} 人</small></div></section>` : ''}
    ${b.status === 'rejected' && b.suggestion ? html`<section class="section" style="margin-top:0"><div class="note note--brand">${icon('info')}<span>门店建议：${b.suggestion}</span></div>
      ${b.suggestion_zone && zoneOf(b.suggestion_zone) ? html`<a class="btn btn--secondary btn--block" style="margin-top:12px" href="#/booking?s=${s.id}&z=${b.suggestion_zone}">改订${zoneOf(b.suggestion_zone).zh}</a>` : ''}</section>` : ''}
    <section class="section"><div class="card"><dl class="kv">
      <dt>日期</dt><dd>${s.date ? dayLabel(s.date) : ''}</dd>
      <dt>演出</dt><dd>${s.show_start || ''} 开场 · ${s.title || ''}</dd>
      <dt>区域</dt><dd>${info.zh}</dd>
      <dt>桌号</dt><dd>${tables}</dd>
      <dt>人数</dt><dd>${b.party_size} 人</dd>
      <dt>金额</dt><dd>${amount}${b.payment && b.payment.status === 'paid' ? '（已支付）' : ''}</dd>
      ${b.note ? html`<dt>备注</dt><dd>${b.note}</dd>` : ''}
      <dt>订单号</dt><dd class="mono">${b.code}</dd>
      <dt>下单时间</dt><dd>${md(hzDate(b.created_at))} ${fmt.time(b.created_at)}</dd>
    </dl></div></section>
    ${['confirmed', 'pending_confirm'].includes(b.status) ? html`<p class="small" style="margin:14px 20px 0">订单确认后暂不支持在线取消，需要调整请联系门店。</p>` : ''}
    ${b.status === 'pending_payment' ? html`<div class="bar"><button class="btn btn--plain" data-act="abandon" data-id="${b.id}">取消订单</button><button class="btn btn--block" data-act="pay-open" data-id="${b.id}">去支付 ${yuan(b.price.total_due)}</button></div>` : ''}`;
}
ROUTES.order.after = () => {
  const b = S.data;
  viewEl.classList.toggle('has-bar', b && b.status === 'pending_payment');
  if (b && S.ui.autoPay === b.id && b.status === 'pending_payment') { S.ui.autoPay = null; openPay(b); }
};
function viewOrders(list) {
  return html`${top('我的预订', 'me')}
    <section class="section">${list.length ? html`<div class="list">${list.map(orderRow)}</div>` : html`<div class="list"><div class="empty">还没有预订<br><a class="btn btn--sm" href="#/book">去订座</a></div></div>`}</section>`;
}
const orderRow = b => html`<a class="row" href="#/order/${b.id}"><span class="row__main"><b>${b.session ? `${md(b.date)} ${wd(b.date)}` : md(b.date)} · ${zoneOf(b.zone).zh}</b><small>${b.party_size} 人 · ${b.code}</small></span>${badge(b.status)}<svg class="row__chev" aria-hidden="true"><use href="#i-right"/></svg></a>`;

/* ---------- roundtables ---------- */
async function loadTalks() {
  const list = await call('events.list');
  return list.filter(e => e.kind === 'roundtable' && Date.parse(e.end_at) > serverNow());
}
function talkRow(e) {
  const full = !e.locked && e.left <= 0 && !e.mine;
  return html`<a class="talk" href="#/talk/${e.id}">
    <span class="talk__time">${fmt.time(e.start_at)}<small>至 ${fmt.time(e.end_at)}</small></span>
    <span class="talk__main"><span class="talk__title" style="display:block">${e.title}</span><span class="talk__meta" style="display:block">${e.locked ? e.hook : `${e.host ? `主持 ${e.host} · ` : ''}已报 ${e.taken}/${e.capacity}`}</span></span>
    <span class="talk__side">${e.mine === 'registered' ? html`<span class="badge badge--ok">已报名</span>` : full ? html`<span class="badge">已满</span>` : ''}</span>
  </a>`;
}
function talksGate() {
  if (!user()) return html`<section class="section"><div class="note">${icon('info')}<span>座谈对会员开放。<a href="${loginHref('talks')}">登录</a>后查看详情和报名。</span></div></section>`;
  if (S.me.identity === 'invitee') return html`<section class="section"><div class="note note--brand">${icon('mail')}<span>你有一份会员邀请，领取后就可以报名座谈。<a href="#/invite/${S.me.invite.token}">去领取</a></span></div></section>`;
  if (!isMember()) return html`<section class="section"><div class="note">${icon('info')}<span>座谈对会员开放。会员目前仅限受邀加入。</span></div></section>`;
  return '';
}
function viewTalks(list) {
  const days = [...new Set(list.map(e => hzDate(e.start_at)))];
  return html`${hero('座谈', '白天 10:00–19:00 · 一张圆桌，一个话题')}
    ${talksGate()}
    ${days.length ? days.map(d => html`<p class="day-h">${dayHead(d)}</p><div class="list" style="margin:0 16px">${list.filter(e => hzDate(e.start_at) === d).map(talkRow)}</div>`)
      : html`<section class="section"><div class="list"><p class="empty">最近没有安排座谈。</p></div></section>`}`;
}
function talkBar(e) {
  if (!user()) return html`<a class="btn btn--block" href="${loginHref(`talk/${e.id}`)}">登录后报名</a>`;
  if (e.locked || !isMember()) {
    if (S.me.identity === 'invitee') return html`<a class="btn btn--block" href="#/invite/${S.me.invite.token}">领取会员邀请后报名</a>`;
    return html`<button class="btn btn--block btn--done" disabled>仅会员可以报名</button>`;
  }
  if (e.past || Date.parse(e.signup_close_at) < serverNow()) return html`<button class="btn btn--block btn--done" disabled>${e.mine === 'attended' ? '已参加' : '报名已截止'}</button>`;
  if (e.mine === 'registered') return html`<div class="bar__sum"><b style="font-size:16px">你已报名</b><small>到场时报手机号即可</small></div><button class="btn btn--danger" data-act="talk-cancel" data-id="${e.id}">取消报名</button>`;
  if (e.left <= 0) return html`<button class="btn btn--block btn--done" disabled>名额已满</button>`;
  return html`<button class="btn btn--block" data-act="talk-join" data-id="${e.id}">报名参加</button>`;
}
function viewTalk(e) {
  const d = hzDate(e.start_at);
  return html`${top('座谈详情', 'talks')}
    <section class="section detail" style="margin-top:12px"><div class="card">
      <h1>${e.title}</h1>
      <div class="facts">
        <div>${icon('clock')}<span>${dayHead(d)} ${fmt.time(e.start_at)}–${fmt.time(e.end_at)}</span></div>
        ${e.locked ? '' : html`<div>${icon('pin')}<span>${e.location}</span></div>
        ${e.host ? html`<div>${icon('user')}<span>主持 ${e.host}${e.guests ? ` · 嘉宾 ${e.guests}` : ''}</span></div>` : ''}
        <div>${icon('talk')}<span>${e.capacity} 个名额，已报名 ${e.taken} 人</span></div>`}
      </div>
    </div></section>
    <section class="section"><div class="card"><p class="prose">${e.locked ? `${e.hook}\n\n座谈的详细介绍只对会员显示。` : e.intro || e.hook}</p></div></section>
    <div class="bar">${talkBar(e)}</div>`;
}

/* ---------- me ---------- */
async function loadMe() {
  if (!user()) return {};
  const [orders, events] = await Promise.all([call('bookings.mine'), call('events.list')]);
  return { orders, talks: events.filter(e => e.kind === 'roundtable' && ['registered', 'attended'].includes(e.mine) && !e.past) };
}
function memberBlock() {
  const me = S.me;
  const ms = me.membership;
  if (me.identity === 'member_active') return html`<div class="member"><small>会员 No.${me.user.member_no}</small><b>有效期至 ${fullDate(ms.end_at)}</b><small>还剩 ${ms.days_left} 天${ms.source === 'gift' ? ' · 邀请赠送' : ''}</small></div>`;
  if (me.identity === 'invitee') return html`<div class="member member--off"><small>你有一份会员邀请</small><b>领取后成为会员</b><a class="btn btn--block" href="#/invite/${me.invite.token}">查看并领取</a></div>`;
  if (me.identity === 'member_expired') return html`<div class="member member--off"><small>会员已到期</small><b>${fullDate(ms.end_at)} 到期</b>
    ${ms.can_renew ? html`<button class="btn btn--block" data-act="renew">续费 ${yuan(me.member_price)} / 月</button>` : html`<small style="margin-top:6px">到期超过 30 天，请联系门店。</small>`}</div>`;
  return html`<div class="member member--off"><small>非会员</small><b>会员目前仅限受邀加入</b><small style="margin-top:4px">收到邀请链接后，点开即可领取。</small></div>`;
}
function viewMe(d) {
  const me = S.me;
  if (!me.user) {
    return html`${hero('我的')}<section class="section"><div class="card" style="text-align:center;padding:28px 20px">
      <div class="avatar" style="margin:0 auto">${icon('me')}</div><h2 style="margin-top:12px;font-size:18px">登录 library live</h2>
      <p class="small" style="margin-top:4px">登录后可以订座、报名座谈、领取会员邀请。</p>
      <a class="btn btn--block" style="margin-top:18px" href="${loginHref('me')}">登录 / 注册</a></div></section>
      <button class="demo-link" data-act="demo">演示工具</button>`;
  }
  const orders = d.orders || [];
  return html`${hero('我的')}
    <section class="section"><div class="card">
      <div class="profile"><span class="avatar">${initialOf(me.user.name || me.user.phone)}</span><div><h2>${me.user.name || '新用户'}</h2><p>${me.user.phone}${me.user.name ? '' : html` · <button class="link" data-act="set-name" style="padding:0">填写称呼</button>`}</p></div></div>
      ${memberBlock()}
    </div></section>
    <section class="section"><div class="section__h"><h2>我的预订</h2>${orders.length > 3 ? html`<a href="#/orders">全部</a>` : ''}</div>
      <div class="list">${orders.length ? orders.slice(0, 3).map(orderRow) : html`<div class="empty">还没有预订<br><a class="btn btn--sm" href="#/book">去订座</a></div>`}</div></section>
    <section class="section"><div class="section__h"><h2>我报名的座谈</h2></div>
      <div class="list">${d.talks && d.talks.length ? d.talks.map(e => html`<a class="row" href="#/talk/${e.id}"><span class="row__main"><b>${e.title}</b><small>${relDay(hzDate(e.start_at))} ${fmt.time(e.start_at)}–${fmt.time(e.end_at)}</small></span><svg class="row__chev" aria-hidden="true"><use href="#i-right"/></svg></a>`)
        : html`<div class="empty">还没有报名座谈<br><a class="btn btn--sm btn--secondary" href="#/talks">看看座谈</a></div>`}</div></section>
    <section class="section"><div class="list">
      <button class="row" data-act="install"><span class="row__main"><b>添加到手机桌面</b></span><svg class="row__chev" aria-hidden="true"><use href="#i-right"/></svg></button>
      <button class="row" data-act="logout"><span class="row__main"><b style="color:var(--danger)">退出登录</b></span></button>
    </div></section>
    <button class="demo-link" data-act="demo">演示工具</button>`;
}

/* ---------- login ---------- */
const PERSONAS = [['member', '会员 林知远'], ['non_member', '非会员 陈一'], ['invitee', '受邀人 向南'], ['expired', '会员已到期 唐晚']];
function viewLogin() {
  const wait = S.ui.codeWait > 0;
  return html`${top('登录', 'me')}
    <div class="login">
      <h2 style="font-size:24px;margin-top:8px">手机号登录</h2>
      <p class="small" style="margin-top:4px">没有账号的手机号，验证后会自动注册。</p>
      <form data-form="login" style="margin-top:24px" autocomplete="on">
        <label class="field"><span class="field__l">手机号</span><input class="input" name="phone" type="tel" inputmode="numeric" maxlength="13" autocomplete="tel" placeholder="请输入 11 位手机号" required></label>
        <label class="field"><span class="field__l">验证码</span><span class="input-row"><input class="input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="请输入验证码" required><button type="button" class="btn btn--secondary" data-act="send-code" ${raw(wait ? 'disabled' : '')}>${wait ? `${S.ui.codeWait} 秒` : '获取验证码'}</button></span></label>
        <p class="err" data-err></p>
        <button class="btn btn--block">登录</button>
      </form>
      <div class="demo-box"><p>演示环境：点下面的账号直接登录</p><div class="chips">${PERSONAS.map(([k, l]) => html`<button class="chip" data-act="persona" data-v="${k}">${l}</button>`)}</div></div>
    </div>`;
}

/* ---------- invitation ---------- */
function viewInvite(inv) {
  const me = S.me;
  if (S.ui.claimed) {
    return html`${top('会员邀请', 'book')}<div class="invite"><div class="done-mark">${icon('check')}</div><h1>你已成为会员</h1>
      <p class="invite__to">会员号 No.${S.ui.claimed.member_no} · 有效期至 ${fullDate(S.ui.claimed.end_at)}</p>
      <div class="btns" style="margin-top:22px"><a class="btn btn--block" href="#/book">去订座</a><a class="btn btn--secondary btn--block" href="#/talks">看看白天座谈</a></div></div>`;
  }
  let action;
  if (inv.status === 'claimed') action = inv.mine ? html`<a class="btn btn--block" href="#/book">你已领取，去订座</a>` : html`<button class="btn btn--block btn--done" disabled>这份邀请已经被领取</button>`;
  else if (inv.status === 'expired') action = html`<button class="btn btn--block btn--done" disabled>邀请已过期</button>`;
  else if (inv.status === 'disabled') action = html`<button class="btn btn--block btn--done" disabled>邀请已停用</button>`;
  else if (!me.user) action = html`<a class="btn btn--block" href="${loginHref(`invite/${inv.token}`)}">登录后领取</a>`;
  else if (me.identity === 'member_active') action = html`<button class="btn btn--block btn--done" disabled>你已经是会员了</button>`;
  else if (!inv.for_me) action = html`<button class="btn btn--block btn--done" disabled>这份邀请只能由指定手机号领取</button>`;
  else action = html`${me.user.name ? '' : html`<label class="field" style="text-align:left;margin-bottom:14px"><span class="field__l">你的称呼<small>门店接待时会用到</small></span><input class="input" id="claim-name" maxlength="20" placeholder="例如：王先生"></label>`}<button class="btn btn--block" data-act="claim" data-id="${inv.token}">领取会员</button><p class="err" data-err style="text-align:left"></p>`;
  return html`${top('会员邀请', 'book')}
    <div class="invite">
      <div class="invite__mark">${icon('mail')}</div>
      <h1>library live 邀请你成为会员</h1>
      ${inv.note ? html`<p class="invite__to">${inv.note}</p>` : ''}
      <ul class="perks">
        <li>${icon('check')}<span>免费体验 ${inv.months} 个月会员，从领取当天开始</span></li>
        <li>${icon('check')}<span>提前 7 天订座，卡座按会员低消，散座免门票</span></li>
        <li>${icon('check')}<span>白天 10:00–19:00 会员时间，可以报名开放座谈</span></li>
        <li>${icon('check')}<span>到期后可按月续费 ${yuan(me.member_price || 102400)}，不会自动扣款</span></li>
      </ul>
      <div style="margin-top:24px">${action}</div>
      <p class="small" style="margin-top:12px">请在 ${fullDate(inv.deadline)} 前领取 · 邀请码 <span class="mono">${inv.token}</span></p>
    </div>`;
}

/* ---------- sheets ---------- */
function openSheet(title, body) {
  S.sheet = { title, body };
  sheetEl.innerHTML = html`<div class="scrim" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet__h"><h2>${title}</h2><button class="sheet__x" data-act="sheet-close" aria-label="关闭">${icon('close')}</button></div><div class="sheet__b">${body}</div></div>`.s;
  requestAnimationFrame(() => requestAnimationFrame(() => sheetEl.classList.add('is-open')));
  tick();
}
function closeSheet() {
  if (!S.sheet) return;
  S.sheet = null;
  sheetEl.classList.remove('is-open');
  setTimeout(() => { if (!S.sheet) sheetEl.innerHTML = ''; }, 300);
}
function openPay(b) {
  openSheet('支付', html`<div class="pay"><small>library live · ${b.price.tickets ? '门票' : '订金'}</small><b>${yuan(b.price.total_due)}</b><small>请在 <span class="num" data-countdown="${b.lock_expires_at}">${left(b.lock_expires_at)}</span> 内完成支付</small></div>
    <div class="note" style="margin:16px 0">${icon('info')}<span>演示环境，不会真实扣款。正式版这里是微信支付。</span></div>
    <button class="btn btn--block" data-act="pay" data-id="${b.id}">确认支付</button>`);
}
function openDemo() {
  const clocks = [['real', '现在'], ['14:00', '14:00 白天'], ['18:58', '18:58'], ['19:02', '19:02 入夜'], ['+31', '快进 31 分钟']];
  openSheet('演示工具', html`<p class="small" style="margin-bottom:10px">切换身份</p><div class="chips">${PERSONAS.map(([k, l]) => html`<button class="chip" data-act="persona" data-v="${k}">${l}</button>`)}<button class="chip" data-act="logout-now">游客（退出）</button></div>
    <p class="small" style="margin:20px 0 10px">演示时钟（会员端和后台同步，只往前走）</p><div class="chips">${clocks.map(([k, l]) => html`<button class="chip" data-act="clock" data-v="${k}">${l}</button>`)}</div>
    <p class="small" style="margin-top:18px">后台地址：<a href="../admin/" target="_blank" rel="noopener">/admin/</a>，PIN 1215</p>`);
}
function openInstall() {
  const ua = navigator.userAgent;
  const steps = /MicroMessenger/i.test(ua) ? ['点右上角「···」', '选择「在浏览器打开」', '再按浏览器的方法添加到桌面']
    : /iPhone|iPad|iPod/i.test(ua) ? ['用 Safari 打开这个页面', '点底部的「分享」按钮', '选择「添加到主屏幕」']
      : ['点浏览器右上角的菜单', '选择「添加到主屏幕」或「安装应用」', '确认添加'];
  openSheet('添加到手机桌面', html`<ol style="margin:0;padding-left:20px;line-height:2">${steps.map(s => html`<li>${s}</li>`)}</ol><p class="small" style="margin-top:12px">添加后，从桌面图标打开就是全屏的 App。</p>`);
}

/* ---------- actions ---------- */
async function busy(el, fn) {
  if (el && el.classList.contains('is-busy')) return undefined;
  el?.classList.add('is-busy');
  try { return await fn(); } finally { el?.classList.remove('is-busy'); }
}
function fail(e) {
  if (e && e.code === 'auth') { auth.clear(); refreshMe().then(() => { location.hash = loginHref(location.hash.replace(/^#\/?/, '')); }); return; }
  toast((e && e.message) || '出了点问题，请重试', 'error');
}
async function refreshMe() {
  S.me = await call('me');
  S.skew = Date.parse(S.me.now) - Date.now();
}
async function afterLogin(token) {
  auth.set(token);
  await refreshMe();
  closeSheet();
  const next = S.route === 'login' ? (S.query.next || 'me') : S.route;
  if (S.route === 'login') location.replace(`#/${next}`);
  else { S.data = null; await load(true); }
}

const ACTIONS = {
  back: d => { if (S.depth > 0) history.back(); else location.hash = `#/${d.to}`; },
  reload: () => load(true),
  date: d => { S.ui.session = d.id; load(false); },
  plan: () => {
    const map = S.data && S.data.map;
    if (!map) return;
    openSheet('平面图', html`<div class="plan-wrap">${raw(planSVG({ states: map.states, layout: 'night' }))}</div><p class="small" style="margin-top:10px">点图上的区域可以直接预订。具体桌号由门店确认时安排。</p>`);
  },
  zone: d => {
    const map = S.data && S.data.map;
    const z = map && map.zones.find(x => x.id === d.id);
    if (!z) return;
    const booth = z.kind === 'booth';
    if (z.sealed) return toast('这两张卡座每晚为会员预留，19:00 后空着的会开放给所有人');
    if (!booth && !map.member_on_date && !map.ticket_sales) return toast('门票暂未开售，可以预订卡座');
    if (z.free <= 0) return toast('这个区域已经订满了，换一个区域或日期试试');
    closeSheet();
    const target = `booking?s=${map.session.id}&z=${z.id}`;
    location.hash = user() ? `#/${target}` : loginHref(target);
  },
  party: d => {
    const { z, map } = S.data;
    const n = Math.max(1, Math.min(maxParty(z, map), S.ui.party + Number(d.d)));
    if (n === S.ui.party) return;
    S.ui.party = n;
    const out = $('.stepper output');
    if (out) out.textContent = String(n);
    const [minus, plus] = document.querySelectorAll('.stepper button');
    if (minus) minus.disabled = n <= 1;
    if (plus) plus.disabled = n >= maxParty(z, map);
    S.ui.quote = null;
    renderQuote();
    requoteSoon();
  },
  'book-submit': (d, el) => busy(el, async () => {
    try {
      const b = await call('booking.create', { session_id: S.query.s, zone: S.query.z, party_size: S.ui.party, note: S.ui.note, explanation: S.ui.note });
      S.ui.bookingKey = null;
      if (b.status === 'pending_payment') S.ui.autoPay = b.id;
      else toast(b.status === 'confirmed' ? '预订成功' : '已提交，等待门店确认');
      location.replace(`#/order/${b.id}`);
    } catch (e) { S.ui.quoteErr = e.message; renderQuote(); fail(e); }
  }),
  'pay-open': () => { if (S.data && S.data.status === 'pending_payment') openPay(S.data); },
  pay: (d, el) => busy(el, async () => {
    try {
      const b = await call('booking.pay', { id: d.id });
      closeSheet();
      toast(b.status === 'confirmed' ? '支付成功，预订已确认' : '支付成功，等待门店确认');
      if (S.route === 'order') { S.data = b; render(); } else location.hash = `#/order/${b.id}`;
    } catch (e) { fail(e); }
  }),
  abandon: (d, el) => busy(el, async () => {
    if (!confirm('确定取消这笔订单吗？')) return;
    try { S.data = await call('booking.abandon', { id: d.id }); render(); toast('订单已取消'); } catch (e) { fail(e); }
  }),
  'talk-join': (d, el) => busy(el, async () => {
    try { S.data = await call('event.register', { id: d.id }); render(); toast('报名成功'); } catch (e) { fail(e); }
  }),
  'talk-cancel': (d, el) => busy(el, async () => {
    if (!confirm('确定取消报名吗？名额会让给其他会员。')) return;
    try { S.data = await call('event.cancel', { id: d.id }); render(); toast('已取消报名'); } catch (e) { fail(e); }
  }),
  claim: (d, el) => busy(el, async () => {
    const nameEl = $('#claim-name');
    if (nameEl) {
      const name = nameEl.value.trim();
      if (!name) { $('[data-err]').textContent = '请先填写你的称呼'; nameEl.focus(); return; }
      try { await call('profile.update', { name }); } catch (e) { fail(e); return; }
    }
    try {
      const r = await call('invite.claim', { token: d.id });
      await refreshMe();
      S.ui.claimed = { member_no: r.member_no || (S.me.user && S.me.user.member_no), end_at: r.end_at || (S.me.membership && S.me.membership.end_at) };
      render();
    } catch (e) { fail(e); }
  }),
  renew: (d, el) => busy(el, async () => {
    if (!confirm(`续费一个月，${yuan(S.me.member_price)}（演示环境不会真实扣款）？`)) return;
    try { const r = await call('membership.renew'); await refreshMe(); toast(`续费成功，有效期至 ${fullDate(r.end_at)}`); load(false); } catch (e) { fail(e); }
  }),
  'send-code': () => {
    const phone = String($('[name="phone"]').value || '').replace(/\D/g, '');
    const err = $('[data-err]');
    if (!/^1\d{10}$/.test(phone)) { err.textContent = '请先输入 11 位手机号'; return; }
    err.textContent = '';
    toast('验证码已发送（演示环境验证码：2026）');
    S.ui.codeWait = 60;
    const t = setInterval(() => {
      S.ui.codeWait -= 1;
      const btn = $('[data-act="send-code"]');
      if (btn) { btn.disabled = S.ui.codeWait > 0; btn.textContent = S.ui.codeWait > 0 ? `${S.ui.codeWait} 秒` : '重新获取'; }
      if (S.ui.codeWait <= 0) clearInterval(t);
    }, 1000);
    const btn = $('[data-act="send-code"]');
    if (btn) { btn.disabled = true; btn.textContent = '60 秒'; }
    $('[name="code"]')?.focus();
  },
  persona: (d, el) => busy(el, async () => {
    try { const r = await call('auth.demo', { as: d.v }); toast(`已切换为：${el.textContent.trim()}`); await afterLogin(r.token); } catch (e) { fail(e); }
  }),
  logout: () => {
    if (!confirm('确定退出登录吗？')) return;
    ACTIONS['logout-now']();
  },
  'logout-now': async () => {
    call('auth.logout').catch(() => {});
    auth.clear();
    await refreshMe();
    closeSheet();
    S.data = null;
    if (ROUTES[S.route].user) location.hash = '#/me'; else load(true);
  },
  clock: async d => {
    const v = d.v;
    const args = v === 'real' ? { action: 'real' } : v.startsWith('+') ? { action: 'plus', minutes: Number(v.slice(1)) } : { action: 'set', hhmm: v };
    try { const r = await call('demo.clock', args); await refreshMe(); toast(`演示时钟：${fmt.md(r.now)} ${fmt.time(r.now)}`); closeSheet(); S.data = null; load(true); } catch (e) { fail(e); }
  },
  demo: () => openDemo(),
  'set-name': () => openSheet('填写称呼', html`<form data-form="name"><label class="field"><span class="field__l">你的称呼<small>门店接待时会用到</small></span><input class="input" name="name" maxlength="20" placeholder="例如：王先生" required></label><p class="err" data-err></p><button class="btn btn--block" style="margin-top:8px">保存</button></form>`),
  install: () => openInstall(),
  'sheet-close': () => closeSheet(),
};
const FORMS = {
  name: (form, fd) => busy(form.querySelector('button'), async () => {
    try { await call('profile.update', { name: fd.get('name') }); await refreshMe(); closeSheet(); toast('已保存'); load(false); } catch (e) { $('[data-err]', form).textContent = e.message; }
  }),
  login: (form, fd) => busy(form.querySelector('button:not([type])'), async () => {
    const err = $('[data-err]', form);
    err.textContent = '';
    try {
      const r = await call('auth.login', { phone: String(fd.get('phone')).replace(/\D/g, ''), code: fd.get('code') });
      await afterLogin(r.token);
    } catch (e) { err.textContent = e.message; }
  }),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('[disabled]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-act][role="button"]:not(button)')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form, new FormData(form));
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.bind === 'note') { S.ui.note = el.value; requoteSoon(); }
});

/* countdowns: payment lock, store confirmation */
function tick() {
  const now = serverNow();
  document.querySelectorAll('[data-countdown]').forEach(el => {
    const ms = Math.max(0, Date.parse(el.dataset.countdown) - now);
    el.textContent = `${pad(Math.floor(ms / 60e3))}:${pad(Math.floor((ms % 60e3) / 1e3))}`;
    if (ms === 0 && !el.dataset.fired) { el.dataset.fired = '1'; setTimeout(refresh, 1500); }
  });
}
setInterval(tick, 1000);

function onScroll() { const t = $('.top'); if (t) t.classList.toggle('is-scrolled', window.scrollY > 4); }
addEventListener('scroll', onScroll, { passive: true });

/* live updates: the store confirms, the screen changes */
const refresh = debounce(async () => {
  if (!S.route) return;
  const a = document.activeElement;
  if (a && a.matches('input, textarea') && viewEl.contains(a)) return;
  if (S.sheet && S.route !== 'book') return;
  try { await refreshMe(); } catch { /* offline */ }
  if (S.route === 'booking') return; // don't move the form under the guest's fingers
  load(false);
}, 400);

async function boot() {
  await connect({ tokenKey: 'sv.v3.token' });
  try { await refreshMe(); } catch { auth.clear(); await refreshMe(); }
  onChange(() => refresh());
  addEventListener('hashchange', () => { S.depth += 1; route(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  if (!location.hash) history.replaceState(null, '', '#/book');
  await route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
