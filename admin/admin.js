/* =========================================================
   library live · back office (MVP)
   Three jobs for the store: confirm bookings and assign tables,
   run the daytime roundtables, send membership invitations.
   Same core as the member app; changes show up on both sides live.
   ========================================================= */
import { connect, call, auth, onChange } from '../shared/api.js';
import { html, raw, fmt, toast, debounce } from '../shared/ui.js';
import { yuan, hz, hzDate, addDays, DEMO_PIN } from '../shared/core.js';
import { zoneOf, RESOURCES } from '../shared/plan.js';

const $ = (s, el = document) => el.querySelector(s);
const rootEl = $('#root');
const modalEl = $('#modal');
const pad = n => String(n).padStart(2, '0');

const S = {
  staff: null, staffList: [], page: null, data: null, badges: {}, skew: 0, offset: 0, modal: null,
  ui: { session: null, verify: null, lastInvite: null, loginStaff: 'st1' },
};
const serverNow = () => Date.now() + S.skew;
const isAdmin = () => S.staff && S.staff.role === 'admin';

/* ---------- words ---------- */
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pdate = date => hz(Date.parse(`${date}T12:00:00+08:00`));
const md = date => { const x = pdate(date); return `${x.m}月${x.d}日`; };
const dayLabel = date => `${md(date)} ${WD[pdate(date).dow]}`;
const when = t => `${dayLabel(hzDate(t))} ${fmt.time(t)}`;
const STATUS = {
  pending_payment: ['warn', '待支付'], pending_confirm: ['warn', '待确认'], confirmed: ['ok', '已确认'], fulfilled: ['brand', '已到店'],
  rejected: ['danger', '已拒绝'], confirm_timeout_closed: ['', '超时关闭'], payment_expired: ['', '已取消'], cancelled: ['', '已取消'], no_show: ['', '未到店'],
};
const badge = ([k, t]) => html`<span class="badge ${k ? `badge--${k}` : ''}">${t}</span>`;
const IDN = { member_active: '会员', non_member: '非会员', invitee: '受邀人', applicant: '非会员', member_expired: '会员已到期' };
const tablesOf = b => (b.lines || []).map(l => (b.kind === 'booth' ? `${l.code}` : `${l.code}×${l.seats}`)).join('、') || '—';
const who = u => (u ? html`${u.name || '（未填姓名）'}<small>${u.phone || ''}${u.member_no ? ` · 会员 No.${u.member_no}` : ''}</small>` : '—');
const left = t => { const ms = Math.max(0, Date.parse(t) - serverNow()); return `${pad(Math.floor(ms / 60e3))}:${pad(Math.floor((ms % 60e3) / 1e3))}`; };
const inviteLink = t => `${location.origin}${location.pathname.replace(/admin\/(index\.html)?$/, '')}app/#/invite/${t}`;

/* ---------- pages ---------- */
const PAGES = {
  orders: { title: '订单', load: loadOrders, view: viewOrders },
  talks: { title: '座谈', load: loadTalks, view: viewTalks },
  invites: { title: '邀请', load: () => call('admin.invites'), view: viewInvites },
  demo: { title: '演示', load: () => call('demo.state'), view: viewDemo },
};

async function boot() {
  await connect({ tokenKey: 'sv.admin.v3.token' });
  if (auth.token) { try { S.staff = await call('admin.me'); } catch { auth.clear(); } }
  S.staffList = await call('staff.list').catch(() => []);
  await syncClock();
  onChange(() => refresh());
  addEventListener('hashchange', route);
  setInterval(tick, 1000);
  setInterval(async () => { if (await syncClock()) refresh(); }, 15e3);
  if (!S.staff) return viewLogin();
  route();
}

function viewLogin() {
  rootEl.innerHTML = html`<div class="login"><div class="card">
    <h1>library live 后台</h1><p>员工登录</p>
    <form data-form="login">
      <label class="field"><span>你是</span><select class="select" name="staff">${S.staffList.map(s => html`<option value="${s.id}" ${raw(s.id === S.ui.loginStaff ? 'selected' : '')}>${s.name}（${s.title}）</option>`)}</select></label>
      <label class="field"><span>PIN</span><input class="input" name="pin" inputmode="numeric" maxlength="4" autocomplete="off" required></label>
      <p class="err" data-err></p>
      <button class="btn">登录</button>
      <p class="small" style="margin-top:12px">演示 PIN：${DEMO_PIN}</p>
    </form></div></div>`.s;
  $('[name="pin"]').focus();
}

function shell() {
  if ($('.topbar')) return;
  rootEl.innerHTML = html`<header class="topbar"><div class="topbar__in">
      <span class="brand">library live<span>后台</span></span>
      <nav class="nav" id="nav" aria-label="后台导航"></nav>
      <div class="who"><span class="clock" id="clock"></span><b>${S.staff.name}</b><button class="linkbtn" data-act="logout">退出</button></div>
    </div></header>
    <main class="page" id="page"></main>`.s;
  renderClock();
}
function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  nav.innerHTML = Object.entries(PAGES).map(([k, p]) => html`<a href="#/${k}" ${raw(S.page === k ? 'aria-current="page"' : '')}>${p.title}${k === 'orders' && S.badges.confirms ? html`<span class="count">${S.badges.confirms}</span>` : ''}</a>`.s).join('');
}

async function route() {
  if (!S.staff) return;
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  const page = PAGES[name] ? name : 'orders';
  if (page !== name) history.replaceState(null, '', `#/${page}`);
  const fresh = S.page !== page;
  S.page = page;
  shell();
  renderNav();
  document.title = `${PAGES[page].title} · library live 后台`;
  if (fresh) { S.data = null; $('#page').innerHTML = '<p class="loading" style="padding:80px 0">加载中…</p>'; closeModal(); }
  await load();
  loadBadges();
}
let seq = 0;
async function load() {
  const n = ++seq;
  try {
    const data = await PAGES[S.page].load();
    if (n !== seq) return;
    S.data = data;
    render();
  } catch (e) { if (n === seq) fail(e); }
}
function render() {
  const el = $('#page');
  if (!el || !S.data) return;
  const y = window.scrollY;
  el.innerHTML = PAGES[S.page].view(S.data).s;
  window.scrollTo(0, y);
  tick();
}
async function loadBadges() { try { S.badges = await call('admin.badges'); renderNav(); } catch { /* not fatal */ } }

const refresh = debounce(async () => {
  if (!S.staff || !S.page) return;
  loadBadges();
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select')) return;
  await load();
  if (S.modal && S.modal.refresh) S.modal.refresh();
}, 300);

/* ---------- clock (follows the demo clock) ---------- */
async function syncClock() {
  try {
    const r = await call('demo.state');
    const was = S.offset;
    S.skew = Date.parse(r.now) - Date.now();
    S.offset = r.offsetMs;
    renderClock();
    return was !== S.offset;
  } catch { return false; }
}
function renderClock() {
  const el = $('#clock');
  if (!el) return;
  el.className = `clock${S.offset ? ' is-demo' : ''}`;
  el.textContent = `${S.offset ? '演示时间 ' : ''}${when(serverNow())}`;
}
function tick() {
  document.querySelectorAll('[data-countdown]').forEach(el => {
    const ms = Math.max(0, Date.parse(el.dataset.countdown) - serverNow());
    el.textContent = left(el.dataset.countdown);
    el.closest('.qcard')?.classList.toggle('is-urgent', ms < 5 * 60e3);
  });
  if (new Date().getSeconds() === 0) renderClock();
}

/* ---------- orders ---------- */
async function loadOrders() {
  const [wb, board] = await Promise.all([call('admin.workbench'), call('admin.board', { session_id: S.ui.session || undefined })]);
  S.ui.session = board.session.id;
  return { wb, board };
}
function verifyResult() {
  const r = S.ui.verify;
  if (!r) return '';
  if (r.error) return html`<div class="result result--err">${r.error}</div>`;
  if (r.kind === 'member') return html`<div class="result result--ok"><b>会员 ${r.member.name}</b> · No.${r.member.member_no} · 有效期至 ${fmt.date(r.member.membership.end_at)}${r.bookings.length ? ` · 今晚订单 ${r.bookings.map(b => b.code).join('、')}` : ' · 今晚没有订单'}</div>`;
  const b = r.booking;
  const u = b.user || {};
  return html`<div class="result ${r.repeat ? 'result--warn' : 'result--ok'}"><b>${r.repeat ? '这张凭证已经核验过' : '核验通过，请入场'}</b> · ${u.name || ''} · ${zoneOf(b.zone).zh} ${tablesOf(b)} · ${b.party_size} 人${b.verified_at ? ` · ${fmt.time(b.verified_at)} 入场` : ''}${b.deposit ? ` · 订金 ${yuan(b.deposit.paid)} 可抵扣当晚消费` : ''}${b.ticket ? ` · 门票 ${b.ticket.count} 张（含赠饮）` : ''}</div>`;
}
function qcard(b) {
  const z = zoneOf(b.zone);
  const urgent = Date.parse(b.confirm_deadline_at) - serverNow() < 5 * 60e3;
  const paid = b.payment && b.payment.status === 'paid' ? `${b.payment.kind === 'deposit' ? '订金' : '门票'} ${yuan(b.payment.amount)} 已付` : '无预付';
  return html`<div class="qcard ${urgent ? 'is-urgent' : ''}">
    <div><h3>${z.zh} · ${b.party_size} 人<span class="mono">${b.code}</span></h3>
      <p>${dayLabel(b.date)} ${b.session ? b.session.show_start : ''} · ${b.kind === 'booth' ? `需要 ${b.units} 张卡座` : `座位 ${tablesOf(b)}`} · ${paid}</p>
      <p>${b.user ? `${b.user.name || '（未填姓名）'} ${b.user.phone}` : ''} · ${IDN[b.identity_snapshot] || b.identity_snapshot}</p>
      ${b.note ? html`<p class="note">客人备注：${b.note}</p>` : ''}</div>
    <div class="qcard__side"><span class="timer">剩 <span data-countdown="${b.confirm_deadline_at}">${left(b.confirm_deadline_at)}</span> 需确认</span>
      <div class="btns"><button class="btn" data-act="confirm" data-id="${b.id}">确认</button><button class="btn btn--danger-outline" data-act="reject" data-id="${b.id}">拒绝</button></div></div>
  </div>`;
}
function viewOrders({ wb, board }) {
  const s = board.session;
  const tonightId = wb.session ? wb.session.id : null;
  const tonight = s.id === tonightId;
  const nights = board.sessions.filter(x => !wb.session || x.date >= wb.session.date);
  const rows = board.bookings.slice().sort((a, b) => a.status.localeCompare(b.status) || b.created_at.localeCompare(a.created_at));
  return html`<div class="page__h"><div><h1>订单</h1><p>客人按区域订座，门店确认时安排具体桌号。</p></div></div>
    <div class="card"><form class="verify" data-form="verify" autocomplete="off"><input class="input" name="code" placeholder="输入入场凭证，如 LL-7K2Q" aria-label="入场凭证"><button class="btn">核验入场</button><span class="small">会员码（6 位数字）也可以</span></form>${verifyResult()}</div>
    <section class="section"><div class="section__h"><h2>待确认 ${wb.pending.length ? `（${wb.pending.length}）` : ''}</h2><span class="small">卡座、多桌和带备注的订单需要在 30 分钟内确认，超时自动关闭并退款</span></div>
      ${wb.pending.length ? html`<div class="queue">${wb.pending.map(qcard)}</div>` : html`<div class="empty">没有待确认的订单</div>`}</section>
    <section class="section"><div class="section__h"><h2>按日期查看</h2></div>
      <div class="dates">${nights.map(x => html`<button class="date" aria-pressed="${String(x.id === s.id)}" data-act="session" data-id="${x.id}">${x.id === tonightId ? '今晚' : md(x.date)}<small>${WD[pdate(x.date).dow]}${x.status !== 'on_sale' ? ' · 暂停' : ''}</small></button>`)}</div>
      <div class="zones">${board.zones.map(z => html`<div class="zonebox ${z.free <= 0 ? 'is-full' : ''}"><b>${zoneOf(z.id).zh}</b><span>${z.free <= 0 ? '已满' : `剩 ${z.free}/${z.total} ${z.unit === 'seat' ? '座' : '桌'}`}</span></div>`)}</div>
      ${rows.length ? html`<div class="tablewrap"><table class="table"><thead><tr><th>凭证</th><th>客人</th><th>区域</th><th>桌号</th><th class="r">人数</th><th>状态</th><th class="r">操作</th></tr></thead><tbody>
        ${rows.map(b => html`<tr><td class="mono">${b.code}</td><td>${who(b.user)}</td><td>${zoneOf(b.zone).zh}${b.note ? html`<small>备注：${b.note}</small>` : ''}</td><td>${b.status === 'pending_confirm' && b.kind === 'booth' ? html`<span class="muted">待安排</span>` : tablesOf(b)}</td><td class="r">${b.party_size}</td><td>${badge(STATUS[b.status] || ['', b.status])}</td>
          <td class="r nowrap">${b.status === 'pending_confirm' ? html`<span class="btns" style="justify-content:flex-end"><button class="btn btn--sm" data-act="confirm" data-id="${b.id}">确认</button><button class="btn btn--sm btn--danger-outline" data-act="reject" data-id="${b.id}">拒绝</button></span>`
            : b.status === 'confirmed' && tonight ? html`<button class="btn btn--sm btn--secondary" data-act="admit" data-code="${b.code}">核验入场</button>` : ''}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty">这一晚还没有订单</div>`}
    </section>`;
}

/* confirm: pick the exact tables inside the zone the guest chose */
async function openConfirm(id) {
  const b = findBooking(id);
  if (!b) return;
  const board = await call('admin.board', { session_id: b.session.id }).catch(e => { fail(e); return null; });
  if (!board) return;
  const fresh = board.bookings.find(x => x.id === id) || b;
  const st = board.states;
  const options = RESOURCES.filter(r => r.zone === fresh.zone);
  const free = r => { const x = st[r.code] || {}; return x.booking === fresh.id || ['available', 'reserved_open'].includes(x.state); };
  const booth = fresh.kind === 'booth';
  const picked = new Set(fresh.lines.map(l => l.code));
  openModal(`确认订单 ${fresh.code}`, html`
    <dl class="facts"><dt>区域</dt><dd>${zoneOf(fresh.zone).zh}</dd><dt>日期</dt><dd>${dayLabel(fresh.date)} ${fresh.session.show_start}</dd><dt>人数</dt><dd>${fresh.party_size} 人</dd><dt>客人</dt><dd>${fresh.user ? `${fresh.user.name || ''} ${fresh.user.phone}` : ''}</dd>${fresh.note ? html`<dt>备注</dt><dd>${fresh.note}</dd>` : ''}</dl>
    ${booth ? html`<p style="font-weight:500">安排桌号（选 ${fresh.units} 张）</p><div id="tables" style="margin-top:6px">${options.map(r => { const ok = free(r); return html`<label class="check ${ok ? '' : 'is-off'}"><input type="checkbox" name="t" value="${r.code}" ${raw(picked.has(r.code) ? 'checked' : '')} ${raw(ok ? '' : 'disabled')}><span>${r.code} · ${r.card.name} · ${r.capacity} 人</span><span class="small">${ok ? (picked.has(r.code) ? '系统预留' : '空闲') : '已被占用'}</span></label>`; })}</div>
      <p class="err" data-err></p>` : html`<p>座位由系统安排：${tablesOf(fresh)}。确认后客人立即收到通知。</p>`}`,
  [html`<button class="btn btn--secondary" data-act="modal-close">取消</button>`, html`<button class="btn" data-act="confirm-go" data-id="${fresh.id}" data-units="${booth ? fresh.units : 0}">确认订单</button>`]);
}
const REASONS = ['该区域这一晚已经订满', '人数超出可安排的范围', '备注里的需求这一晚无法满足', '这一晚有包场'];
function openReject(id) {
  const b = findBooking(id);
  if (!b) return;
  const zones = (S.data.board && S.data.board.session.id === b.session.id ? S.data.board.zones : []).filter(z => z.id !== b.zone && z.free > 0);
  openModal(`拒绝订单 ${b.code}`, html`
    <dl class="facts"><dt>区域</dt><dd>${zoneOf(b.zone).zh} · ${b.party_size} 人</dd><dt>日期</dt><dd>${dayLabel(b.date)}</dd><dt>客人</dt><dd>${b.user ? `${b.user.name || ''} ${b.user.phone}` : ''}</dd></dl>
    <form id="rj" autocomplete="off">
      <p style="font-weight:500">拒绝原因（客人会看到）</p>
      <div style="margin-top:4px">${REASONS.map((r, i) => html`<label class="check"><input type="radio" name="reason" value="${r}" ${raw(i === 0 ? 'checked' : '')}><span>${r}</span></label>`)}<label class="check"><input type="radio" name="reason" value=""><span>其他</span></label></div>
      <textarea class="textarea" name="other" maxlength="120" placeholder="选「其他」时填写原因"></textarea>
      <label class="field" style="margin-top:14px"><span>建议客人改订<small>选填</small></span><select class="select" name="zone"><option value="">不建议</option>${zones.map(z => html`<option value="${z.id}">${zoneOf(z.id).zh}（剩 ${z.free} ${z.unit === 'seat' ? '座' : '桌'}）</option>`)}</select></label>
      <p class="hint">${b.payment && b.payment.status === 'paid' ? `客人已付的 ${yuan(b.payment.amount)} 会原路退回。` : '这笔订单没有预付款。'}</p>
    </form>`,
  [html`<button class="btn btn--secondary" data-act="modal-close">取消</button>`, html`<button class="btn btn--danger" data-act="reject-go" data-id="${b.id}">拒绝并退款</button>`]);
}
function findBooking(id) {
  const d = S.data || {};
  return [...((d.wb && d.wb.pending) || []), ...((d.board && d.board.bookings) || [])].find(b => b.id === id);
}
async function verifyCode(code) {
  try { S.ui.verify = await call('admin.verify', { code }); } catch (e) { S.ui.verify = { error: e.message }; }
  if (S.page !== 'orders') location.hash = '#/orders';
  else await load();
  loadBadges();
}

/* ---------- roundtables ---------- */
async function loadTalks() {
  const list = await call('admin.events');
  return list.filter(e => e.kind === 'roundtable');
}
function talkRows(list) {
  return html`<div class="tablewrap"><table class="table"><thead><tr><th>时间</th><th>话题</th><th class="r">报名</th><th>状态</th><th class="r">操作</th></tr></thead><tbody>
    ${list.map(e => html`<tr><td class="nowrap">${dayLabel(hzDate(e.start_at))}<small>${fmt.time(e.start_at)}–${fmt.time(e.end_at)}</small></td><td>${e.title}<small>${e.host ? `主持 ${e.host} · ` : ''}${e.location}</small></td>
      <td class="r num">${e.taken} / ${e.capacity}</td><td>${badge(e.status === 'published' ? ['ok', '已发布'] : e.status === 'draft' ? ['', '草稿'] : ['danger', '已取消'])}</td>
      <td class="r nowrap"><span class="btns" style="justify-content:flex-end"><button class="btn btn--sm btn--secondary" data-act="talk-regs" data-id="${e.id}">报名名单</button><button class="btn btn--sm btn--secondary" data-act="talk-edit" data-id="${e.id}">编辑</button></span></td></tr>`)}
  </tbody></table></div>`;
}
function viewTalks(list) {
  const now = serverNow();
  const up = list.filter(e => Date.parse(e.end_at) >= now).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = list.filter(e => Date.parse(e.end_at) < now).sort((a, b) => b.start_at.localeCompare(a.start_at));
  return html`<div class="page__h"><div><h1>座谈</h1><p>白天 10:00–19:00 的开放式座谈，会员在 App 里报名。</p></div><button class="btn" data-act="talk-new">新建座谈</button></div>
    ${up.length ? talkRows(up) : html`<div class="empty">还没有安排接下来的座谈</div>`}
    ${past.length ? html`<details class="past"><summary>已结束的座谈（${past.length}）</summary>${talkRows(past)}</details>` : ''}`;
}
function openTalkForm(id) {
  const e = id ? (S.data || []).find(x => x.id === id) : null;
  const tomorrow = addDays(hzDate(serverNow()), 1);
  const v = e ? { title: e.title, date: hzDate(e.start_at), from: fmt.time(e.start_at), to: fmt.time(e.end_at), capacity: e.capacity, host: e.host, location: e.location, intro: e.intro, status: e.status }
    : { title: '开放座谈：', date: tomorrow, from: '15:00', to: '16:30', capacity: 12, host: '', location: '座谈沙龙', intro: '', status: 'published' };
  const sel = b => raw(b ? 'selected' : '');
  openModal(e ? '编辑座谈' : '新建座谈', html`<form id="talkform" autocomplete="off">
      <label class="field"><span>话题</span><input class="input" name="title" maxlength="40" value="${v.title}" required autofocus></label>
      <div class="grid3" style="margin-top:14px"><label class="field"><span>日期</span><input class="input" type="date" name="date" value="${v.date}"></label><label class="field"><span>开始</span><input class="input" type="time" name="from" value="${v.from}"></label><label class="field"><span>结束</span><input class="input" type="time" name="to" value="${v.to}"></label></div>
      <div class="grid2" style="margin-top:14px"><label class="field"><span>主持人</span><input class="input" name="host" maxlength="20" value="${v.host}"></label><label class="field"><span>名额</span><input class="input" type="number" name="capacity" min="1" max="300" value="${v.capacity}"></label></div>
      <div class="grid2" style="margin-top:14px"><label class="field"><span>地点</span><input class="input" name="location" maxlength="30" value="${v.location}"></label>
        <label class="field"><span>状态</span><select class="select" name="status"><option value="published" ${sel(v.status === 'published')}>发布</option><option value="draft" ${sel(v.status === 'draft')}>草稿（会员看不到）</option><option value="cancelled" ${sel(v.status === 'cancelled')}>取消</option></select></label></div>
      <label class="field" style="margin-top:14px"><span>介绍<small>会员在 App 里看到</small></span><textarea class="textarea" name="intro" maxlength="400">${v.intro}</textarea></label>
      <p class="hint">白天会员时间是 10:00–19:00。</p>
      <p class="err" data-err></p>
    </form>`,
  [html`<button class="btn btn--secondary" data-act="modal-close">取消</button>`, html`<button class="btn" data-act="talk-save" data-id="${id || ''}">${e ? '保存' : '发布'}</button>`]);
}
async function openRegs(id) {
  const e = (S.data || []).find(x => x.id === id);
  const show = async () => {
    const regs = await call('admin.event.registrations', { id }).catch(err => { fail(err); return []; });
    if (!S.modal || S.modal.key !== id) return;
    $('.modal__b', modalEl).innerHTML = (regs.length ? html`<p class="small" style="margin-bottom:6px">勾选到场的会员。</p>${regs.map(r => html`<label class="check"><input type="checkbox" data-act="reg-mark" data-id="${r.id}" ${raw(r.status === 'attended' ? 'checked' : '')}><span>${r.user ? r.user.name : '—'}${r.user && r.user.member_no ? html` <span class="small">No.${r.user.member_no}</span>` : ''}</span><span class="small">${r.user ? r.user.phone : ''}</span></label>`)}`
      : html`<p class="empty" style="padding:20px 0">还没有人报名</p>`).s;
  };
  openModal(`报名名单 · ${e ? e.title : ''}`, html`<p class="small">加载中…</p>`, [html`<button class="btn btn--secondary" data-act="modal-close">关闭</button>`], { key: id, refresh: show });
  show();
}

/* ---------- invitations ---------- */
const INV = { issued: ['warn', '待领取'], claimed: ['ok', '已领取'], expired: ['', '已过期'], disabled: ['', '已停用'] };
function viewInvites(list) {
  const inv = S.ui.lastInvite;
  return html`<div class="page__h"><div><h1>邀请</h1><p>受邀的朋友打开链接即可领取 3 个月会员，从领取当天开始。</p></div></div>
    <div class="card">
      <form data-form="invite" autocomplete="off">
        <div class="grid2"><label class="field"><span>写给谁<small>会显示在邀请函上</small></span><input class="input" name="note" maxlength="60" placeholder="例如：致 王先生" ${raw(isAdmin() ? '' : 'disabled')}></label>
          <label class="field"><span>只允许这个手机号领取<small>选填</small></span><input class="input" name="phone" inputmode="numeric" maxlength="11" placeholder="不填则任何人都能领" ${raw(isAdmin() ? '' : 'disabled')}></label></div>
        <p class="err" data-err></p>
        <button class="btn" ${raw(isAdmin() ? '' : 'disabled')}>生成邀请链接</button>${isAdmin() ? '' : html`<span class="small" style="margin-left:10px">发出邀请需要店长权限</span>`}
      </form>
      ${inv ? html`<div class="newinvite"><b>邀请已生成</b>，把链接发给对方（微信里直接粘贴即可）：<div class="linkbox"><input class="input" readonly value="${inviteLink(inv.token)}" aria-label="邀请链接"><button class="btn btn--secondary" data-act="copy" data-v="${inviteLink(inv.token)}">复制链接</button></div></div>` : ''}
    </div>
    <section class="section"><div class="section__h"><h2>已发出的邀请（${list.length}）</h2></div>
      <div class="tablewrap"><table class="table"><thead><tr><th>邀请码</th><th>写给</th><th>状态</th><th>领取人</th><th>截止日期</th><th class="r">操作</th></tr></thead><tbody>
        ${list.map(i => html`<tr><td class="mono nowrap">${i.token}</td><td>${i.note}${i.bound_phone ? html`<small>仅限 ${i.bound_phone}</small>` : ''}</td><td>${badge(INV[i.status] || ['', i.status])}</td>
          <td>${i.claimer ? html`${i.claimer.name || ''}<small>${i.claimed_at ? when(i.claimed_at) : ''}</small>` : html`<span class="muted">—</span>`}</td><td class="nowrap">${fmt.date(i.claim_deadline)}</td>
          <td class="r nowrap">${i.status === 'issued' ? html`<span class="btns" style="justify-content:flex-end"><button class="btn btn--sm btn--secondary" data-act="copy" data-v="${inviteLink(i.token)}">复制链接</button>${isAdmin() ? html`<button class="btn btn--sm btn--danger-outline" data-act="invite-off" data-id="${i.id}">停用</button>` : ''}</span>` : ''}</td></tr>`)}
      </tbody></table></div></section>`;
}

/* ---------- demo ---------- */
function viewDemo(st) {
  const clocks = [['real', '回到现在'], ['14:00', '14:00 白天'], ['18:58', '18:58'], ['19:02', '19:02 入夜'], ['21:40', '21:40'], ['+31', '快进 31 分钟']];
  return html`<div class="page__h"><div><h1>演示</h1><p>只在演示环境里有，正式版没有这一页。</p></div></div>
    <div class="card"><h2 style="font-size:16px">演示时钟</h2><p class="small" style="margin-top:4px">会员端和后台一起跳到这个时间。时钟只往前走，选的时间如果已经过了会跳到第二天。现在：${when(Date.parse(st.now))}</p>
      <div class="btns" style="margin-top:12px">${clocks.map(([k, l]) => html`<button class="btn btn--secondary btn--sm" data-act="clock" data-v="${k}">${l}</button>`)}</div></div>
    <div class="card" style="margin-top:16px"><h2 style="font-size:16px">演示数据</h2><p class="small" style="margin-top:4px">把订单、邀请、座谈报名都恢复到初始状态，会员端一起重置。</p>
      <div class="btns" style="margin-top:12px"><button class="btn btn--danger-outline btn--sm" data-act="reset" ${raw(isAdmin() ? '' : 'disabled')}>重置演示数据</button><a class="btn btn--secondary btn--sm" href="../app/" target="_blank" rel="noopener">打开会员端</a></div></div>`;
}

/* ---------- modal ---------- */
function openModal(title, body, foot = [], extra = {}) {
  S.modal = { title, ...extra };
  modalEl.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal__h"><h2>${title}</h2><button class="modal__x" data-act="modal-close" aria-label="关闭">×</button></div><div class="modal__b">${body}</div>${foot.length ? html`<div class="modal__f">${foot}</div>` : ''}</div>`.s;
  modalEl.classList.add('is-open');
  modalEl.querySelector('[autofocus]')?.focus();
}
function closeModal() {
  S.modal = null;
  modalEl.classList.remove('is-open');
  modalEl.innerHTML = '';
}

/* ---------- actions ---------- */
async function busy(el, fn) {
  if (el && el.classList.contains('is-busy')) return undefined;
  el?.classList.add('is-busy');
  try { return await fn(); } finally { el?.classList.remove('is-busy'); }
}
function fail(e, errEl) {
  if (e && e.code === 'auth') { auth.clear(); S.staff = null; S.page = null; closeModal(); toast('请重新登录', 'error'); viewLogin(); return; }
  if (errEl) errEl.textContent = e.message;
  else toast((e && e.message) || '出了点问题', 'error');
}
async function act(method, args, ok) {
  try { const r = await call(method, args); if (ok) toast(ok); await load(); loadBadges(); return r || {}; } catch (e) { fail(e); return null; }
}

const ACTIONS = {
  logout: () => { if (!confirm('退出后台？')) return; call('auth.logout').catch(() => {}); auth.clear(); S.staff = null; S.page = null; viewLogin(); },
  session: d => { S.ui.session = d.id; load(); },
  confirm: (d, el) => busy(el, () => openConfirm(d.id)),
  reject: d => openReject(d.id),
  'confirm-go': (d, el) => busy(el, async () => {
    const codes = [...modalEl.querySelectorAll('input[name="t"]:checked')].map(x => x.value);
    const units = Number(d.units);
    if (units && codes.length !== units) { $('[data-err]', modalEl).textContent = `请选 ${units} 张桌（已选 ${codes.length} 张）`; return; }
    try {
      const r = await call('admin.booking.confirm', { id: d.id, codes: units ? codes : undefined });
      closeModal();
      toast(`已确认 ${r.code}，桌号 ${tablesOf(r)}，客人已收到通知`);
      await load(); loadBadges();
    } catch (e) { fail(e, $('[data-err]', modalEl)); }
  }),
  'reject-go': (d, el) => busy(el, async () => {
    const f = new FormData($('#rj'));
    const reason = String(f.get('reason') || f.get('other') || '').trim();
    if (!reason) { toast('请填写拒绝原因', 'error'); return; }
    const zone = f.get('zone');
    try {
      const r = await call('admin.booking.reject', { id: d.id, reason: `${reason}，抱歉。`, suggestion: zone ? `可以改订${zoneOf(zone).zh}。` : '', suggestion_zone: zone });
      closeModal();
      toast(`已拒绝 ${r.code}${r.refund ? `，${yuan(r.refund.amount)} 原路退回` : ''}`);
      await load(); loadBadges();
    } catch (e) { fail(e); }
  }),
  admit: (d, el) => busy(el, () => verifyCode(d.code)),
  'talk-new': () => openTalkForm(null),
  'talk-edit': d => openTalkForm(d.id),
  'talk-regs': d => openRegs(d.id),
  'talk-save': (d, el) => busy(el, async () => {
    const form = $('#talkform');
    const v = Object.fromEntries(new FormData(form));
    const old = d.id ? (S.data || []).find(x => x.id === d.id) : null;
    const hook = (v.intro.split(/[。！？\n]/)[0] || v.title).slice(0, 40);
    try {
      await call('admin.event.save', { id: d.id || undefined, kind: 'roundtable', layer: 1, public_signup: false, en: old ? old.en : '', guests: old ? old.guests : '', hook, ...v });
      closeModal();
      toast(d.id ? '已保存，会员端同步更新' : '座谈已发布，会员可以报名了');
      await load();
    } catch (e) { fail(e, $('[data-err]', form)); }
  }),
  'reg-mark': async (d, el) => {
    try { await call('admin.registration.mark', { id: d.id, status: el.checked ? 'attended' : 'registered' }); toast(el.checked ? '已标记到场' : '已取消到场'); } catch (e) { el.checked = !el.checked; fail(e); }
  },
  'invite-off': (d, el) => busy(el, async () => { if (!confirm('停用这份邀请？停用后链接失效。')) return; await act('admin.invite.disable', { id: d.id }, '邀请已停用'); }),
  copy: async d => { try { await navigator.clipboard.writeText(d.v); toast('链接已复制'); } catch { prompt('复制这条链接：', d.v); } },
  clock: async d => {
    const v = d.v;
    const args = v === 'real' ? { action: 'real' } : v.startsWith('+') ? { action: 'plus', minutes: Number(v.slice(1)) } : { action: 'set', hhmm: v };
    try { const r = await call('demo.clock', args); await syncClock(); toast(`演示时间：${when(Date.parse(r.now))}`); await load(); loadBadges(); } catch (e) { fail(e); }
  },
  reset: (d, el) => busy(el, async () => { if (!confirm('把所有演示数据恢复到初始状态？会员端也会一起重置。')) return; S.ui.lastInvite = null; S.ui.verify = null; await act('admin.reset', {}, '演示数据已重置'); }),
  'modal-close': () => closeModal(),
};
const FORMS = {
  login: (form, fd) => busy(form.querySelector('button'), async () => {
    const err = $('[data-err]', form);
    try {
      const r = await call('admin.login', { staffId: fd.get('staff'), pin: fd.get('pin') });
      auth.set(r.token);
      S.staff = r.staff;
      S.page = null;
      rootEl.innerHTML = '';
      route();
    } catch (e) { err.textContent = e.message; }
  }),
  verify: (form, fd) => {
    const code = String(fd.get('code') || '').trim();
    if (!code) return;
    return busy(form.querySelector('button'), () => verifyCode(code));
  },
  invite: (form, fd) => busy(form.querySelector('button'), async () => {
    const err = $('[data-err]', form);
    err.textContent = '';
    try {
      S.ui.lastInvite = await call('admin.invite.create', { note: fd.get('note') || '', phone: fd.get('phone') || '' });
      toast('邀请已生成');
      await load();
    } catch (e) { fail(e, err); }
  }),
};

document.addEventListener('click', e => {
  if (e.target === modalEl) { closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('[disabled]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (!(el.type === 'checkbox')) e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modal) closeModal(); });
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form, new FormData(form));
});

boot();
