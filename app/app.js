/* =========================================================
   library live · sth.ventured — member web app (v2)
   Four entries (首页 · 预订 · 活动 · 我的), two skins:
   the public sees a library (L0), members see the machine (L1+).
   Identity, layers, prices and inventory are all decided by the core
   (shared/core.js); this file only draws what it is told (R-LAY-01).
   ========================================================= */
import { connect, call, auth, onChange, getMode, store } from '../shared/api.js';
import { html, raw, fmt, toast, debounce, reduceMotion } from '../shared/ui.js';
import { ZONES, DAY_ZONES, zoneOf, resourceOf, planASCII, planSVG } from '../shared/plan.js';
import { memberCode, CODE_STEP, BOOKING_STATUS, APP_STATUS, EVENT_KINDS, IDENTITIES, BOOKS, yuan, stampPattern, PERSONAS, DEMO_CODE } from '../shared/core.js';
import { FIG, scramble, typewrite, bar, stampText, decrypt, punchCard, donut } from './ascii.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const screenEl = $('#screen');
const tabbarEl = $('#tabbar');
const sheetEl = $('#sheet');
const overlayEl = $('#overlay');
const icon = id => raw(`<svg aria-hidden="true"><use href="#i-${id}"/></svg>`);
const pad = n => String(n).padStart(2, '0');

const S = {
  me: null, route: null, params: {}, seq: 0, data: {}, sheet: null, skew: 0,
  ui: { session: null, zone: null, layout: 'night', party: 2, extra: 0, note: '', explanation: '', evFilter: 'all', cracked: [], prev: {}, quote: null, quoteErr: null, figTaps: [] },
};
const serverNow = () => Date.now() + S.skew;
const tonightHZ = () => { const t = new Date(serverNow() + 8 * 36e5); if (t.getUTCHours() < 2) t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const home = () => { if (location.hash === '#/home') route(); else go('home'); };
const term = () => !!S.me && S.me.layer >= 1;
const mode = () => (S.me ? S.me.mode : 'night');

/* ---------- routes ---------- */
const ROUTES = {
  home: { tab: 'home', load: () => call('home'), view: viewHome },
  book: { tab: 'book', load: loadBook, view: viewBook, after: afterBook },
  events: { tab: 'events', load: () => call('events.list'), view: viewEvents },
  me: { tab: 'me', load: loadMe, view: viewMe, after: afterMe },
  order: { tab: 'me', load: () => call('booking.get', { id: S.params.id }), view: viewOrder },
  content: { tab: 'home', load: () => call('content.get', { key: S.params.id }), view: viewContent, after: afterContent },
  invite: { tab: 'me', load: () => call('invite.view', { token: S.params.id }), view: viewInvite },
  login: { tab: null, view: viewLogin },
  apply: { tab: 'me', view: viewApply },
};
const TABS = [['home', 'home', '首页', 'F1'], ['book', 'map', '预订', 'F2'], ['events', 'ticket', '活动', 'F3'], ['me', 'me', '我的', 'F4']];
function go(path) { location.hash = '#/' + path; }

async function refreshMe() {
  const me = await call('me');
  S.skew = Date.parse(me.now) - Date.now();
  const before = S.me;
  S.me = me;
  applySkin();
  if (me.play_unlock && (!before || before.identity !== 'member_active' || !overlayEl.dataset.played)) playUnlock();
  return me;
}

async function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = (path || 'home').split('/');
  S.params = { id: id ? decodeURIComponent(id) : null, ...Object.fromEntries(new URLSearchParams(query || '')) };
  const r = ROUTES[name] ? name : 'home';
  if (r !== name) history.replaceState(null, '', '#/home');
  if ((r === 'apply') && !S.me.user) { go('login?next=apply'); return; }
  const entering = S.route !== r || r === 'order' || r === 'content';
  if (entering && S.sheet) closeSheet();
  S.route = r;
  const seq = ++S.seq;
  const def = ROUTES[r];
  if (def.load) {
    const slow = setTimeout(() => { if (seq === S.seq) renderShell(true); }, 180);
    try {
      const [, data] = await Promise.all([refreshMe(), def.load()]);
      clearTimeout(slow);
      if (seq !== S.seq) return;
      S.data[r] = data;
    } catch (e) { clearTimeout(slow); if (seq === S.seq) handleError(e); return; }
  } else await refreshMe();
  render(entering);
}

function render(enter = false) {
  const def = ROUTES[S.route];
  const prev = $('.main', screenEl);
  const keep = !enter && prev ? prev.scrollTop : 0;
  screenEl.innerHTML = def.view(S.data[S.route]).s;
  const main = $('.main', screenEl);
  if (main) { main.scrollTop = keep; if (enter) main.classList.add('enter'); }
  renderTabs();
  if (term() && enter) $$('[data-scramble]', screenEl).forEach(el => scramble(el));
  if (def.after) def.after();
}
function renderShell(loading) {
  if (!loading) return;
  screenEl.innerHTML = term() ? html`<div class="boot"><span class="boot__cursor">loading_</span></div>`.s : html`<div class="boot" style="background:var(--bg);color:var(--fg)"><span class="boot__cursor" style="font-family:var(--serif);font-style:italic;font-size:22px">library live</span></div>`.s;
}
function renderTabs() {
  const tab = ROUTES[S.route].tab;
  tabbarEl.hidden = !tab;
  if (!tab) return;
  tabbarEl.innerHTML = TABS.map(([id, ic, zh, fk]) => html`<a class="tab ${tab === id ? 'is-on' : ''}" href="#/${id}" ${raw(tab === id ? 'aria-current="page"' : '')}>${icon(ic)}${term() ? html`<small>${fk}</small>` : ''}<span>${zh}</span></a>`.s).join('');
}
function applySkin() {
  const root = document.documentElement;
  root.dataset.skin = term() ? 'terminal' : 'library';
  root.dataset.mode = mode();
  const ph = store.get('sv.phosphor');
  const paper = store.get('sv.paper');
  if (ph) root.dataset.phosphor = ph; else delete root.dataset.phosphor;
  if (paper) root.dataset.paper = paper; else delete root.dataset.paper;
  const color = term() ? (mode() === 'day' ? '#F1EEE2' : '#0A0806') : mode() === 'day' ? '#EDE5D3' : '#0F1F19';
  $('meta[name="theme-color"]').setAttribute('content', color);
}

/* ---------- headers ---------- */
const modeLabel = m => ({ day: '白天 · 会员时间', night: '夜晚 · 演出', closed: '打烊中' })[m];
function header(title, sub, { back = null } = {}) {
  const unread = S.me && S.me.unread;
  const bell = S.me && S.me.user ? html`<button class="ibtn" data-act="notices" aria-label="通知${unread ? '，有未读' : ''}">${icon('bell')}${unread ? html`<span class="ibtn__dot"></span>` : ''}</button>` : '';
  if (term()) {
    const t = fmt.time(new Date(serverNow()));
    return html`<header class="tline">${back ? html`<a class="ibtn" href="#/${back}" aria-label="返回">${icon('back')}</a>` : ''}
      <span><span class="led"></span><b>${mode().toUpperCase()}</b> ${t}</span><span class="tline__sp"></span>
      <span data-scramble>${title}</span><span class="tline__sp"></span><span>#${S.me.user.member_no || '----'}</span>${bell}</header>`;
  }
  return html`<header class="bar"><div>${back ? html`<a class="ibtn" href="#/${back}" aria-label="返回">${icon('back')}</a>` : ''}</div>
    <div class="bar__mid"><span class="bar__t">${title}</span>${sub ? html`<span class="bar__s">${sub}</span>` : ''}</div><div>${bell}</div></header>`;
}
function masthead() {
  const p = fmt.parts(new Date(serverNow()));
  const unread = S.me && S.me.unread;
  return html`<header class="mast"><p class="mast__k">sth.ventured · 杭州武林路 9 号</p><h1 class="mast__t">library live</h1>
    <p class="mast__d">${p.y}.${pad(p.m)}.${pad(p.d)} ${p.dowZh} · ${modeLabel(mode())}</p>
    ${S.me && S.me.user ? html`<button class="ibtn" data-act="notices" aria-label="通知">${icon('bell')}${unread ? html`<span class="ibtn__dot"></span>` : ''}</button>` : html`<a class="ibtn" href="#/login" aria-label="登录">${icon('me')}</a>`}</header>`;
}

/* ---------- shared pieces ---------- */
const zoneAvail = z => (z.kind === 'booth' ? (z.free ? `余 ${z.free} 张` : z.sealed ? '会员预留 · 19:00 开放' : '已满') : z.free ? `余 ${z.free} 座` : '已满');
const minFrom = (zones, who) => Math.min(...zones.filter(z => z.kind === 'booth').map(z => z.price[who === 'member' ? 'min_member' : 'min_guest']));
function statusBanner() {
  const me = S.me;
  if (!me.user) return html`<div class="banner"><b>登录后可以订座、购票、报名</b><p>用手机号登录；会员仅限邀请或申请审核。</p><a class="btn btn--sm" href="#/login">登录</a></div>`;
  if (me.identity === 'invitee') return html`<div class="banner"><b>你有一张未领取的邀请</b><p>${me.invite.note}</p><a class="btn btn--sm" href="#/invite/${me.invite.token}">打开邀请函</a></div>`;
  if (me.identity === 'applicant') {
    const a = me.application;
    if (a.status === 'approved_awaiting_payment') return html`<div class="banner"><b>审核通过 · 付款后会员生效</b><p>首月会员费 ${yuan(me.member_price)}，付款前请阅读规则。</p><a class="btn btn--sm" href="#/me">去付款</a></div>`;
    return html`<div class="banner"><b>入会申请 · ${a.label.zh}</b><p>${a.status === 'need_info' ? a.review_note || '门店需要你补充资料。' : '审核期间，按非会员规则订座。'}</p><a class="btn btn--sm" href="#/me">查看进度</a></div>`;
  }
  if (me.identity === 'member_expired') return html`<div class="banner"><b>会员已到期</b><p>${me.membership.can_renew ? `到期 30 天内续费不需重新审核。` : '到期已超过 30 天，需要重新申请。'}</p><a class="btn btn--sm" href="#/me">${me.membership.can_renew ? '续费' : '重新申请'}</a></div>`;
  return '';
}

/* ---------- home ---------- */
function viewHome(d) { return term() ? homeTerminal(d) : homeLibrary(d); }

function playbill(t) {
  if (!t) return html`<div class="bill"><p class="bill__k">Tonight · 今晚</p><p class="bill__t">今晚没有演出</p></div>`;
  const s = t.session;
  const guestFrom = minFrom(t.zones, 'guest');
  const memberFrom = minFrom(t.zones, 'member');
  return html`<article class="bill">
    <p class="bill__k">${s.date === tonightHZ() ? 'Tonight · 今晚节目单' : 'Next · 下一场'} · ${fmt.mdOf(s.date)} ${fmt.dowOf(s.date)}</p>
    <h2 class="bill__t">${s.title}</h2><p class="bill__en">${s.en}</p><p class="bill__by">演出 · ${s.performers}</p>
    <p class="bill__time">${s.show_start} 开场 · ${s.hold_deadline} 留位截止</p>
    <div class="idx">${t.zones.map(z => { const zz = zoneOf(z.id); return html`<div class="idx__r ${z.sealed && !z.free ? 'is-sealed' : ''}"><b>${zz.zh}</b><i></i><span>${zoneAvail(z)}</span></div>`; })}</div>
    <div class="price">
      ${t.ticket_sales ? html`<div>散台 · 拼桌 · 吧台：门票 <b>${yuan(t.ticket_price)}</b> / 人，含${t.ticket_drink}；会员免票</div>` : html`<div>门票暂未开售；会员散台、拼桌照常。</div>`}
      <div>卡座低消：会员 <b>${yuan(memberFrom)}</b> 起 · 非会员 <b>${yuan(guestFrom)}</b> 起；订金为低消的 30%</div>
    </div>
    <div class="btns" style="margin-top:16px"><a class="btn btn--block" href="#/book">按区域订座 · 购票</a></div>
  </article>`;
}

function teaserCard(c) {
  return html`<a class="teaser" href="#/content/${c.key}">
    <p class="teaser__k">Members’ stacks · 会员馆藏</p><p class="teaser__t">${c.teaser.title}</p><p class="teaser__p">${c.teaser.hook}</p>
    <div class="teaser__redact" aria-hidden="true"><i></i><i></i><i></i></div>
    <span class="stamp">Restricted<small>会员可见</small></span></a>`;
}

function homeLibrary(d) {
  const m = d.mode;
  const teasers = d.content.filter(c => c.mode === 'any' || c.mode === m || (m === 'closed' && c.mode === 'night'));
  const dayCover = d.content.find(c => c.key === 'membertime');
  const evs = d.events.slice(0, 3);
  return html`${masthead()}<main class="main">
    ${statusBanner()}
    ${m === 'day' && dayCover ? html`<section class="section"><div class="sh"><b>白天属于会员</b><span>Members’ hours</span></div>
      <a class="teaser" href="#/content/membertime"><p class="teaser__k">10:00 – ${d.switch_at} · Members only</p><p class="teaser__t">${dayCover.teaser.title}</p><p class="teaser__p">${dayCover.teaser.hook} 非会员白天不开放，${d.switch_at} 以后见。</p><div class="teaser__redact" aria-hidden="true"><i></i><i></i></div><span class="stamp">Members<small>会员时间</small></span></a></section>` : ''}
    ${m === 'closed' ? html`<section class="section"><div class="ccard"><div class="ccard__call"><span>CLOSED</span><span>${d.day_open_at}</span></div><p class="ccard__t">现在打烊</p><p class="ccard__p">${d.day_open_at} 开门（白天为会员时间），${d.switch_at} 起为演出夜。线上订座照常。</p></div></section>` : ''}
    ${playbill(d.tonight)}
    ${d.mine && d.mine.length ? html`<section class="section"><div class="sh"><b>我的预订</b><span>On loan</span></div>${d.mine.map(b => orderCard(b))}</section>` : ''}
    <section class="section"><div class="sh"><b>会员馆藏</b><span>Trailers</span></div>
      <div class="teasers">${teasers.filter(c => c.key !== 'membertime' || m !== 'day').map(teaserCard)}</div>
      <p class="note">会员内容只露出封面；正文在入会之后。</p></section>
    <section class="section"><div class="sh"><b>近期活动</b><span>Programme</span></div>${evs.map(e => eventCard(e))}<a class="link" href="#/events" style="margin-top:10px">全部活动 ${icon('arrow')}</a></section>
    <p class="motto">Nothing ventured, nothing gained.</p>
  </main>`;
}

function homeTerminal(d) {
  const m = d.mode;
  const me = S.me;
  const mem = d.member || {};
  const visible = d.content;
  const memo = visible.find(c => c.key === 'memo');
  const after = visible.find(c => c.key === 'afterhours');
  const t = d.tonight;
  const zoneLines = t ? t.zones.map(z => { const zz = zoneOf(z.id); const frac = z.total ? (z.total - z.free) / z.total : 0; return `${zz.en.padEnd(17).slice(0, 17)} ${bar(frac, 10)} ${String(z.free).padStart(2)}/${z.total}${z.unit === 'seat' ? 's' : 'b'}`; }).join('\n') : '';
  return html`${header('library-live')}<main class="main">
    <pre class="fig" data-act="fig" aria-label="sth.ventured">${FIG.brand.join('\n')}</pre>
    <div class="section" style="margin-top:6px"><p class="prompt"><span>whoami → ${me.user.name} · member #${me.user.member_no} · layer ${Math.max(1, ...visible.filter(c => !c.locked).map(c => c.layer))}</span></p>
      <p class="prompt"><span>mode → ${m} (${m === 'day' ? `10:00–${d.switch_at} members' hours` : m === 'night' ? `${d.switch_at}–${d.night_close_at} live` : `opens ${d.day_open_at}`})</span></p></div>
    ${m === 'closed' ? html`<pre class="fig fig--sm">${FIG.closed.join('\n')}</pre>` : ''}
    ${m === 'day' ? html`
      <section class="panel"><span class="panel__t" data-scramble>CHECK-IN</span><span class="panel__r">${mem.checkin.here} here</span>
        ${mem.checkin.today ? html`<p class="out">checked in · ${fmt.time(mem.checkin.at)} · +${mem.checkin.companions} guests</p><button class="btn btn--sm" style="margin-top:10px" data-act="checkin">STATUS</button>`
          : html`<p class="out">白天到店，扫门口今天的签到码。朋友不用注册，填人数即可。</p><button class="btn btn--primary btn--block" style="margin-top:12px" data-act="checkin">CHECK IN · 签到</button>`}
      </section>
      <section class="panel"><span class="panel__t" data-scramble>ROUNDTABLES</span><span class="panel__r">open salon</span>
        ${mem.roundtables.length ? html`<div class="ls">${mem.roundtables.map(e => html`<button class="ls__r" data-act="event" data-id="${e.id}"><span class="ls__m">${fmt.time(e.start_at)}</span><span class="ls__t">${e.title}<small>host ${e.host} · ${e.taken}/${e.capacity}</small></span><span class="ls__a">${e.mine ? html`<span class="tag tag--inv">IN</span>` : '[JOIN]'}</span></button>`)}</div>` : html`<p class="out">今天没有排座谈。适合读书。</p>`}
      </section>
      <section class="panel"><span class="panel__t" data-scramble>MEETINGS</span>
        ${mem.meetings.length ? html`<div class="ls">${mem.meetings.map(x => meetingRow(x))}</div>` : html`<p class="out">多人会议需要留座、摆桌椅时，提前申请。</p>`}
        <button class="btn btn--sm" style="margin-top:10px" data-act="meeting-new">NEW REQUEST · 申请会议</button>
      </section>` : ''}
    ${m !== 'day' && t ? html`
      <section class="panel"><span class="panel__t" data-scramble>RESERVED FOR YOU</span><span class="panel__r">until ${d.switch_at}</span>
        <div class="ls">${mem.reserved.map(r => html`<div class="ls__r"><span class="ls__m">${r.code}</span><span class="ls__t">${resourceOf(r.code).card.name} · 舞台前圆卡座<small>${resourceOf(r.code).card.story}</small></span><span class="ls__a">${r.state === 'reserved_open' ? html`<span class="tag tag--inv">OPEN</span>` : r.state === 'mine' ? html`<span class="tag tag--inv">YOURS</span>` : html`<span class="tag">HELD</span>`}</span></div>`)}</div>
        <a class="btn btn--primary btn--block" style="margin-top:12px" href="#/book?zone=round">BOOK THE ROUNDS</a>
      </section>` : ''}
    ${t ? html`<section class="panel"><span class="panel__t" data-scramble>${m === 'day' ? 'TONIGHT' : 'NOW SHOWING'}</span><span class="panel__r">${fmt.mdOf(t.session.date)} ${t.session.show_start}</span>
      <p class="out"><b>${t.session.title}</b> · ${t.session.en}\nact  ${t.session.performers}\n\n${zoneLines}</p>
      <a class="btn btn--sm" style="margin-top:10px" href="#/book">OPEN FLOOR PLAN</a></section>` : ''}
    ${memo ? html`<section class="panel"><span class="panel__t" data-scramble>MEMO</span><span class="panel__r">weekly</span>
      <p class="out">${memo.teaser.title}\n${memo.teaser.hook}</p><a class="btn btn--sm" style="margin-top:10px" href="#/content/memo">READ</a></section>` : ''}
    ${after && m !== 'day' ? html`<section class="panel"><span class="panel__t" data-scramble>AFTER HOURS</span><span class="panel__r">night only</span><p class="out">${after.teaser.hook}</p><a class="btn btn--sm" style="margin-top:10px" href="#/content/afterhours">OPEN</a></section>` : ''}
    ${hiddenPanel(visible)}
    ${d.mine && d.mine.length ? html`<section class="panel"><span class="panel__t">ORDERS</span><div class="ls">${d.mine.map(b => html`<a class="ls__r" href="#/order/${b.id}"><span class="ls__m">${fmt.mdOf(b.date)}</span><span class="ls__t">${zoneOf(b.zone).zh} · ${b.party_size} 人<small>${b.code}</small></span><span class="ls__a">${b.label.deal}</span></a>`)}</div></section>` : ''}
    <p class="motto">no moments in this club were generated.</p>
  </main>`;
}
const RULE_HINT = { checkin_count: '白天签到一次后解锁', event_attended: '到场参加一次活动后解锁', hosted_session: '做过一次分享后解锁', staff_grant: '由店长授予', easter_egg: '藏在某个角落' };
function hiddenPanel(items) {
  const deep = items.filter(c => c.layer >= 1);
  return html`<section class="panel"><span class="panel__t" data-scramble>LS -LA /HIDDEN</span><span class="panel__r">L1–L3</span>
    <div class="ls">${deep.map(c => c.locked
      ? html`<div class="ls__r is-locked"><span class="ls__m">d---------</span><span class="ls__t">${c.teaser.title}<small>${RULE_HINT[c.rule] || ''}</small></span><span class="ls__a">${icon('lock')}</span></div>`
      : html`<a class="ls__r" href="#/content/${c.key}"><span class="ls__m">drwx------</span><span class="ls__t">${c.teaser.title}<small>L${c.layer}${c.dim ? ' · 现在不在时段内' : ''}</small></span><span class="ls__a">&gt;</span></a>`)}</div></section>`;
}
function meetingRow(x) {
  const st = { submitted: '待门店确认', accepted: '已确认', counter_proposed: '门店提议调整', user_accepted: '已确认', rejected: '未能安排', user_declined: '已婉拒', cancelled: '已取消' }[x.status];
  return html`<div class="ls__r"><span class="ls__m">${fmt.mdOf(x.date)}</span><span class="ls__t">${x.start}–${x.end} · ${x.party_size} 人<small>${st}${x.counter && x.status === 'counter_proposed' ? ` → ${x.counter.start}–${x.counter.end} · ${x.counter.note}` : x.reply ? ` · ${x.reply}` : ''}</small></span>
    <span class="ls__a">${x.status === 'counter_proposed' ? html`<button class="btn btn--sm" data-act="meeting-respond" data-id="${x.id}" data-v="1">OK</button>` : ''}</span></div>`;
}

/* ---------- events ---------- */
function eventCard(e) {
  const k = EVENT_KINDS[e.kind];
  if (e.locked) {
    return html`<button class="teaser ccard--btn" style="margin-top:12px" data-act="event" data-id="${e.id}"><p class="teaser__k">${k.en} · ${fmt.mdOf(e.start_at.slice(0, 10))} ${fmt.time(e.start_at)}</p><p class="teaser__t">${e.title}</p><p class="teaser__p">${e.hook}</p><div class="teaser__redact" aria-hidden="true"><i></i><i></i></div><span class="stamp">Members<small>会员活动</small></span></button>`;
  }
  return html`<button class="ccard ccard--btn" style="margin-top:12px" data-act="event" data-id="${e.id}">
    <div class="ccard__call"><span>${k.en.toUpperCase()} · ${e.id.toUpperCase()}</span><span>${fmt.md(e.start_at)} ${fmt.time(e.start_at)}</span></div>
    <p class="ccard__t">${e.title}</p><p class="ccard__en">${e.en || ''}</p>
    <p class="ccard__p">${e.host ? `主持 ${e.host} · ` : ''}${e.location} · ${e.left > 0 ? `余 ${e.left} / ${e.capacity}` : '已满'}${e.layer === 0 ? ' · 公开' : ''}</p>
    ${e.mine ? html`<span class="stamp stamp--purple stamp--abs">${e.mine === 'attended' ? 'Attended' : 'Registered'}<small>${e.mine === 'attended' ? '已到场' : '已报名'}</small></span>` : ''}</button>`;
}
function viewEvents(list) {
  const f = S.ui.evFilter;
  const pass = e => f === 'all' || (f === 'public' ? e.layer === 0 : f === 'members' ? e.layer === 1 : f === 'mine' ? !!e.mine : e.kind === f);
  const up = list.filter(e => !e.past && pass(e));
  const past = list.filter(e => e.past && pass(e));
  const chips = [['all', '全部'], ['public', '公开'], ['members', '会员'], ['roundtable', '座谈'], ['mine', '我的']];
  if (term()) {
    return html`${header('events')}<main class="main">
      <div class="section" style="margin-top:14px"><div class="chips">${chips.map(([v, l]) => html`<button class="chip" aria-pressed="${String(f === v)}" data-act="ev-filter" data-v="${v}">${l}</button>`)}</div></div>
      <section class="panel"><span class="panel__t" data-scramble>UPCOMING</span><span class="panel__r">${up.length}</span>
        <div class="ls">${up.length ? up.map(e => html`<button class="ls__r" data-act="event" data-id="${e.id}"><span class="ls__m">${fmt.mdOf(e.start_at.slice(0, 10))} ${fmt.time(e.start_at)}</span><span class="ls__t">${e.title}<small>${EVENT_KINDS[e.kind].en.toLowerCase()} · ${e.taken}/${e.capacity}${e.layer === 0 ? ' · public' : ''}</small></span><span class="ls__a">${e.mine ? html`<span class="tag tag--inv">IN</span>` : e.left ? '[+]' : html`<span class="tag">FULL</span>`}</span></button>`) : html`<p class="out">nothing scheduled.</p>`}</div></section>
      ${past.length ? html`<section class="panel"><span class="panel__t">ARCHIVE</span><div class="ls">${past.map(e => html`<button class="ls__r" data-act="event" data-id="${e.id}"><span class="ls__m">${fmt.mdOf(e.start_at.slice(0, 10))}</span><span class="ls__t">${e.title}<small>${e.mine === 'attended' ? 'attended → 现场回放已解锁' : 'past'}</small></span><span class="ls__a">${e.mine === 'attended' ? html`<span class="tag tag--inv">✓</span>` : ''}</span></button>`)}</div></section>` : ''}
    </main>`;
  }
  return html`${header('活动', 'Programme')}<main class="main">
    <div class="section" style="margin-top:14px"><div class="chips">${chips.map(([v, l]) => html`<button class="chip" aria-pressed="${String(f === v)}" data-act="ev-filter" data-v="${v}">${l}</button>`)}</div></div>
    <section class="section" style="margin-top:6px">${up.length ? up.map(eventCard) : html`<p class="empty">这里暂时没有活动。</p>`}</section>
    ${past.length ? html`<section class="section"><div class="sh"><b>往期</b><span>Archive</span></div>${past.map(eventCard)}</section>` : ''}
    <p class="motto">科创 panel、播客录制与开放座谈。会员常规活动免费。</p>
  </main>`;
}
function sheetEvent({ id }) {
  const e = (S.data.events || []).find(x => x.id === id) || (S.data.home && S.data.home.events.find(x => x.id === id)) || S.sheet.event;
  if (!e) return { body: html`<p class="empty">…</p>` };
  const k = EVENT_KINDS[e.kind];
  const me = S.me;
  if (e.locked) {
    return { label: e.title, body: html`<div class="sheet__h"><span>${k.en} · 会员活动</span><b>${e.title}</b></div>
      <div class="teaser"><p class="teaser__k">${fmt.full(e.start_at)}</p><p class="teaser__t">${e.title}</p><p class="teaser__p">${e.hook}</p><div class="teaser__redact" aria-hidden="true"><i></i><i></i><i></i></div><span class="stamp">Members<small>会员活动</small></span></div>
      <p class="note">会员活动只露出封面。入会后可以看到全部内容并报名。</p>`, foot: me.user ? html`<a class="btn btn--block" href="#/me">申请入会</a>` : html`<a class="btn btn--block" href="#/login">登录</a>` };
  }
  let cta;
  if (e.past) cta = html`<button class="btn btn--ghost btn--block" disabled>已结束</button>`;
  else if (!me.user) cta = html`<a class="btn btn--block" href="#/login">登录后报名</a>`;
  else if (e.mine === 'registered') cta = html`<button class="btn btn--ghost btn--block" data-act="event-cancel" data-id="${e.id}">取消报名</button>`;
  else if (e.layer === 0 && me.identity !== 'member_active' && !e.public_signup) cta = html`<button class="btn btn--ghost btn--block" disabled>暂只对会员开放报名</button>`;
  else if (e.left <= 0) cta = html`<button class="btn btn--ghost btn--block" disabled>名额已满</button>`;
  else cta = html`<button class="btn btn--primary btn--block" data-act="event-register" data-id="${e.id}">报名${me.identity === 'member_active' ? ' · 会员免费' : ''}</button>`;
  return {
    label: e.title, tall: true,
    body: html`<div class="sheet__h"><span>${k.en} · ${k.zh}</span><b>${e.title}</b>${e.en ? html`<span style="text-transform:none;letter-spacing:.04em">${e.en}</span>` : ''}</div>
      <div class="${term() ? 'panel' : 'ccard'}" style="margin:0">${term() ? html`<span class="panel__t">${e.id}</span>` : html`<div class="ccard__call"><span>${e.id.toUpperCase()}</span><span>${e.layer ? 'MEMBERS' : 'PUBLIC'}</span></div>`}
        <dl class="kv" style="margin-top:${term() ? 0 : 10}px"><dt>时间</dt><dd>${fmt.range(e.start_at, e.end_at)}</dd><dt>地点</dt><dd>${e.location}</dd><dt>主持</dt><dd>${e.host}${e.guests ? ` · 嘉宾 ${e.guests}` : ''}</dd><dt>名额</dt><dd>${e.taken} / ${e.capacity}${e.left ? '' : ' · 已满'}</dd></dl>
        <p class="note" style="opacity:.9">${e.intro}</p></div>
      <p class="note">需要报名以控制人数；名额满后不设候补。${e.layer === 0 && e.public_signup ? '这一场对非会员开放报名。' : ''}</p>`,
    foot: cta,
  };
}

/* ---------- booking ---------- */
async function loadBook() {
  const win = await call('sessions.window');
  const open = win.sessions.filter(s => s.status === 'on_sale' && !s.past_cutoff);
  if (!S.ui.session || !win.sessions.some(s => s.id === S.ui.session)) S.ui.session = (open[0] || win.sessions[0] || {}).id;
  if (S.params.zone) S.ui.zone = S.params.zone;
  const map = S.ui.session ? await call('session.map', { session_id: S.ui.session }) : null;
  return { win, map };
}
function viewBook(d) {
  const { win, map } = d;
  const sel = S.ui.zone;
  const z = sel && map ? map.zones.find(x => x.id === sel) : null;
  const zz = sel ? zoneOf(sel) : null;
  const prev = S.ui.prev[S.ui.session] || {};
  const cracked = map ? ['B05', 'B06'].filter(c => prev[c] === 'reserved_sealed' && map.states[c].state !== 'reserved_sealed') : [];
  if (map) S.ui.prev[S.ui.session] = Object.fromEntries(Object.entries(map.states).map(([c, v]) => [c, v.state]));
  const layout = term() ? S.ui.layout : 'night';
  const plan = !map ? '' : term()
    ? raw(planASCII({ states: map.states, selected: sel || '', layout }))
    : raw(planSVG({ states: map.states, selected: sel || '', initials: S.me.user ? S.me.user.initials : '', cracked }));
  const dates = html`<div class="dates">${win.sessions.map(s => html`<button class="date" aria-pressed="${String(s.id === S.ui.session)}" data-act="date" data-id="${s.id}" ${raw(s.status !== 'on_sale' || s.past_cutoff ? 'disabled' : '')}><span>${fmt.dowEnOf(s.date)}</span><b>${fmt.dayOf(s.date)}</b><small>${s.past_cutoff ? '现场' : fmt.monthEnOf(s.date)}</small></button>`)}</div>`;
  const s = map && map.session;
  return html`${header(term() ? 'floor-plan' : '预订', '按区域订座 · Book by zone')}<main class="main">
    ${dates}
    <p class="session-line">${win.member ? '会员可订 7 天' : '非会员可订 3 天'} · ${s ? html`<b>${s.title}</b> · ${s.performers} · ${s.show_start} 开场` : ''}</p>
    ${term() ? html`<div class="layout-toggle"><button class="chip" aria-pressed="${String(layout === 'night')}" data-act="layout" data-v="night">NIGHT 夜间布局</button><button class="chip" aria-pressed="${String(layout === 'day')}" data-act="layout" data-v="day">DAY 日间布局</button></div>` : ''}
    <div class="mapwrap" id="map">${plan}</div>
    <p class="mapwrap__note">${layout === 'day' ? '日间布局（会员时间）：座谈、阅读与会议。会议请在首页申请。' : '点选一个区域。门店确认时安排具体桌号。'}${!term() && map && map.zones.some(x => x.sealed) ? ' 带火漆的是会员预留卡座，19:00 开放。' : ''}</p>
    ${z && layout === 'night' ? zoneCard(z, zz, map) : ''}
    <section class="section"><div class="sh"><b>${layout === 'day' ? '日间分区' : '全部区域'}</b><span>List view</span></div>
      <div class="zlist">${(map ? map.zones : []).map(x => { const q = zoneOf(x.id); const dz = DAY_ZONES[x.id]; return html`<button class="zrow" aria-pressed="${String(sel === x.id)}" data-act="zone" data-id="${x.id}"><span><b>${layout === 'day' ? dz.zh : q.zh}<i>${layout === 'day' ? dz.en : q.en}</i></b><small>${layout === 'day' ? dz.blurb : q.tags.join(' · ')}</small></span><em>${layout === 'day' ? '' : zoneAvail(x)}</em></button>`; })}</div></section>
    <p class="motto">${term() ? 'press and hold the far corner. something is there.' : '一张桌，一个年份，一段首轮故事。'}</p>
  </main>`;
}
function zoneCard(z, zz, map) {
  const member = map.member_on_date;
  const booth = z.kind === 'booth';
  const p = z.price || {};
  const cta = !S.me.user ? html`<a class="btn btn--block" href="#/login">登录后预订</a>`
    : z.free ? html`<button class="btn btn--primary btn--block" data-act="book-zone" data-id="${z.id}">选这个区域 · ${booth ? '提交后门店确认' : member ? '即时成功' : '购票'}</button>`
    : html`<button class="btn btn--ghost btn--block" disabled>${z.sealed ? '会员预留 · 19:00 后空着的开放' : '这一晚已满'}</button>`;
  const inner = html`<p class="${term() ? 'out' : 'ccard__t'}">${zz.zh} · ${zz.en}</p>
    <p class="note" style="opacity:.85">${zz.blurb}</p>
    <div class="zcard__tags">${zz.tags.map(t => html`<span>${t}</span>`)}</div>
    ${booth ? html`<div class="cmp"><div class="${member ? 'is-me' : ''}"><b>${yuan(p.min_member)}</b><span>会员低消 · 订金 ${yuan(p.deposit_member)}</span></div><div class="${member ? '' : 'is-me'}"><b>${yuan(p.min_guest)}</b><span>非会员低消 · 订金 ${yuan(p.deposit_guest)}</span></div></div>
      <p class="note">每桌 ${z.capacity} 人，余 ${z.free} / ${z.total} 张。订金是该身份低消的 30%，抵当晚消费；卡座由门店 30 分钟内人工确认。${z.reserved ? '这两张每晚为会员预留，19:00 后空着的向所有人开放。' : ''}</p>`
    : html`<div class="cmp"><div class="${member ? 'is-me' : ''}"><b>免票</b><span>会员 · 无需预付，需点酒</span></div><div class="${member ? '' : 'is-me'}"><b>${yuan(map.ticket_price)}</b><span>非会员门票 / 人 · 含${map.ticket_drink}</span></div></div>
      <p class="note">按座位预订，余 ${z.free} / ${z.total} 座。${member ? '会员本人到场，同行免票。' : '门票每人每场最多 4 张，购票人本人到场，最多带 3 位同行人。'}</p>`}
    <div style="margin-top:14px">${cta}</div>`;
  return html`<section class="zcard">${term() ? html`<div class="panel" style="margin:0"><span class="panel__t" data-scramble>${zz.en.toUpperCase()}</span><span class="panel__r">${z.free}/${z.total}</span>${inner}</div>` : html`<div class="ccard"><div class="ccard__call"><span>§ ${ZONES.findIndex(x => x.id === zz.id) + 1} · ${zz.en.toUpperCase()}</span><span>${zoneAvail(z)}</span></div>${inner}</div>`}</section>`;
}
function afterBook() {
  const pre = $('.aplan');
  if (!pre) return;
  let timer = null;
  pre.addEventListener('pointerdown', e => {
    const r = pre.getBoundingClientRect();
    if ((e.clientX - r.left) / r.width < 0.3 && (e.clientY - r.top) / r.height < 0.05) timer = setTimeout(() => trigger('hidden-room'), 1200);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => pre.addEventListener(t, () => clearTimeout(timer)));
  pre.addEventListener('click', e => { const el = e.target.closest('[data-zone]'); if (el && S.ui.layout === 'night') selectZone(el.dataset.zone); });
}
function selectZone(id) {
  S.ui.zone = id;
  render();
  requestAnimationFrame(() => $('.zcard')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' }));
}

function sheetBooking() {
  const map = S.data.book && S.data.book.map;
  const z = map.zones.find(x => x.id === S.ui.zone);
  const zz = zoneOf(S.ui.zone);
  const q = S.ui.quote;
  const err = S.ui.quoteErr;
  const booth = z.kind === 'booth';
  const member = map.member_on_date;
  const need = q ? q.required : Math.ceil(S.ui.party / z.capacity);
  const units = q ? q.units : need + S.ui.extra;
  const due = q ? q.price.total_due : 0;
  const rules = booth ? ['订金为该身份低消的 30%，抵当晚消费。', `付款后进入门店确认，${map.confirm_minutes} 分钟内未确认或被拒绝，全额原路退回。`, `${map.session.hold_deadline} 留位截止；之后门店可以释放桌位，订金当晚仍可抵扣。`, '当晚未到店，订金不退。会员本人须到场。']
    : member ? ['会员散台、拼桌与吧台无需预付，需点酒入座。', '会员本人到场，同行朋友免票。']
    : [`门票 ${yuan(map.ticket_price)} / 人，含${map.ticket_drink}，赠饮视为满足点酒入座。`, '每人每场最多 4 张，购票人本人到场，最多带 3 位同行人，整单核验。', '门票不可转赠，售出后不支持主动退款；演出取消全额退款。'];
  return {
    label: '预订', tall: true,
    body: html`<div class="sheet__h"><span>${fmt.mdOf(map.session.date)} ${fmt.dowOf(map.session.date)} · ${map.session.title}</span><b>${zz.zh} · ${zz.en}</b></div>
      <div class="row2"><div><b>人数</b><small>${booth ? `每桌 ${z.capacity} 人，需要 ${need} 张` : member ? '按座位预订' : '门票 = 人数'}</small></div>
        <span class="stepper"><button type="button" data-act="party" data-d="-1" aria-label="减少" ${raw(S.ui.party <= 1 ? 'disabled' : '')}>${icon('minus')}</button><output>${S.ui.party}</output><button type="button" data-act="party" data-d="1" aria-label="增加">${icon('plus')}</button></span></div>
      ${booth ? html`<div class="row2"><div><b>多要一张桌</b><small>超出所需桌数需写说明，门店人工确认</small></div><span class="stepper"><button type="button" data-act="extra" data-d="-1" ${raw(S.ui.extra <= 0 ? 'disabled' : '')}>${icon('minus')}</button><output>${S.ui.extra}</output><button type="button" data-act="extra" data-d="1" ${raw(units >= 3 ? 'disabled' : '')}>${icon('plus')}</button></span></div>` : ''}
      ${booth && (S.ui.extra > 0 || (q && q.manual_reasons.includes('extra_reserved'))) ? html`<label class="field"><span class="field__l">说明 <i>必填</i></span><input class="input" data-bind="explanation" maxlength="120" value="${S.ui.explanation}" placeholder="例：晚一点还有人来"></label>` : ''}
      <label class="field"><span class="field__l">位置偏好 / 特殊需求 <i>选填 · 填写后转人工确认</i></span><input class="input" data-bind="note" maxlength="120" value="${S.ui.note}" placeholder="例：靠舞台一侧"></label>
      <div class="sum">
        ${err ? html`<div class="note note--warn">${err}</div>` : ''}
        ${q ? html`${q.warnings.map(w => html`<div class="note note--warn">${w.text}</div>`)}
          <div><span>${booth ? `${units} 张卡座 × 订金 ${yuan(q.price.deposit_each)}` : member ? `${q.seats} 个座位` : `${q.price.tickets} 张门票 × ${yuan(q.price.ticket_price)}`}</span><b>${yuan(due)}</b></div>
          <div><span>确认方式</span><b>${q.confirm_mode === 'instant' ? '即时成功' : `门店 ${map.confirm_minutes} 分钟内确认`}</b></div>
          <div class="total"><span>现在需付</span><b>${yuan(due)}</b></div>` : html`<div class="dim">计算中…</div>`}
      </div>
      <ul class="rules">${rules.map(r => html`<li>${r}</li>`)}</ul>`,
    foot: html`<button class="btn btn--primary btn--block" data-act="book-submit" ${raw(!q || err ? 'disabled' : '')}>${due ? `提交并支付 ${yuan(due)}` : '提交预订'}</button>`,
  };
}
const requote = debounce(async () => {
  if (!S.sheet || S.sheet.type !== 'booking') return;
  const map = S.data.book.map;
  try {
    S.ui.quote = await call('booking.quote', { session_id: map.session.id, zone: S.ui.zone, party_size: S.ui.party, extra: S.ui.extra, note: S.ui.note, explanation: S.ui.explanation });
    S.ui.quoteErr = null;
  } catch (e) { S.ui.quote = null; S.ui.quoteErr = e.message + (e.rule ? `（${e.rule}）` : ''); }
  renderSheet();
}, 220);

function sheetPay({ booking: b }) {
  return {
    label: '支付',
    body: html`<div class="paysheet"><p class="paysheet__k">${b.price.tickets ? 'TICKETS · 门票' : 'DEPOSIT · 订金'}</p><p class="paysheet__amt">${yuan(b.price.total_due)}</p>
      <p class="note">${zoneOf(b.zone).zh} · ${fmt.mdOf(b.date)} · ${b.party_size} 人 · ${b.code}</p>
      <p class="paysheet__mock">模拟支付 · payment.provider = mock<br>商户号到位后换成微信支付</p>
      <div class="count"><svg class="ring" viewBox="0 0 70 70"><circle class="r-bg" cx="35" cy="35" r="30"/><circle class="r-fg" cx="35" cy="35" r="30" stroke-dasharray="188.5" data-ring="${b.lock_expires_at}" data-span="${10 * 60e3}"/></svg><div><b data-countdown="${b.lock_expires_at}">10:00</b><small>内完成支付，否则自动取消、释放桌位</small></div></div></div>`,
    foot: html`<div class="btns btns--2"><button class="btn btn--ghost" data-act="pay-cancel" data-id="${b.id}">取消订单</button><button class="btn btn--primary" data-act="pay" data-id="${b.id}">确认支付</button></div>`,
  };
}

/* ---------- order (P05, P06, P12) ---------- */
function orderCard(b) {
  return html`<a class="slip" href="#/order/${b.id}" style="display:block;text-decoration:none;margin:0 0 12px">
    <div class="slip__h"><span>${b.code}</span><span>${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)}</span></div>
    <p class="slip__sub" style="margin-top:10px">${zoneOf(b.zone).zh} · ${b.party_size} 人 · ${b.label.zh}</p>
    <span class="stamp ${b.status === 'confirmed' ? 'stamp--green' : b.status === 'pending_confirm' ? '' : 'stamp--purple'}">${b.label.deal}<small>${b.label.zh}</small></span></a>`;
}
function viewOrder(b) {
  const z = zoneOf(b.zone);
  const deadline = b.status === 'pending_payment' ? b.lock_expires_at : b.status === 'pending_confirm' ? b.confirm_deadline_at : null;
  const refund = b.refund ? (b.refund.status === 'succeeded' ? `已原路退回 ${yuan(b.refund.amount)}` : `退款处理中 · ${yuan(b.refund.amount)}`) : '';
  const tables = b.lines.length ? b.lines.map(l => `${l.code}${l.name ? `「${l.name}」` : ''}${b.kind === 'seats' ? ` × ${l.seats}` : ''}`).join('、') : '门店确认时安排';
  const rows = [
    ['场次', `${fmt.mdOf(b.date)} ${fmt.dowOf(b.date)} · ${b.session.title} · ${b.session.show_start}`],
    ['区域', `${z.zh} · ${z.en}`], ['人数', `${b.party_size} 人${b.units > 1 ? ` · ${b.units} 张桌` : ''}`], ['桌号', tables],
    ['金额', b.price.total_due ? `${yuan(b.price.total_due)}${b.price.tickets ? ` · 门票 × ${b.price.tickets}` : ' · 订金'}` : '无需预付'],
    b.payment ? ['支付', { unpaid: '未支付', paying: '支付中', paid: '已支付', failed_closed: '已关闭' }[b.payment.status]] : null,
    refund ? ['退款', refund] : null,
    b.deposit ? ['订金', { unused: '未使用，抵当晚消费', partially_used: `已抵扣 ${yuan(b.deposit.redeemed)}`, used: '已抵扣', valid_tonight_table_released: '桌位已释放，订金当晚仍可抵扣', expired: '已失效（未到店）' }[b.deposit.state]] : null,
    b.ticket ? ['门票', `${b.ticket.count} 张 · ${b.ticket.verification === 'verified' ? '已核验' : '整单核验'} · 赠饮${b.ticket.drink_redeemed ? '已兑换' : '未兑换'}`] : null,
    b.note ? ['备注', b.note] : null,
  ].filter(Boolean);
  const countdown = deadline ? html`<div class="count"><svg class="ring" viewBox="0 0 70 70"><circle class="r-bg" cx="35" cy="35" r="30"/><circle class="r-fg" cx="35" cy="35" r="30" stroke-dasharray="188.5" data-ring="${deadline}" data-span="${(b.status === 'pending_payment' ? 10 : 30) * 60e3}"/></svg><div><b data-countdown="${deadline}">--:--</b><small>${b.status === 'pending_payment' ? '内完成支付' : '门店确认截止，超时自动关闭并全额退款'}</small></div></div>` : '';
  const actions = [];
  if (b.status === 'pending_payment') actions.push(html`<button class="btn btn--primary btn--block" data-act="pay-open" data-id="${b.id}">去支付</button>`);
  if (b.status === 'rejected' || b.status === 'confirm_timeout_closed') actions.push(html`<button class="btn btn--block" data-act="rebook" data-id="${b.id}">${b.suggestion_zone ? `一键改订 · ${zoneOf(b.suggestion_zone).zh}` : '重新预订'}</button>`);
  const pass = b.status === 'confirmed' || b.status === 'fulfilled';
  if (term()) {
    return html`${header('order', '', { back: 'me' })}<main class="main">
      <section class="panel"><span class="panel__t" data-scramble>ORDER ${b.code}</span><span class="panel__r">${b.status}</span>
        <p class="out"><b>${b.label.deal}</b> · ${b.label.zh}${b.label.note ? ` · ${b.label.note}` : ''}</p>
        ${countdown}
        <dl class="kv" style="margin-top:12px">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        ${b.reject_reason ? html`<p class="out" style="margin-top:12px">store: ${b.reject_reason}${b.suggestion ? `\nsuggest: ${b.suggestion}` : ''}</p>` : ''}
      </section>
      ${pass ? html`<section class="panel"><span class="panel__t">ENTRY PASS</span><p class="mcode__d" style="text-align:center;margin-top:8px">${b.code}</p><p class="mcode__t" style="text-align:center;margin-top:8px">出示给前台核验 · 会员另需出示会员卡</p></section>` : ''}
      <div class="section">${actions}</div>
      <section class="panel"><span class="panel__t">LOG</span><p class="out">${b.history.map(h => `${fmt.full(h.at)}  ${h.status}${h.note ? ' · ' + h.note : ''}`).join('\n')}</p></section>
    </main>`;
  }
  return html`${header('订单', 'Circulation slip', { back: 'me' })}<main class="main">
    <article class="slip">
      <div class="slip__h"><span>LIBRARY LIVE · 借阅单</span><span>${b.rules_version || 'v0.3'}</span></div>
      <p class="slip__code">${b.code}</p><p class="slip__sub">${b.label.zh}${b.label.note ? ` · ${b.label.note}` : ''}</p>
      <span class="stamp is-new ${b.status === 'confirmed' || b.status === 'fulfilled' ? 'stamp--green' : b.status === 'pending_confirm' || b.status === 'pending_payment' ? '' : 'stamp--purple'}">${b.label.deal}<small>${b.label.zh}</small></span>
      ${countdown}
      <div class="slip__rows">${rows.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>
      ${b.reject_reason ? html`<p class="note" style="opacity:1">门店：${b.reject_reason}${b.suggestion ? html`<br>建议：${b.suggestion}` : ''}</p>` : ''}
      ${pass ? html`<p class="note" style="opacity:.9">入场凭证：到店出示这张借阅单的编号 <b class="mono">${b.code}</b>，前台核验。</p>` : ''}
    </article>
    <div class="section btns">${actions}</div>
  </main>`;
}

/* ---------- me ---------- */
async function loadMe() {
  if (!S.me || !S.me.user) return {};
  const [orders, meetings] = await Promise.all([call('bookings.mine'), S.me.identity === 'member_active' ? call('meetings.mine') : Promise.resolve([])]);
  return { orders, meetings };
}
function demoPanel() {
  const personas = [['member', '会员 林知远'], ['non_member', '非会员'], ['applicant', '审核中'], ['need_info', '待补资料'], ['approved', '待付款'], ['invitee', '受邀人'], ['expired', '已到期']];
  const clocks = [['real', '现在'], ['14:00', '14:00 白天'], ['18:58', '18:58'], ['19:02', '19:02 入夜'], ['21:40', '21:40'], ['23:10', '23:10'], ['+10', '+10 分'], ['+31', '+31 分']];
  return html`<div class="demo"><p class="demo__k">Demo · 演示身份</p><div class="chips">${personas.map(([k, l]) => html`<button class="chip" data-act="persona" data-v="${k}">${l}</button>`)}</div>
    <p class="demo__k">Demo · 演示时钟（全站同步）</p><div class="chips">${clocks.map(([k, l]) => html`<button class="chip" data-act="clock" data-v="${k}">${l}</button>`)}</div></div>`;
}
function viewMe(d) {
  const me = S.me;
  if (!me.user) {
    return html`${masthead()}<main class="main">
      <section class="section"><div class="ccard"><div class="ccard__call"><span>READER’S CARD · 借书证</span><span>No. ————</span></div><p class="ccard__t">还没有登录</p><p class="ccard__p">用手机号登录后可以订座、购票、报名活动；会员通过邀请或申请审核入会。</p></div>
        <div class="btns" style="margin-top:14px"><a class="btn btn--block" href="#/login">登录</a><a class="btn btn--ghost btn--block" href="#/invite/SV-WELCOME">我有邀请</a></div></section>
      ${demoPanel()}</main>`;
  }
  return term() ? meTerminal(d) : meLibrary(d);
}
function meLibrary(d) {
  const me = S.me;
  const a = me.application;
  const ms = me.membership;
  let status;
  if (me.identity === 'applicant' && a.status === 'approved_awaiting_payment') {
    status = html`<div class="ccard"><div class="ccard__call"><span>APPLICATION</span><span>${a.label.en}</span></div><p class="ccard__t">审核通过</p>
      <p class="ccard__p">支付首月会员费 ${yuan(me.member_price)} 后会员立即生效，按自然月计算，之后每月主动续费，不自动扣款。会员费开通后的退款规则尚待确认。</p><span class="stamp stamp--green stamp--abs">Approved<small>已通过</small></span></div>
      <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="app-pay">支付 ${yuan(me.member_price)}（模拟）</button>`;
  } else if (me.identity === 'applicant') {
    status = html`<div class="ccard"><div class="ccard__call"><span>APPLICATION</span><span>${a.label.en}</span></div><p class="ccard__t">${a.label.zh}</p>
      <p class="ccard__p">${a.status === 'need_info' ? (a.review_note || '门店需要你补充资料。') : '门店会尽快审核。审核期间可按非会员规则订座、购票。'}</p>
      ${a.history.map(h => html`<p class="ccard__p mono" style="font-size:11.5px">${fmt.full(h.at)} · ${APP_STATUS[h.status].zh}</p>`)}
      <span class="stamp stamp--abs">${a.status === 'need_info' ? 'Need info' : 'In review'}<small>${a.status === 'need_info' ? '待补充' : '尽调中'}</small></span></div>
      ${a.status === 'need_info' ? html`<a class="btn btn--block" style="margin-top:12px" href="#/apply">补充资料</a>` : ''}`;
  } else if (me.identity === 'invitee') {
    status = html`<a class="btn btn--primary btn--block" href="#/invite/${me.invite.token}">打开邀请函 · 领取 ${me.invite.months} 个月会员</a>`;
  } else if (me.identity === 'member_expired') {
    status = html`<div class="ccard"><div class="ccard__call"><span>MEMBERSHIP · No.${me.user.member_no}</span><span>EXPIRED</span></div><p class="ccard__t">会员已于 ${fmt.date(ms.end_at)} 到期</p>
      <p class="ccard__p">${ms.can_renew ? `到期 30 天内续费，不需重新审核；续费后恢复会员界面与已解锁内容。` : '到期超过 30 天，需要重新申请。'}</p><span class="stamp stamp--purple stamp--abs">Expired<small>已到期</small></span></div>
      ${ms.can_renew ? html`<button class="btn btn--primary btn--block" style="margin-top:12px" data-act="renew">续费 ${yuan(me.member_price)} / 月（模拟）</button>` : html`<a class="btn btn--block" style="margin-top:12px" href="#/apply">重新申请</a>`}`;
  } else {
    status = html`<div class="btns"><a class="btn btn--block" href="#/apply">申请入会</a><a class="btn btn--ghost btn--block" href="#/invite/SV-WELCOME">我有邀请</a></div><p class="note">会员需要审核；推荐只作为来源记录。</p>`;
  }
  return html`${header('我的', 'Reader’s card')}<main class="main">
    <section class="section"><div class="ccard"><div class="ccard__call"><span>READER’S CARD · 借书证</span><span>${me.user.member_no ? `No.${me.user.member_no}` : 'No. ————'}</span></div>
      <p class="ccard__t">${me.user.name || '新读者'}</p><p class="ccard__p">${me.user.phone} · ${IDENTITIES[me.identity].zh}</p></div></section>
    <section class="section">${status}</section>
    <section class="section"><div class="sh"><b>我的预订</b><span>Slips</span></div>${d.orders && d.orders.length ? d.orders.map(orderCard) : html`<p class="empty">还没有预订。</p>`}</section>
    <section class="section"><button class="btn btn--ghost btn--block" data-act="logout">退出登录</button></section>
    ${demoPanel()}
    <p class="motto">图书馆的另一面，在入会之后。</p>
  </main>`;
}
function meTerminal(d) {
  const me = S.me;
  const ms = me.membership;
  const ph = store.get('sv.phosphor') || 'amber';
  const paper = store.get('sv.paper') || 'green';
  return html`${header('dossier')}<main class="main">
    <section class="section" style="margin-top:18px">
      <div class="pcard" data-act="flip" role="button" tabindex="0" aria-label="会员卡，点按翻面">
        <div class="pcard__flip">
          <div class="pcard__face"><span class="pcard__brand">STH.VENTURED · LIBRARY LIVE</span><span class="pcard__no">NO.${me.user.member_no}</span>${raw(punchCard(`SV-${me.user.member_no}-${(me.user.en || me.user.name).replace(/\s/g, '').toUpperCase()}`))}</div>
          <div class="pcard__face pcard__back"><small>THIS CARD OPENS EVERY DOOR OF STH.VENTURED</small><button class="pcard__ink" data-act="ink" type="button">THE BEST WAY TO PREDICT THE FUTURE IS TO INVENT IT.</button><small>valid until ${fmt.date(ms.end_at)}</small></div>
        </div>
      </div>
      <div class="mcode"><span class="mcode__d" data-mcode>------</span><span class="mcode__t">MEMBER CODE · 每 30 秒更新 · 给前台核验本人到场</span></div>
    </section>
    <section class="panel"><span class="panel__t" data-scramble>MEMBERSHIP</span><span class="panel__r">${ms.source}</span>
      <dl class="kv"><dt>no.</dt><dd>${me.user.member_no}</dd><dt>name</dt><dd>${me.user.name} ${me.user.en || ''}</dd><dt>valid</dt><dd>${fmt.date(ms.since)} → ${fmt.date(ms.end_at)}${ms.expiring_soon ? html` <span class="tag tag--warn">${ms.days_left}d left</span>` : ` · ${ms.days_left} 天`}</dd><dt>source</dt><dd>${ms.source === 'gift' ? '赠送（邀请领取）' : '付费'}</dd><dt>unlocked</dt><dd>${me.unlocked.length ? me.unlocked.join(' · ') : '—'}</dd></dl>
      <button class="btn btn--sm" style="margin-top:12px" data-act="renew">RENEW · 续费 ${yuan(me.member_price)}</button></section>
    <section class="panel"><span class="panel__t">ORDERS</span>${d.orders && d.orders.length ? html`<div class="ls">${d.orders.slice(0, 8).map(b => html`<a class="ls__r" href="#/order/${b.id}"><span class="ls__m">${fmt.mdOf(b.date)}</span><span class="ls__t">${zoneOf(b.zone).zh} · ${b.party_size} 人<small>${b.code} · ${b.label.zh}</small></span><span class="ls__a">${b.label.deal}</span></a>`)}</div>` : html`<p class="out">no orders yet.</p>`}</section>
    <section class="panel"><span class="panel__t">MEETINGS</span>${d.meetings && d.meetings.length ? html`<div class="ls">${d.meetings.slice(0, 6).map(meetingRow)}</div>` : html`<p class="out">none.</p>`}<button class="btn btn--sm" style="margin-top:10px" data-act="meeting-new">NEW REQUEST</button></section>
    <section class="panel"><span class="panel__t">DISPLAY</span><span class="panel__r">members only</span>
      <p class="out">phosphor (night)</p><div class="chips">${[['amber', 'P3 AMBER'], ['green', 'P1 GREEN'], ['ice', 'P4 ICE']].map(([v, l]) => html`<button class="chip" aria-pressed="${String(ph === v)}" data-act="phosphor" data-v="${v}">${l}</button>`)}</div>
      <p class="out" style="margin-top:8px">paper (day)</p><div class="chips">${[['green', 'GREEN-BAR'], ['blue', 'BLUE-BAR'], ['plain', 'PLAIN']].map(([v, l]) => html`<button class="chip" aria-pressed="${String(paper === v)}" data-act="paper" data-v="${v}">${l}</button>`)}</div></section>
    <section class="section"><button class="btn btn--ghost btn--block" data-act="logout">LOGOUT</button></section>
    ${demoPanel()}
    <p class="motto">tap the banner on the home screen five times.</p>
  </main>`;
}
let codeTimer = null;
function afterMe() {
  clearInterval(codeTimer);
  const el = $('[data-mcode]');
  if (!el || !S.me.secret) return;
  const tick = () => { if (!el.isConnected) return clearInterval(codeTimer); el.textContent = memberCode(S.me.secret, serverNow()); };
  tick();
  codeTimer = setInterval(tick, 1000);
}

/* ---------- content pages (P14) ---------- */
function viewContent(c) {
  if (c.locked) {
    const hint = c.rule ? RULE_HINT[c.rule] : '会员可见';
    if (term()) return html`${header(c.key, '', { back: 'home' })}<main class="main"><section class="panel"><span class="panel__t">LOCKED</span><p class="out">${c.teaser.title}\n\nPermission denied (layer ${c.layer}).\n${hint}</p></section></main>`;
    return html`${header('会员馆藏', 'Restricted', { back: 'home' })}<main class="main"><section class="section" style="margin-top:18px">${teaserCard(c)}
      <p class="note">会员内容只露出标题与一句话；正文在入会之后可见。</p>
      ${S.me.user ? html`<a class="btn btn--block" style="margin-top:14px" href="#/me">申请入会</a>` : html`<a class="btn btn--block" style="margin-top:14px" href="#/login">登录</a>`}</section></main>`;
  }
  const b = c.body;
  let body;
  if (c.key === 'memo') body = html`<pre class="fig fig--sm" style="margin:0 0 8px">${FIG.brand.join('\n')}</pre><p class="out" data-type>THE MEMO · ${b.issue}\n\n本周到访\n${b.visits.map(([n, t]) => `  * ${n}：${t}`).join('\n')}\n\n下周\n  ${b.next}\n\n书单\n${b.books.map(x => `  - ${x}`).join('\n')}\n\n${b.line}</p>`;
  else if (c.key === 'afterhours') body = html`<p class="out">AFTER HOURS · 只在入夜后出现\n</p><div class="ls">${b.drinks.map(([n, t]) => html`<div class="ls__r"><span class="ls__m">${n}</span><span class="ls__t">${t}</span><span></span></div>`)}</div><p class="out" style="margin-top:10px">${b.note}</p>`;
  else if (c.key === 'shelf') body = html`<p class="out">MY SHELF · 借过的书连成你的书单\n${b.mine.length ? b.mine.map(x => `  ${x.date}  ${x.title} — ${x.author}`).join('\n') : '  (empty)'}\n</p>
    <p class="out">${b.checked_in_today ? (b.borrowed_today ? '今天已经借过一本。' : '今天签到了，可以借一本：') : '今天还没签到。白天签到后可以借一本。'}</p>
    ${b.checked_in_today && !b.borrowed_today ? html`<div class="ls">${b.books.map(x => html`<button class="ls__r" data-act="borrow" data-id="${x.id}"><span class="ls__m">${x.id.toUpperCase()}</span><span class="ls__t">${x.title}<small>${x.author}</small></span><span class="ls__a">[BORROW]</span></button>`)}</div>` : ''}`;
  else if (c.key === 'recordings') body = html`<p class="out">RECORDINGS · 只给到过现场的人</p><div class="ls">${b.items.map(x => html`<div class="ls__r"><span class="ls__m">${x.date}</span><span class="ls__t">${x.title}<small>host ${x.host} · ${x.minutes} min</small></span><span class="ls__a" title="录音文件由运营上传">[&gt; PLAY]</span></div>`)}</div><p class="out dim" style="margin-top:8px">录音文件由运营上传后可播放。</p>`;
  else if (c.key === 'speakers') body = html`<p class="out">SPEAKERS · 讲者名录</p><div class="ls">${b.names.map(x => html`<div class="ls__r"><span class="ls__m">#${x.no}</span><span class="ls__t">${x.name} ${x.en}<small>${x.talks.join(' · ')}</small></span><span></span></div>`)}</div>`;
  else if (c.key === 'hidden-room') body = html`<pre class="out" style="white-space:pre">${[
    '   +--------------------------+',
    '   |  .--.                    |',
    '   | (    )   1957            |',
    '   |  `--\'    ______          |',
    '   |         |      |  []     |',
    '   |  []     |______|         |',
    '   |                    o     |',
    '   +-----------[    ]---------+',
  ].join('\n')}</pre><p class="out">${b.lines.join('\n')}</p>`;
  else body = html`<p class="out" data-type>${(b.lines || []).join('\n\n')}</p>`;
  return html`${header(c.key, '', { back: 'home' })}<main class="main"><section class="panel"><span class="panel__t" data-scramble>${c.teaser.title.split(' · ').pop().toUpperCase()}</span><span class="panel__r">L${c.layer}</span>${body}</section>
    <p class="motto">${c.layer >= 2 ? 'you found this by doing something, not by paying for it.' : 'members only.'}</p></main>`;
}
function afterContent() { $$('[data-type]', screenEl).forEach(el => typewrite(el)); }

/* ---------- login, apply, invite ---------- */
function viewLogin() {
  return html`${header('登录', 'The front desk', { back: 'home' })}<main class="main main--plain">
    <section class="section" style="margin-top:20px"><form class="ccard" data-form="login" novalidate style="padding-bottom:28px">
      <div class="ccard__call"><span>SIGN IN · 登录</span><span>LIBRARY LIVE</span></div>
      <label class="field" style="margin-top:12px"><span class="field__l">手机号</span><input class="input mono" name="phone" inputmode="numeric" autocomplete="tel" placeholder="138 0000 0007" maxlength="13"></label>
      <label class="field"><span class="field__l">验证码 <i>演示：${DEMO_CODE}</i></span><input class="input mono" name="code" inputmode="numeric" maxlength="4" placeholder="····" value=""></label>
      <p class="err" data-err></p>
      <button class="btn btn--block">登录</button>
      <p class="note">第一次登录会创建账号（非会员）。会员需要邀请或申请审核。</p>
    </form></section>
    ${demoPanel()}
  </main>`;
}
function viewApply() {
  const me = S.me;
  const p = (me.application && me.application.profile) || {};
  return html`${header('申请入会', 'Application', { back: 'me' })}<main class="main main--plain">
    <section class="section" style="margin-top:18px"><form class="ccard" data-form="apply" novalidate style="padding-bottom:28px">
      <div class="ccard__call"><span>APPLICATION · 入会申请</span><span>${me.application && me.application.status === 'need_info' ? 'NEED INFO' : 'NEW'}</span></div>
      ${me.application && me.application.review_note ? html`<p class="ccard__p" style="color:#A3353A">门店：${me.application.review_note}</p>` : ''}
      <label class="field" style="margin-top:10px"><span class="field__l">姓名 / 称呼 <i>*</i></span><input class="input" name="name" maxlength="30" value="${p.name || me.user.name || ''}"></label>
      <label class="field"><span class="field__l">手机号 <i>*</i></span><input class="input mono" name="phone" inputmode="numeric" maxlength="13" value="${(p.phone || '').replace(/^(\d{3})(\d{4})(\d{4})$/, '$1 $2 $3')}" placeholder="${me.user.phone}"></label>
      <label class="field"><span class="field__l">所在城市 <i>*</i></span><input class="input" name="city" maxlength="20" value="${p.city || me.user.city || '杭州'}"></label>
      <label class="field"><span class="field__l">公司 / 项目与角色 <i>*</i></span><input class="input" name="company_role" maxlength="60" value="${p.company_role || me.user.company_role || ''}" placeholder="例：远望机器人 · 创始人"></label>
      <label class="field"><span class="field__l">简短自我介绍</span><textarea class="ta" name="intro" maxlength="300">${p.intro || ''}</textarea></label>
      <label class="field"><span class="field__l">推荐来源 <i>选填 · 只作记录</i></span><input class="input" name="referrer" maxlength="30" value="${p.referrer || ''}"></label>
      <p class="err" data-err></p>
      <button class="btn btn--block">${me.application && me.application.status === 'need_info' ? '提交补充资料' : '提交申请'}</button>
      <p class="note">审核通过后支付首月 ${yuan(me.member_price)}，会员立即生效；之后按月主动续费。</p>
    </form></section></main>`;
}
function viewInvite(inv) {
  const me = S.me;
  let cta;
  if (inv.status === 'claimed') cta = inv.mine ? html`<a class="btn btn--block" href="#/home">已领取 · 进入会员层</a>` : html`<button class="btn btn--ghost btn--block" disabled>这张邀请已被领取</button>`;
  else if (inv.status === 'expired') cta = html`<button class="btn btn--ghost btn--block" disabled>已过领取期</button>`;
  else if (inv.status === 'disabled') cta = html`<button class="btn btn--ghost btn--block" disabled>这张邀请已停用</button>`;
  else if (!me.user) cta = html`<a class="btn btn--block" href="#/login?next=invite/${inv.token}">登录后领取</a>`;
  else if (me.identity === 'member_active') cta = html`<a class="btn btn--ghost btn--block" href="#/home">你已经是会员</a>`;
  else if (!inv.for_me) cta = html`<button class="btn btn--ghost btn--block" disabled>这张邀请是给另一位朋友的</button>`;
  else cta = html`<button class="btn btn--stamp btn--block" data-act="claim" data-id="${inv.token}">拆开 · 领取 ${inv.months} 个月会员</button>`;
  return html`${header('邀请函', 'An invitation', { back: 'home' })}<main class="main main--plain">
    <div class="envelope"><svg class="envelope__seal"><use href="#i-seal"/></svg><p class="envelope__k">sth.ventured · invitation</p>
      <p class="envelope__t">${inv.note}</p><p class="envelope__p">赠送 ${inv.months} 个自然月会员，领取当天开始。<br>最晚领取日 ${fmt.date(inv.deadline)}。邀请码 <span class="mono">${inv.token}</span></p></div>
    <section class="section">${cta}<p class="note">领取后与付费会员权益相同；到期后 ${yuan(S.me.member_price)} / 月，主动续费，不自动扣款。</p></section>
  </main>`;
}

/* ---------- sheets ---------- */
function sheetNotices({ items }) {
  return { label: '通知', tall: true, body: html`<div class="sheet__h"><span>Notices · 通知</span><b>${term() ? '/var/mail' : '来信'}</b></div>
    ${items ? (items.length ? html`<div class="ls">${items.map(n => html`<div class="ls__r"><span class="ls__m">${fmt.rel(n.at, serverNow())}</span><span class="ls__t">${n.read ? '' : '● '}${n.title}<small>${n.body}</small></span><span></span></div>`)}</div>` : html`<p class="empty">暂时没有通知。</p>`) : html`<p class="empty">…</p>`}` };
}
function sheetCheckin({ status, result, code, companions }) {
  if (!status) return { body: html`<p class="empty">…</p>` };
  if (S.me.identity !== 'member_active') return { label: '签到', body: html`<div class="sheet__h"><b>签到是会员功能</b></div><p class="note">白天为会员时间，非会员白天不开放。</p>` };
  if (status.mode !== 'day') return { label: '签到', body: html`<div class="sheet__h"><span>CHECK-IN</span><b>现在不是日间时段</b></div><p class="out" style="text-align:center">签到码只在白天（10:00–19:00）有效。</p>` };
  const done = result || (status.checked_in ? { at: status.at, companions: status.companions, repeat: true } : null);
  if (done) {
    const p = fmt.parts(done.at);
    return { label: '签到成功', body: html`<div class="sheet__h"><span>${done.repeat && !result ? 'ALREADY IN' : 'CHECKED IN'}</span><b>${done.repeat && !result ? '今天已经签过了' : '欢迎回来'}</b></div>
      <div style="text-align:center"><pre class="dstamp">${`LIBRARY LIVE\n\n ${p.d} ${p.mon} ${p.y}\n\n  IN ${fmt.time(done.at)}\n  +${done.companions} GUESTS`}</pre></div>
      <p class="out" style="margin-top:14px;text-align:center">${status.status}</p>
      ${result && result.unlocked && result.unlocked.includes('shelf') ? html`<a class="btn btn--primary btn--block" style="margin-top:16px" href="#/content/shelf">UNLOCKED · 借阅书单</a>` : ''}` };
  }
  return {
    label: '签到',
    body: html`<div class="sheet__h"><span>CHECK-IN · ${status.date}</span><b>扫门口今天的签到码</b></div>
      <div style="text-align:center"><pre class="dstamp" aria-label="今天的签到图案">${stampText(stampPattern(status.demo_code))}</pre></div>
      <p class="note" style="text-align:center">签到码每天一换，像图书馆的日戳。真实小程序里直接扫码；这里输入图案下方的 4 位码。</p>
      <label class="field"><span class="field__l">签到码 <i>演示：${status.demo_code}</i></span><input class="input" data-bind="ciCode" maxlength="4" value="${code || ''}" style="text-transform:uppercase;letter-spacing:.3em"></label>
      <div class="row2"><div><b>同行人数</b><small>朋友不用注册、不用签到</small></div><span class="stepper"><button type="button" data-act="ci-comp" data-d="-1" ${raw((companions || 0) <= 0 ? 'disabled' : '')}>${icon('minus')}</button><output>${companions || 0}</output><button type="button" data-act="ci-comp" data-d="1">${icon('plus')}</button></span></div>`,
    foot: html`<div class="btns btns--2"><button class="btn btn--ghost" data-act="ci-fill">读取门口的码</button><button class="btn btn--primary" data-act="ci-submit">签到</button></div>`,
  };
}
function sheetMeeting({ v }) {
  v = v || {};
  const days = Array.from({ length: 8 }, (_, i) => new Date(serverNow() + i * 864e5 + 8 * 36e5).toISOString().slice(0, 10));
  const times = []; for (let h = 10; h <= 19; h++) for (const m of ['00', '30']) if (!(h === 19 && m === '30')) times.push(`${pad(h)}:${m}`);
  const opt = (list, cur) => list.map(t => `<option value="${t}"${t === cur ? ' selected' : ''}>${t}</option>`).join('');
  return {
    label: '会议申请', tall: true,
    body: html`<div class="sheet__h"><span>MEETING REQUEST · 零支付</span><b>多人会议，提前申请</b></div>
      <form data-form="meeting" novalidate>
        <label class="field"><span class="field__l">日期</span><select class="sel" name="date">${raw(days.map(d => `<option value="${d}"${d === v.date ? ' selected' : ''}>${d} ${fmt.dowOf(d)}</option>`).join(''))}</select></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label class="field"><span class="field__l">开始</span><select class="sel" name="start">${raw(opt(times, v.start || '14:00'))}</select></label><label class="field"><span class="field__l">结束 <i>≤ 19:00</i></span><select class="sel" name="end">${raw(opt(times, v.end || '16:00'))}</select></label></div>
        <label class="field"><span class="field__l">人数</span><input class="input" name="party_size" type="number" min="2" max="30" value="${v.party_size || 6}"></label>
        <label class="field"><span class="field__l">需求</span><input class="input" name="needs" maxlength="200" placeholder="例：需要投影和白板" value="${v.needs || ''}"></label>
        <p class="err" data-err></p>
        <button class="btn btn--primary btn--block">提交申请</button>
        <p class="note">门店会接受、拒绝或提议调整；调整需要你确认。会议不能跨过 19:00。</p>
      </form>`,
  };
}
const SHEETS = { event: sheetEvent, booking: sheetBooking, pay: sheetPay, notices: sheetNotices, checkin: sheetCheckin, meeting: sheetMeeting };
function openSheet(type, props = {}) {
  S.sheet = { type, ...props };
  renderSheet();
  requestAnimationFrame(() => requestAnimationFrame(() => sheetEl.classList.add('is-open')));
}
function renderSheet() {
  if (!S.sheet) return;
  const prev = $('.sheet__b', sheetEl);
  const keep = prev ? prev.scrollTop : 0;
  const focusKey = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind;
  const v = SHEETS[S.sheet.type](S.sheet);
  sheetEl.innerHTML = html`<div class="scrim" data-act="sheet-close"></div><section class="sheet ${v.tall ? 'sheet--tall' : ''}" role="dialog" aria-modal="true" aria-label="${v.label || ''}">
    <div class="sheet__grab"></div><button class="ibtn sheet__x" data-act="sheet-close" aria-label="关闭">${icon('close')}</button>
    <div class="sheet__b">${v.body}</div>${v.foot ? html`<div class="sheet__f">${v.foot}</div>` : ''}</section>`.s;
  const b = $('.sheet__b', sheetEl);
  if (b) b.scrollTop = keep;
  if (focusKey) { const el = $(`[data-bind="${focusKey}"]`, sheetEl); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* number inputs */ } } }
}
function closeSheet() {
  sheetEl.classList.remove('is-open');
  S.sheet = null;
  setTimeout(() => { if (!S.sheet) sheetEl.innerHTML = ''; }, 420);
}

/* ---------- overlays: the unlock, the donut ---------- */
function playUnlock() {
  if (overlayEl.dataset.played) return;
  overlayEl.dataset.played = '1';
  overlayEl.hidden = false;
  overlayEl.className = 'overlay';
  const me = S.me;
  overlayEl.innerHTML = html`<div class="overlay__in"><pre id="dec"></pre><p class="overlay__l">LAYER 1 · MEMBER #${me.user.member_no}<br>欢迎来到图书馆的机器层</p></div><button class="overlay__skip" data-act="unlock-skip">SKIP ›</button>`.s;
  const lines = [...FIG.access, '', ...FIG.granted];
  const done = () => {
    call('unlock.seen').catch(() => {});
    setTimeout(() => { overlayEl.hidden = true; overlayEl.innerHTML = ''; }, 500);
  };
  S.unlockFinish = decrypt($('#dec'), lines, { duration: 2400, onDone: done });
}
let stopDonut = null;
function showDonut() {
  overlayEl.hidden = false;
  overlayEl.className = 'overlay overlay--donut';
  overlayEl.innerHTML = html`<div class="overlay__in"><pre id="donut"></pre><p class="overlay__l">donut.c · Andy Sloane, 2006<br>tap anywhere to close</p></div>`.s;
  stopDonut = donut($('#donut'));
  overlayEl.onclick = () => { stopDonut && stopDonut(); overlayEl.hidden = true; overlayEl.innerHTML = ''; overlayEl.onclick = null; };
}
async function trigger(key) {
  try {
    const r = await call('egg.trigger', { key });
    navigator.vibrate?.(30);
    toast(r.fresh ? `解锁 · ${r.title}` : r.title);
    if (key === 'hidden-room') go('content/hidden-room');
    return r;
  } catch (e) { toast(e.message, 'error'); return null; }
}

/* ---------- actions ---------- */
async function busy(el, fn) { el?.classList.add('is-busy'); try { return await fn(); } finally { el?.classList.remove('is-busy'); } }
function handleError(e, errEl) {
  if (e && e.code === 'auth') { auth.clear(); toast('请重新登录', 'error'); go('login'); return; }
  const msg = (e && e.message) || '出了点问题';
  if (errEl) errEl.textContent = msg; else toast(msg, 'error');
}
const ACTIONS = {
  'sheet-close': () => closeSheet(),
  notices: async () => {
    openSheet('notices', { items: null });
    try { const items = await call('notices.list'); if (S.sheet && S.sheet.type === 'notices') { S.sheet.items = items; renderSheet(); } await call('notices.read'); S.me.unread = 0; } catch (e) { handleError(e); }
  },
  fig: () => {
    const t = Date.now();
    S.ui.figTaps = [...S.ui.figTaps.filter(x => t - x < 2500), t];
    if (S.ui.figTaps.length >= 5) { S.ui.figTaps = []; showDonut(); }
  },
  'ev-filter': d => { S.ui.evFilter = d.v; render(); },
  event: d => openSheet('event', { id: d.id }),
  'event-register': (d, el) => busy(el, async () => {
    try { await call('event.register', { id: d.id }); toast('已报名'); await refreshRoute(); renderSheet(); } catch (e) { handleError(e); }
  }),
  'event-cancel': (d, el) => busy(el, async () => {
    try { await call('event.cancel', { id: d.id }); toast('已取消报名'); await refreshRoute(); renderSheet(); } catch (e) { handleError(e); }
  }),
  date: async d => { S.ui.session = d.id; S.ui.zone = null; await refreshRoute(); },
  layout: d => { S.ui.layout = d.v; render(); },
  zone: d => selectZone(d.id),
  'book-zone': d => {
    S.ui.zone = d.id; S.ui.extra = 0; S.ui.note = ''; S.ui.explanation = ''; S.ui.quote = null; S.ui.quoteErr = null;
    const z = S.data.book.map.zones.find(x => x.id === d.id);
    S.ui.party = Math.min(S.ui.party || 2, z.kind === 'booth' ? 30 : 4);
    openSheet('booking');
    requote();
  },
  party: d => { S.ui.party = Math.max(1, Math.min(40, S.ui.party + Number(d.d))); renderSheet(); requote(); },
  extra: d => { S.ui.extra = Math.max(0, Math.min(2, S.ui.extra + Number(d.d))); renderSheet(); requote(); },
  'book-submit': (d, el) => busy(el, async () => {
    const map = S.data.book.map;
    try {
      const b = await call('booking.create', { session_id: map.session.id, zone: S.ui.zone, party_size: S.ui.party, extra: S.ui.extra, note: S.ui.note, explanation: S.ui.explanation });
      if (b.status === 'pending_payment') { S.sheet = null; openSheet('pay', { booking: b }); }
      else { closeSheet(); go(`order/${b.id}`); }
    } catch (e) {
      S.ui.quoteErr = e.message + (e.rule ? `（${e.rule}）` : '');
      renderSheet();
      if (e.code === 'conflict') { toast('刚被订走，地图已刷新', 'error'); await refreshRoute(); }
    }
  }),
  'pay-open': async d => { try { const b = await call('booking.get', { id: d.id }); openSheet('pay', { booking: b }); } catch (e) { handleError(e); } },
  pay: (d, el) => busy(el, async () => {
    try { const b = await call('booking.pay', { id: d.id }); closeSheet(); navigator.vibrate?.(20); go(`order/${b.id}`); toast(b.status === 'confirmed' ? '已交割 · 预订成功' : b.status === 'pending_confirm' ? '已付款 · 尽调中，等门店确认' : b.label.zh); } catch (e) { handleError(e); }
  }),
  'pay-cancel': (d, el) => busy(el, async () => { try { await call('booking.abandon', { id: d.id }); closeSheet(); toast('订单已取消，桌位已释放'); await refreshRoute(); } catch (e) { handleError(e); } }),
  rebook: async d => {
    const b = S.data.order;
    S.ui.session = b.session.id;
    S.ui.zone = b.suggestion_zone || b.zone;
    S.ui.party = b.party_size;
    go(`book?zone=${S.ui.zone}`);
  },
  flip: (d, el) => el.classList.toggle('is-flipped'),
  ink: async (d, el) => { const r = await trigger('ink'); if (r) el.classList.add('is-shown'); },
  borrow: (d, el) => busy(el, async () => { try { await call('shelf.borrow', { id: d.id }); toast('借好了，记在你的书单上'); await refreshRoute(); } catch (e) { handleError(e); } }),
  checkin: async () => {
    openSheet('checkin', { status: null, code: '', companions: 0 });
    try { const status = await call('checkin.today'); if (S.sheet && S.sheet.type === 'checkin') { S.sheet.status = status; renderSheet(); } } catch (e) { handleError(e); }
  },
  'ci-fill': () => { S.sheet.code = S.sheet.status.demo_code; renderSheet(); },
  'ci-comp': d => { S.sheet.companions = Math.max(0, Math.min(20, (S.sheet.companions || 0) + Number(d.d))); renderSheet(); },
  'ci-submit': (d, el) => busy(el, async () => {
    try {
      const r = await call('checkin.submit', { code: S.sheet.code, companions: S.sheet.companions || 0 });
      const status = await call('checkin.today').catch(() => S.sheet.status);
      S.sheet.result = r; S.sheet.status = status; renderSheet(); navigator.vibrate?.(30);
      await refreshMe();
      if (S.route === 'home') refreshRoute();
    } catch (e) { handleError(e); }
  }),
  'meeting-new': () => openSheet('meeting', {}),
  'meeting-respond': (d, el) => busy(el, async () => { try { await call('meeting.respond', { id: d.id, accept: d.v === '1' }); toast('已确认新的时间'); await refreshRoute(); } catch (e) { handleError(e); } }),
  persona: async (d, el) => {
    try { const r = await call('auth.demo', { as: d.v }); auth.set(r.token); overlayEl.dataset.played = ''; S.data = {}; toast(`已切换：${el.textContent.trim()}`); home(); } catch (e) { handleError(e); }
  },
  clock: async d => {
    const v = d.v;
    const args = v === 'real' ? { action: 'real' } : v.startsWith('+') ? { action: 'plus', minutes: Number(v.slice(1)) } : { action: 'set', hhmm: v };
    try { const r = await call('demo.clock', args); toast(`演示时钟 → ${fmt.md(r.now)} ${fmt.dow(r.now)} ${fmt.time(r.now)} · ${r.mode}`); await refreshRoute(); } catch (e) { handleError(e); }
  },
  phosphor: d => { store.set('sv.phosphor', d.v === 'amber' ? null : d.v); applySkin(); render(); },
  paper: d => { store.set('sv.paper', d.v === 'green' ? null : d.v); applySkin(); render(); },
  renew: (d, el) => busy(el, async () => { if (!confirm(`续费 ${yuan(S.me.member_price)}（模拟支付）？`)) return; try { const r = await call('membership.renew'); toast(`续费成功，有效期至 ${fmt.date(r.end_at)}`); await refreshRoute(); } catch (e) { handleError(e); } }),
  'app-pay': (d, el) => busy(el, async () => { try { await call('application.pay'); toast('欢迎入会'); S.data = {}; overlayEl.dataset.played = ''; home(); } catch (e) { handleError(e); } }),
  claim: (d, el) => busy(el, async () => { try { await call('invite.claim', { token: d.id }); overlayEl.dataset.played = ''; S.data = {}; home(); } catch (e) { handleError(e); } }),
  logout: async () => { try { await call('auth.logout'); } catch { /* ignore */ } auth.clear(); S.data = {}; home(); },
  'unlock-skip': () => S.unlockFinish && S.unlockFinish(),
};

const FORMS = {
  login: async (form, fd) => {
    const err = $('[data-err]', form);
    err.textContent = '';
    try {
      const r = await call('auth.login', { phone: fd.get('phone'), code: fd.get('code') });
      auth.set(r.token);
      overlayEl.dataset.played = '';
      S.data = {};
      go(S.params.next || 'home');
    } catch (e) { handleError(e, err); }
  },
  apply: async (form, fd) => {
    const err = $('[data-err]', form);
    err.textContent = '';
    try {
      await call(S.me.application && S.me.application.status === 'need_info' ? 'application.update' : 'application.submit', Object.fromEntries(fd));
      toast('已提交 · 尽调中');
      go('me');
    } catch (e) { handleError(e, err); }
  },
  meeting: async (form, fd) => {
    const err = $('[data-err]', form);
    try {
      await call('meeting.create', Object.fromEntries(fd));
      closeSheet(); toast('已提交，等门店回复');
      await refreshRoute();
    } catch (e) { handleError(e, err); S.sheet.v = Object.fromEntries(fd); }
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('[disabled]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][role="button"]:not(button)')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form, new FormData(form));
});
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind) return;
  if (el.dataset.bind === 'ciCode') { S.sheet.code = el.value.toUpperCase(); return; }
  S.ui[el.dataset.bind] = el.value;
  if (S.sheet && S.sheet.type === 'booking') requote();
});

/* countdowns everywhere (pay locks, the 30-minute confirmation) */
setInterval(() => {
  const now = serverNow();
  $$('[data-countdown]').forEach(el => {
    const left = Math.max(0, Date.parse(el.dataset.countdown) - now);
    el.textContent = `${pad(Math.floor(left / 60e3))}:${pad(Math.floor((left % 60e3) / 1e3))}`;
    if (left === 0 && !el.dataset.fired) { el.dataset.fired = '1'; setTimeout(refreshRoute, 1500); }
  });
  $$('[data-ring]').forEach(el => {
    const left = Math.max(0, Date.parse(el.dataset.ring) - now);
    el.style.strokeDashoffset = String(188.5 * (1 - left / Number(el.dataset.span)));
  });
}, 1000);

/* ---------- live updates ---------- */
async function refreshRoute() {
  const def = ROUTES[S.route];
  if (!def) return;
  try {
    const [, data] = await Promise.all([refreshMe(), def.load ? def.load() : Promise.resolve(undefined)]);
    if (def.load) S.data[S.route] = data;
    const typing = document.activeElement && document.activeElement.matches('input, textarea, select') && screenEl.contains(document.activeElement);
    if (!typing) render();
    if (S.sheet && S.sheet.type === 'event') renderSheet();
  } catch (e) { if (e.code === 'auth') handleError(e); }
}
const refresh = debounce(refreshRoute, 300);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
setInterval(async () => { // the house changes at 19:00 even if nobody touches anything
  if (document.visibilityState !== 'visible' || !S.me) return;
  try { const m = await call('me'); if (m.mode !== S.me.mode || m.identity !== S.me.identity) refresh(); } catch { /* offline */ }
}, 30e3);

/* ---------- boot ---------- */
async function boot() {
  await connect({ tokenKey: 'sv.v2.token' });
  try { await refreshMe(); } catch { auth.clear(); await refreshMe(); }
  onChange(() => refresh());
  addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
