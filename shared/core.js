/* =========================================================
   sth.ventured · library live — demo core (v2)
   Implements the 2026-11-05 PRD v0.1 and the AI spec v0.3, with the
   later rule from the v0.3 human doc: seats are booked by zone (分区),
   the store assigns the exact table (the v0.1 approach).
   Rule IDs (R-*, INV-*, T*) refer to the AI spec; they also appear in
   error responses so the UI can explain itself.

   One module, two homes: the Node server (server/server.js) and the
   browser's local demo mode (shared/api.js). Same rules either way.
   Money is integer fen. Times are stored UTC; business time is Asia/Shanghai.
   ========================================================= */
import { ZONES, RESOURCES, zoneOf, resourceOf } from './plan.js';

export const VERSION = 2;
export const DEMO_CODE = '2026';
export const DEMO_PIN = '1215';
export const RULES_VERSION = 'v0.3';
const MIN = 60e3;
const H = 60 * MIN;
const D = 24 * H;

export const STORE = { id: 'll-hz-wulin9', brand: 'sth.ventured', name: 'library live', zh: '杭州 · 武林路 9 号' };

export const DEFAULT_CONFIG = {
  switchAt: '19:00', dayOpenAt: '10:00', nightCloseAt: '02:00',
  windowMember: 7, windowGuest: 3,
  onlineCutoff: '21:30', showStart: '21:00', holdDeadline: '21:30',
  lockMinutes: 10, confirmMinutes: 30, maxResources: 3,
  depositRatio: 0.3,
  prices: { S: { member: 200000, guest: 400000 }, A: { member: 150000, guest: 300000 }, B: { member: 120000, guest: 240000 } },
  ticketPrice: 18800, ticketDrink: '一杯特调', ticketLimit: 4, ticketCompanions: 3, ticketSalesEnabled: true,
  memberPrice: 102400, giftMonths: 3, giftClaimDeadline: '2027-01-15', renewWithoutReviewDays: 30,
  reservedCount: 2,
  // [禁止自定]: off until the owner decides (Q-10, Q-13, Q-16)
  userWithdrawEnabled: false, userCancelPolicy: 'disabled', membershipRefund: 'none',
  refundSettleSeconds: 20, // mock payment channel: refunds land after this many seconds
};
const LOCKED_CONFIG = { userWithdrawEnabled: 'Q-16', userCancelPolicy: 'Q-10', membershipRefund: 'Q-13' };

/* ---------- vocabulary ---------- */
export const IDENTITIES = {
  guest: { zh: '游客', en: 'Guest' },
  non_member: { zh: '非会员', en: 'Non-member' },
  applicant: { zh: '审核中', en: 'Applicant' },
  invitee: { zh: '受邀', en: 'Invitee' },
  member_active: { zh: '会员', en: 'Member' },
  member_expired: { zh: '会员已到期', en: 'Expired' },
};
/* booking statuses, worded like a deal (an idea from the v0.3 doc that echoes the website's 尽调中 stamp) */
export const BOOKING_STATUS = {
  pending_payment: { zh: '待支付', deal: 'Term sheet', note: '10 分钟内完成支付' },
  payment_expired: { zh: '已取消（超时未付）', deal: 'Lapsed' },
  pending_confirm: { zh: '待门店确认', deal: '尽调中', note: '门店 30 分钟内确认' },
  confirmed: { zh: '预订成功', deal: '已交割' },
  rejected: { zh: '门店未接受', deal: '本轮未进' },
  confirm_timeout_closed: { zh: '确认超时，已关闭', deal: '本轮未进' },
  cancelled: { zh: '已取消', deal: 'Withdrawn' },
  fulfilled: { zh: '已到店', deal: 'Closed' },
  no_show: { zh: '未到店', deal: 'No show' },
};
export const APP_STATUS = {
  under_review: { zh: '审核中', en: 'Under review' },
  need_info: { zh: '待补充资料', en: 'Need info' },
  approved_awaiting_payment: { zh: '已通过 · 待付款', en: 'Approved' },
  rejected: { zh: '未通过', en: 'Declined' },
  completed: { zh: '已入会', en: 'Completed' },
};
export const EVENT_KINDS = {
  panel: { zh: '闭门分享', en: 'Panel' },
  podcast: { zh: '播客录制', en: 'Live podcast' },
  roundtable: { zh: '开放座谈', en: 'Roundtable' },
  maker: { zh: '创客', en: 'Maker' },
};
export const STAFF = [
  { id: 'st1', name: '周行', role: 'admin', title: '店长' },
  { id: 'st2', name: '沈岚', role: 'reception', title: '前台' },
  { id: 'st3', name: '何夕', role: 'reception', title: '前台' },
];

/* ---------- time: business time is Hangzhou (UTC+8) ---------- */
export function hz(t = Date.now()) {
  const d = new Date(+new Date(t) + 8 * H);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(), date: d.toISOString().slice(0, 10) };
}
export const hzDate = t => hz(t).date;
export const atHz = (date, hhmm = '00:00') => new Date(`${date}T${hhmm.length === 5 ? hhmm + ':00' : hhmm}+08:00`).toISOString();
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * D).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / D);
const iso = t => new Date(t).toISOString();
const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export function addMonths(date, n) { // calendar month, same day, clamped to the month's end (R-MEM-12)
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/* day / night / closed (R-DAY-01) and the business date "tonight" belongs to */
export function modeAt(config, t) {
  const x = hz(t);
  const m = x.h * 60 + x.mi;
  const open = mins(config.dayOpenAt), sw = mins(config.switchAt), close = mins(config.nightCloseAt);
  if (m >= open && m < sw) return 'day';
  if (m >= sw || m < close) return 'night';
  return 'closed';
}
export function tonightDate(config, t) {
  const x = hz(t);
  return x.h * 60 + x.mi < mins(config.nightCloseAt) ? addDays(x.date, -1) : x.date;
}
const sessionEnd = (config, date) => Date.parse(atHz(addDays(date, 1), config.nightCloseAt));

/* ---------- utilities ---------- */
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/* the rotating code on a member's card: proves the member is there in person (R-MEM-05). Demo-grade; production uses TOTP. */
export const CODE_STEP = 30e3;
export function memberCode(secret, t = Date.now(), offset = 0) {
  return String(hash53(`${secret}:${Math.floor(t / CODE_STEP) + offset}`) % 1e6).padStart(6, '0');
}
const CODESET = 'ACDEFHJKMNPRTUVWXY34679';
function token(n, seed) {
  if (seed != null) { let h = hash53(seed); return Array.from({ length: n }, () => { const c = CODESET[h % CODESET.length]; h = Math.floor(h / CODESET.length) || hash53(seed + c); return c; }).join(''); }
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => CODESET[b % CODESET.length]).join('');
}
const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
export function rid(n = 10) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => ALPHA[b % 36]).join('');
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max = 600) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
export const normPhone = v => String(v ?? '').replace(/[\s-]/g, '').replace(/^\+?86/, '');
const byId = (list, id) => list.find(x => x.id === id);
const fen = n => Math.round(n);
export const yuan = f => `¥${(f / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export class ApiError extends Error {
  constructor(code, message, status = 400, rule = null) { super(message); this.code = code; this.status = status; this.rule = rule; }
}
const fail = (message, code = 'bad_request', status = 400, rule = null) => { throw new ApiError(code, message, status, rule); };
const ruleFail = (rule, message) => fail(message, 'rule', 422, rule);

/* the daily check-in code and its "library date stamp" (R-DAY-04) */
export function checkinCode(db, date) {
  return (db.checkinOverrides && db.checkinOverrides[date]) || token(4, `${db.secret}:checkin:${date}`);
}
export function stampPattern(code) { // a 7x7 mirrored pattern, one per code, like a library's date stamp
  let h = hash53(`stamp:${code}`);
  const rows = [];
  for (let y = 0; y < 7; y++) {
    const half = [];
    for (let x = 0; x < 4; x++) { half.push(h & 1); h = Math.floor(h / 2) || hash53(code + y + x); }
    rows.push([...half, ...half.slice(0, 3).reverse()]);
  }
  return rows;
}

/* =========================================================
   Seed
   ========================================================= */
const MEMBERS = [
  ['周以宁', 'Zhou Yining', '格物资本 · 管理合伙人', '杭州'],
  ['陈牧之', 'Chen Muzhi', '灵枢智能 · 创始人', '杭州'],
  ['许嘉禾', 'Xu Jiahe', '北辰创投 · 合伙人', '上海'],
  ['苏砚', 'Su Yan', '零度具身 · 联合创始人', '杭州'],
  ['顾言', 'Gu Yan', '微光模型 · 首席科学家', '北京'],
  ['叶闻舟', 'Ye Wenzhou', '千帆机器人 · CTO', '深圳'],
  ['林知远', 'Lin Zhiyuan', '远望机器人 · 创始人', '杭州'],
  ['江念', 'Jiang Nian', '镶嵌资本 · 投资总监', '上海'],
  ['宋清和', 'Song Qinghe', '栖木智能 · 产品负责人', '杭州'],
  ['陆星河', 'Lu Xinghe', '星河动力 · 创始人', '杭州'],
  ['韩一诺', 'Han Yinuo', '一诺资本 · 合伙人', '北京'],
  ['程溪', 'Cheng Xi', '溪流模型 · 研究员', '杭州'],
  ['方既白', 'Fang Jibai', '既白生物 · 创始人', '上海'],
  ['季长风', 'Ji Changfeng', '长风机器人 · 工程副总裁', '杭州'],
  ['唐晚', 'Tang Wan', '晚照创投 · 投资副总裁', '杭州'],
  ['温屿', 'Wen Yu', '屿光智能 · 创始人', '深圳'],
  ['傅辰', 'Fu Chen', '辰星具身 · CEO', '杭州'],
  ['夏知秋', 'Xia Zhiqiu', '知秋资本 · 合伙人', '上海'],
  ['孟川', 'Meng Chuan', '川流智能 · 联合创始人', '杭州'],
  ['白露', 'Bai Lu', '白露智能 · 算法负责人', '杭州'],
];
const SHOWS = [
  ['不插电之夜', 'Unplugged Night', '林间四重奏'],
  ['书架间的爵士', 'Jazz in the Stacks', 'Kepler Trio'],
  ['合成器与电路', 'Synth & Circuits', 'Analog Hearts'],
  ['城市民谣', 'City Folk', '雾港乐队'],
  ['深夜钢琴', 'Late Night Piano', 'Ellis 钢琴独奏'],
  ['巴萨诺瓦与书', 'Bossa & Books', 'Nova Bossa'],
  ['后摇之夜', 'Post-rock Night', '回声定位'],
];
export const BOOKS = [
  ['k1', 'The Power Law', 'Sebastian Mallaby'], ['k2', '从 0 到 1', '彼得·蒂尔'], ['k3', '芯片战争', '克里斯·米勒'],
  ['k4', 'The Soul of a New Machine', 'Tracy Kidder'], ['k5', '哥德尔、艾舍尔、巴赫', '侯世达'], ['k6', 'The Dream Machine', 'M. Mitchell Waldrop'],
  ['k7', '创新者', '沃尔特·艾萨克森'], ['k8', 'Troublemakers', 'Leslie Berlin'], ['k9', '人月神话', '弗雷德里克·布鲁克斯'], ['k10', '控制论', '诺伯特·维纳'],
].map(([id, title, author]) => ({ id, title, author }));

function contentSeed() {
  return [
    { key: 'memo', kind: 'page', layer: 1, mode: 'any', locked_placeholder: false,
      teaser: { title: 'The Memo · 第 07 期', hook: '本周到访的三个项目、下周的 panel，和一份书单。' },
      body: {
        issue: 'No. 07 · 2026 W45',
        visits: [['远望机器人', '把灵巧手的成本打到原来的五分之一。'], ['溪流模型', '只做一件事：让小模型在手机上跑得像大模型。'], ['既白生物', '用机器人做湿实验，一晚上跑完一周的量。']],
        next: '下周四 15:00 · 闭门分享「具身智能的下一个十年」，主讲 苏砚、傅辰。',
        books: ['The Power Law', 'The Soul of a New Machine', '芯片战争'],
        line: 'Nothing ventured, nothing gained. 这周，下注的人比上周多了三个。' } },
    { key: 'membertime', kind: 'section', layer: 1, mode: 'day', locked_placeholder: false,
      teaser: { title: '会员时间 · Members’ Hours', hook: '白天的 library live 只对会员开放：读书、座谈、会面。' },
      body: { lines: ['10:00–19:00 是会员时间。到店扫门口的签到码，写上同行人数，朋友不用注册。', '大厅中央有开放式座谈：一张话题卡、一张圆桌，谁都可以坐下来。', '多人会议请提前申请，门店确认后为你留座、摆好桌椅。', '咖啡另付，约 18 元一杯。19:00 以后，这里变成演出现场。'] } },
    { key: 'afterhours', kind: 'page', layer: 1, mode: 'night', locked_placeholder: false,
      teaser: { title: '隐藏酒单 · After Hours', hook: '入夜之后才出现的一页酒单，名字都取自技术术语。' },
      body: { drinks: [['Hello, World', '金酒、接骨木、一点盐。每个故事的第一行。'], ['Segfault', '黑朗姆、咖啡、橙皮。越界的那一口。'], ['Kernel Panic', '梅斯卡尔、辣椒、青柠。系统重启前的三秒。'], ['Seed Round', '清酒、白桃、气泡。小，但都是真金白银。'], ['Garbage Collector', '把吧台剩下的好东西收拢成一杯，每晚不同。'], ['Zero-Day', '无酒精。今晚还有正事要做的人喝这个。']], note: '店内点单，凭会员卡。' } },
    { key: 'shelf', kind: 'feature', layer: 2, mode: 'day', locked_placeholder: true, unlock_rule: { type: 'checkin_count', n: 1 },
      teaser: { title: '借阅书单 · My Shelf', hook: '白天签到后可以借一本书，借过的书连成你的个人书单。' }, body: { dynamic: 'shelf' } },
    { key: 'recordings', kind: 'page', layer: 2, mode: 'any', locked_placeholder: true, unlock_rule: { type: 'event_attended', n: 1 },
      teaser: { title: '现场回放 · Recordings', hook: 'panel 与播客的录音，只有到过现场的会员能回放。' }, body: { dynamic: 'recordings' } },
    { key: 'speakers', kind: 'page', layer: 2, mode: 'any', locked_placeholder: false, unlock_rule: { type: 'hosted_session' },
      teaser: { title: '讲者名录 · Speakers', hook: '做过一次分享的会员，名字刻在这里。' }, body: { dynamic: 'speakers' } },
    { key: 'hidden-room', kind: 'page', layer: 3, mode: 'any', locked_placeholder: false, unlock_rule: { type: 'easter_egg', egg_key: 'hidden-room' },
      teaser: { title: '地图上没画的房间', hook: '你在店内图的角落按得够久。' },
      body: { lines: ['这间房间不在任何一版图纸上。', '它在员工区和储藏室之间，门上没有牌子，只有一行用铅笔写的字：', '「1957 年，八个人在这样的房间里决定辞职。」', '下次来，问前台要一把黄铜钥匙。'] } },
    { key: 'ink', kind: 'feature', layer: 3, mode: 'night', locked_placeholder: false, unlock_rule: { type: 'easter_egg', egg_key: 'ink' },
      teaser: { title: '隐形墨水', hook: '会员卡背面那一行字，过了 23:00 才显影。' },
      body: { lines: ['THE BEST WAY TO PREDICT THE FUTURE IS TO INVENT IT.', '— Alan Kay, Xerox PARC, 1971', '凌晨之前，吧台的 Zero-Day 记在我们账上。'] } },
    { key: 'archive', kind: 'page', layer: 3, mode: 'any', locked_placeholder: false, unlock_rule: { type: 'staff_grant' },
      teaser: { title: '1957 档案室', hook: '由店长亲手授予。' },
      body: { lines: ['1957 年 9 月 18 日，八位工程师离开肖克利半导体实验室。', '一位年轻的投资银行家亚瑟·洛克替他们找到了钱，仙童半导体诞生。', '这间档案室收着我们这一代人的「1957」：你下注的那个时刻。', '把你的故事写下来，交给前台，它会被放进这里。'] } },
  ];
}

export function seed(t = Date.now()) {
  const rnd = mulberry32(915);
  const cfg = structuredCopy(DEFAULT_CONFIG);
  const today = tonightDate(cfg, t);
  const ago = (days, hours = 0, minutes = 0) => iso(t - days * D - hours * H - minutes * MIN);
  const db = {
    version: VERSION, seededAt: iso(t), secret: 'sv-' + token(10),
    clock: { offsetMs: 0 },
    config: cfg,
    staff: STAFF.map(s => ({ ...s })),
    users: [], applications: [], invites: [], memberships: [], payments: [], refunds: [],
    sessions: [], bookings: [], occupancies: [], holds: [], tickets: [], redemptions: [],
    checkins: [], checkinOverrides: {}, meetings: [], events: [], registrations: [],
    content: contentSeed(), unlocks: [], shelf: [], notices: [], audit: [], tokens: {}, nextNo: 1,
  };
  const addUser = (name, en, phone, extra = {}) => {
    const u = { id: 'u' + phone, name, en, phone, city: extra.city || '杭州', company_role: extra.venture || '', intro: '', member_no: null, unlock_seen: false, secret: 'sv-m-' + phone, created_at: extra.created_at || ago(40), notices_seen_at: '' };
    db.users.push(u);
    return u;
  };
  const segment = (u, source, startIso, months, extra = {}) => {
    if (!u.member_no) u.member_no = String(db.nextNo++).padStart(4, '0');
    const endDate = addMonths(hzDate(startIso), months);
    const m = { id: 'ms' + rid(6), user_id: u.id, source, start_at: startIso, end_at: atHz(endDate, '23:59:59'), ...extra };
    db.memberships.push(m);
    return m;
  };

  // members, in the order they joined
  MEMBERS.forEach(([name, en, venture, city], i) => {
    const u = addUser(name, en, '138000000' + String(i + 1).padStart(2, '0'), { venture, city, created_at: ago(70 - i * 2) });
    u.unlock_seen = true;
    const gift = i < 12;
    const start = ago(gift ? 32 - i : 28 - i);
    if (gift) {
      const inv = { id: 'iv' + rid(6), token: 'SV-' + token(6), issued_by: 'st1', note: `致 ${name}`, claim_deadline: atHz(cfg.giftClaimDeadline, '23:59:59'), status: 'claimed', claimed_by: u.id, claimed_at: start, bound_phone: u.phone, held_by: null, created_at: ago(40) };
      db.invites.push(inv);
      segment(u, 'gift', start, cfg.giftMonths, { invite_id: inv.id });
    } else {
      db.applications.push({ id: 'ap' + rid(6), user_id: u.id, status: 'completed', profile: { name, phone: u.phone, city, company_role: venture, intro: '', referrer: MEMBERS[i % 5][0] }, history: [{ status: 'under_review', at: ago(40 - i) }, { status: 'approved_awaiting_payment', at: ago(36 - i) }, { status: 'completed', at: start }], reviewer: 'st1', review_note: '', created_at: ago(40 - i), updated_at: start });
      const p = { id: 'pm' + rid(6), kind: 'membership', user_id: u.id, amount: cfg.memberPrice, provider: 'mock', status: 'paid', created_at: start, paid_at: start };
      db.payments.push(p);
      segment(u, 'paid', start, 1, { payment_id: p.id });
      if (i === 14) { // 唐晚: expired ten days ago, still inside the 30-day renew window
        const seg = db.memberships[db.memberships.length - 1];
        seg.start_at = ago(41); seg.end_at = atHz(addDays(hzDate(t), -10), '23:59:59');
      }
    }
  });
  const U = n => db.users[n - 1];
  const lin = U(7);
  lin.notices_seen_at = ago(1);

  // people on their way in
  const visitor = addUser('陈一', 'Chen Yi', '13700000001', { created_at: ago(6) });
  visitor.company_role = '初创公司 · 产品经理';
  const mkApp = (name, en, phone, status, days, extra = {}) => {
    const u = addUser(name, en, phone, { created_at: ago(days) });
    u.company_role = extra.venture || '';
    const history = [{ status: 'under_review', at: ago(days) }];
    if (status !== 'under_review') history.push({ status, at: ago(Math.max(0, days - 2)), by: 'st1' });
    db.applications.push({ id: 'ap' + rid(6), user_id: u.id, status, profile: { name, phone, city: extra.city || '杭州', company_role: extra.venture || '', intro: extra.intro || '', referrer: extra.referrer || '' }, history, reviewer: status === 'under_review' ? null : 'st1', review_note: extra.note || '', created_at: ago(days), updated_at: history[history.length - 1].at });
    return u;
  };
  mkApp('宋予安', 'Song Yuan', '13900000021', 'under_review', 2, { venture: '予安智能 · 创始人', intro: '做面向工厂的视觉质检模型，团队 12 人。', referrer: '陈牧之' });
  mkApp('黎昕', 'Li Xin', '13900000024', 'need_info', 5, { venture: '昕辰模型 · 研究员', city: '上海', intro: '研究方向是长上下文。', note: '请补充一下现在在做的项目，以及推荐人是谁。' });
  mkApp('钟灵', 'Zhong Ling', '13900000031', 'approved_awaiting_payment', 7, { venture: '灵犀机器人 · 创始人', intro: '做养老场景的服务机器人。', referrer: '林知远' });
  mkApp('罗思齐', 'Luo Siqi', '13900000012', 'under_review', 1, { venture: '思齐量化 · 合伙人', city: '上海', intro: '量化出身，最近在看 AI 基础设施。', referrer: '江念' });
  mkApp('金雨桐', 'Jin Yutong', '13900000013', 'under_review', 3, { venture: '桐语智能 · CEO', intro: '语音交互，刚拿到天使轮。' });
  mkApp('杜若', 'Du Ruo', '13900000014', 'rejected', 9, { venture: '若木咨询 · 顾问', city: '北京', note: '这一次没能成行。' });
  const invitee = addUser('向南', 'Xiang Nan', '13900000011', { created_at: ago(1) });
  invitee.company_role = '具身未来 · 创始人';
  db.invites.push(
    { id: 'iv-xn', token: 'SV-7K2QXA', issued_by: 'st1', note: '致 向南：林知远说你一定会喜欢这里。', claim_deadline: atHz(cfg.giftClaimDeadline, '23:59:59'), status: 'issued', claimed_by: null, claimed_at: null, bound_phone: invitee.phone, held_by: invitee.id, created_at: ago(1) },
    { id: 'iv-open', token: 'SV-WELCOME', issued_by: 'st1', note: '首批受邀朋友 · 演示用邀请（任何手机号可领）', claim_deadline: atHz(cfg.giftClaimDeadline, '23:59:59'), status: 'issued', claimed_by: null, claimed_at: null, bound_phone: null, held_by: null, created_at: ago(3) },
    { id: 'iv-old', token: 'SV-MISSED', issued_by: 'st1', note: '致 一位没来得及领取的朋友', claim_deadline: ago(2), status: 'issued', claimed_by: null, claimed_at: null, bound_phone: '13900000099', held_by: null, created_at: ago(30) },
  );

  // nightly sessions: yesterday (history) through the next nine nights
  for (let i = -1; i <= 9; i++) {
    const date = addDays(today, i);
    const [title, en, performers] = SHOWS[(i + 7) % SHOWS.length];
    db.sessions.push({ id: 's' + date.replaceAll('-', ''), date, title, en, performers, confirm_policy: 'tiered', status: i < 0 ? 'closed' : 'on_sale', reserved: ['B05', 'B06'], paused: [], show_start: cfg.showStart, hold_deadline: cfg.holdDeadline });
  }
  const S = i => db.sessions[i + 1];

  // bookings
  const book = (u, sessionIdx, zone, codes, party, status, opts = {}) => {
    const s = S(sessionIdx);
    const z = zoneOf(zone);
    const member = !!db.memberships.find(m => m.user_id === u.id && Date.parse(m.start_at) <= t && t <= Date.parse(m.end_at));
    const kind = z.kind === 'booth' ? 'booth' : 'seats';
    const lines = codes.map(c => (kind === 'booth' ? { code: c, seats: resourceOf(c).capacity } : { code: c, seats: c === codes[codes.length - 1] ? party - (codes.length - 1) * resourceOf(codes[0]).capacity : resourceOf(c).capacity }));
    if (kind === 'seats' && codes.length === 1) lines[0].seats = party;
    const tier = resourceOf(codes[0]).tier;
    const pr = cfg.prices[tier];
    const deposit = kind === 'booth' ? fen((member ? pr.member : pr.guest) * cfg.depositRatio) : 0;
    const tickets = kind === 'seats' && !member ? party : 0;
    const total = kind === 'booth' ? deposit * codes.length : tickets * cfg.ticketPrice;
    const created = opts.created || ago(2);
    const b = {
      id: 'bk' + rid(8), code: 'LL-' + token(4), user_id: u.id, session_id: s.id, date: s.date, zone, kind, party_size: party, units: codes.length,
      identity_snapshot: member ? 'member_active' : 'non_member', lines, confirm_mode: kind === 'booth' || codes.length > 1 ? 'manual' : 'instant',
      manual_reasons: kind === 'booth' ? ['booth'] : [], note: opts.note || '', explanation: '', status,
      lock_expires_at: null, confirm_deadline_at: status === 'pending_confirm' ? iso(Date.parse(created) + cfg.confirmMinutes * MIN) : null,
      table_released: false, reject_reason: opts.reason || '', suggestion: opts.suggestion || '', suggestion_zone: opts.suggestionZone || '',
      price_snapshot: { lines: codes.map(c => ({ code: c, deposit: kind === 'booth' ? deposit : 0, tickets: kind === 'seats' && !member ? party : 0 })), deposit_each: deposit, min_spend_member: kind === 'booth' ? pr.member : 0, min_spend_guest: kind === 'booth' ? pr.guest : 0, ticket_price: cfg.ticketPrice, tickets, total_due: total },
      rules_version: RULES_VERSION, created_at: created, paid_at: total ? created : null, confirmed_at: status === 'confirmed' || status === 'fulfilled' ? iso(Date.parse(created) + 6 * MIN) : null,
      verified_at: status === 'fulfilled' ? ago(sessionIdx < 0 ? 0.9 : 0) : null, history: [{ status, at: created }],
    };
    db.bookings.push(b);
    if (total) db.payments.push({ id: 'pm' + rid(6), kind: kind === 'booth' ? 'deposit' : 'ticket', user_id: u.id, booking_id: b.id, amount: total, provider: 'mock', status: 'paid', created_at: created, paid_at: created });
    const live = ['pending_confirm', 'confirmed', 'fulfilled'].includes(status);
    if (live && sessionIdx >= 0) for (const l of lines) db.occupancies.push({ id: 'oc' + rid(8), resource: l.code, session_id: s.id, booking_id: b.id, kind: status === 'pending_confirm' ? 'pending_hold' : 'confirmed', seats: kind === 'seats' ? l.seats : null, expires_at: null, released_at: null, release_reason: null, used_at: status === 'fulfilled' ? b.verified_at : null });
    if (tickets && (status === 'confirmed' || status === 'fulfilled')) db.tickets.push({ id: 'tk' + rid(6), booking_id: b.id, session_id: s.id, user_id: u.id, count: tickets, drink_redeemed: status === 'fulfilled', verification: status === 'fulfilled' ? 'verified' : 'unverified' });
    return b;
  };
  // tonight
  book(U(4), 0, 'wall', ['B01'], 6, 'confirmed', { created: ago(1, 3) });
  const guestBooth = addUser('王越', 'Wang Yue', '13700000002', { created_at: ago(2) });
  book(guestBooth, 0, 'wall', ['B03'], 5, 'pending_confirm', { created: ago(0, 0, 12), note: '' });
  book(U(1), 0, 'lounge', ['B07'], 5, 'pending_confirm', { created: ago(0, 0, 26), note: '想要靠近吧台那一侧' });
  book(addUser('赵小满', 'Zhao Xiaoman', '13700000003', { created_at: ago(1) }), 0, 'tables', ['T01'], 3, 'confirmed', { created: ago(0, 5) });
  book(U(9), 0, 'tables', ['T02'], 4, 'confirmed', { created: ago(0, 4) });
  book(U(12), 0, 'bar', ['S01'], 1, 'confirmed', { created: ago(0, 2) });
  book(U(16), 0, 'pit', ['C01'], 2, 'confirmed', { created: ago(0, 1) });
  book(addUser('李同', 'Li Tong', '13700000004', { created_at: ago(1) }), 0, 'pairs', ['P01'], 2, 'confirmed', { created: ago(0, 6) });
  // tomorrow and beyond
  book(lin, 1, 'wall', ['B02'], 4, 'confirmed', { created: ago(1) });
  book(visitor, 1, 'pairs', ['P02'], 2, 'confirmed', { created: ago(0, 8) });
  book(U(3), 2, 'round', ['B05'], 8, 'confirmed', { created: ago(1) });
  book(U(17), 3, 'wall', ['B04'], 6, 'confirmed', { created: ago(0, 20) });
  // history
  book(lin, -1, 'tables', ['T03'], 2, 'fulfilled', { created: ago(3) });
  const rej = book(visitor, -1, 'wall', ['B02'], 5, 'rejected', { created: ago(2), reason: '那晚墙边卡座已被包场。', suggestion: '可以改订沙龙沙发，或者第二天的墙边卡座。', suggestionZone: 'lounge' });
  const rp = db.payments.find(p => p.booking_id === rej.id);
  db.refunds.push({ id: 'rf' + rid(6), payment_id: rp.id, booking_id: rej.id, user_id: visitor.id, amount: rp.amount, reason: 'rejected', status: 'succeeded', created_at: ago(2), settled_at: ago(1, 22) });

  // events: panels, podcasts, roundtables
  const ev = (id, kind, title, en, dayOffset, from, to, layer, capacity, extra = {}) => {
    const date = addDays(today, dayOffset);
    db.events.push({ id, kind, title, en, intro: extra.intro || '', host: extra.host || '', guests: extra.guests || '', start_at: atHz(date, from), end_at: atHz(date, to), location: extra.location || '3F · library live', signup_open_at: ago(10), signup_close_at: atHz(date, from), capacity, layer, public_signup: !!extra.public, teaser: { title, hook: extra.hook || '' }, tags: extra.tags || [], status: 'published' });
  };
  ev('ev-hand', 'panel', '闭门分享：机器人的手', 'The Robot’s Hand', -5, '15:00', '17:00', 1, 20, { host: '季长风', guests: '叶闻舟', intro: '灵巧手为什么这么难？两位一线工程师讲他们拆坏过的东西。不录音外传，只给到场的人回放。', hook: '两位一线工程师，讲他们拆坏过的东西。' });
  ev('ev-agent', 'roundtable', '开放座谈：AI Agent 的商业模式', 'Roundtable: The Agent Business', 0, '15:00', '16:30', 1, 12, { host: '陈牧之', intro: '一张圆桌，一个话题。带着你的观点或问题来，谁都可以坐下。', hook: '一张圆桌，一个话题，谁都可以坐下。', location: '圆桌座谈 · 1957' });
  ev('ev-read', 'roundtable', '早间座谈：读《The Power Law》第三章', 'Morning Read: The Power Law, ch. 3', 1, '11:00', '12:00', 1, 10, { host: '周以宁', intro: '读完第三章即可加入。书在 3F 书架，可以现场借。', hook: '读完第三章即可加入。', location: '座谈沙龙' });
  // daytime roundtables for the week: open-format, one topic, members sign up
  ev('rt-funding', 'roundtable', '开放座谈：第一次融资，先找谁？', 'Roundtable: Who to Call First', 1, '15:00', '16:30', 1, 12, { host: '江念', intro: '天使、机构、产业资本，第一笔钱该找谁？带着你的项目阶段来，一起聊。投资人和创始人都欢迎。', hook: '第一笔钱该找谁？', location: '座谈沙龙' });
  ev('rt-chips', 'roundtable', '早间座谈：《芯片战争》读书会', 'Morning Read: Chip War', 2, '10:30', '11:30', 1, 10, { host: '周以宁', intro: '这次读第一部分。没读完也可以来听，书在 3F 书架，可以现场借。', hook: '这次读第一部分。', location: '座谈沙龙' });
  ev('rt-customer', 'roundtable', '开放座谈：机器人公司的第一个客户', 'Roundtable: The First Customer', 2, '16:00', '17:30', 1, 12, { host: '季长风', intro: '第一个付钱的客户是怎么来的？请做过交付的朋友讲讲踩过的坑。', hook: '第一个付钱的客户是怎么来的？', location: '圆桌座谈 · 1976' });
  ev('rt-llm', 'roundtable', '开放座谈：小团队怎么用好大模型', 'Roundtable: Small Teams, Big Models', 3, '15:00', '16:30', 1, 12, { host: '顾言', intro: '五个人以内的团队，大模型到底用在哪里最值？欢迎带上你们的真实用法。', hook: '五个人以内的团队，大模型用在哪最值？', location: '圆桌座谈 · 1957' });
  ev('rt-founder', 'roundtable', '开放座谈：从工程师到创始人', 'Roundtable: Engineer to Founder', 5, '14:00', '15:30', 1, 10, { host: '陆星河', intro: '写代码的人第一次当老板，最难的是什么？几位过来人分享，也欢迎正在犹豫的你。', hook: '写代码的人第一次当老板，最难的是什么？', location: '座谈沙龙' });
  ev('rt-weekly', 'roundtable', '早间座谈：一周硬科技新闻', 'Morning: The Week in Deep Tech', 6, '11:00', '12:00', 1, 10, { host: '许嘉禾', intro: '挑三条本周的硬科技新闻，各说十分钟，再一起聊聊背后的生意。', hook: '挑三条新闻，聊背后的生意。', location: '座谈沙龙' });
  ev('ev-podcast', 'podcast', '播客现场录制 · 第 01 期', 'Live Podcast, Episode 01', 2, '16:00', '17:30', 0, 30, { host: '许嘉禾', guests: '陈牧之', intro: '《Something Ventured》第一期：谁在给机器人下注？现场观众的问题会被剪进正片。', hook: '谁在给机器人下注？', public: true });
  ev('ev-embodied', 'panel', '闭门分享：具身智能的下一个十年', 'Embodied AI, the Next Decade', 4, '15:00', '17:00', 1, 20, { host: '苏砚', guests: '傅辰 · 周以宁', intro: '数据、硬件、商业化，哪一个会先成为瓶颈？两位创始人与一位投资人的闭门对谈。', hook: '数据、硬件、商业化，哪一个会先成为瓶颈？' });
  ev('ev-public', 'panel', '公开课：风险投资的八十年', 'Eighty Years of Venture', 3, '14:00', '15:30', 0, 40, { host: '江念', intro: '从 1946 年的 ARD 到今天的 AI 基金：一堂讲给所有人的课。非会员可报名。', hook: '从 1946 年的 ARD 讲到今天。', public: true });
  ev('ev-maker', 'maker', '创客午后：拆一台扫地机器人', 'Maker Afternoon: Teardown', 5, '14:00', '17:00', 1, 12, { host: '季长风', intro: '带上螺丝刀。我们拆开一台扫地机器人，看看传感器是怎么排布的。', hook: '带上螺丝刀。' });
  const reg = (eventId, u, status = 'registered', hosted = false) => db.registrations.push({ id: 'rg' + rid(6), event_id: eventId, user_id: u.id, status, hosted, created_at: ago(6) });
  [U(14), lin, U(6), U(2), U(10)].forEach((u, i) => reg('ev-hand', u, 'attended', i === 0));
  [U(2), U(5), U(12)].forEach(u => reg('ev-agent', u));
  [U(1), U(9)].forEach(u => reg('ev-read', u));
  [U(2), U(3), U(8), U(13)].forEach(u => reg('rt-funding', u));
  [U(5), U(12)].forEach(u => reg('rt-chips', u));
  [U(4), U(6), U(10), U(11), U(14), U(16), U(17), U(18), U(19), U(20), U(2)].forEach(u => reg('rt-customer', u));
  [U(9)].forEach(u => reg('rt-llm', u));
  [U(3), U(8), visitor].forEach(u => reg('ev-podcast', u));
  [U(4), U(17), U(1), U(6), U(11)].forEach(u => reg('ev-embodied', u));
  // unlocks that those facts imply
  const unlock = (u, key, source, at) => db.unlocks.push({ id: 'ul' + rid(6), user_id: u.id, key, source, granted_by: null, at, revoked_at: null });
  [U(14), lin, U(6), U(2), U(10)].forEach(u => unlock(u, 'recordings', 'event_attended', ago(5)));
  unlock(U(14), 'speakers', 'hosted_session', ago(5));
  unlock(U(1), 'archive', 'staff_grant', ago(8));

  // daytime: check-ins and meetings
  [U(1), U(2), U(9), U(12), U(19), U(20)].forEach((u, i) => {
    const day = addDays(today, -1 - (i % 3));
    const at = atHz(day, ['11:20', '14:05', '15:40', '16:30', '13:15', '10:50'][i]); // members' hours only
    db.checkins.push({ id: 'ci' + rid(6), user_id: u.id, date: day, at, companions: i % 3 });
    unlock(u, 'shelf', 'checkin_count', at);
  });
  db.meetings.push(
    { id: 'mt' + rid(6), user_id: lin.id, date: addDays(today, 1), start: '14:00', end: '16:00', party_size: 5, needs: '五个人，需要投影和白板。', status: 'accepted', counter: null, reply: '已为你留好沙龙沙发 1998，投影备好。', created_at: ago(1) },
    { id: 'mt' + rid(6), user_id: lin.id, date: addDays(today, 3), start: '17:00', end: '19:30', party_size: 8, needs: '八个人的季度复盘。', status: 'counter_proposed', counter: { start: '16:30', end: '18:30', note: '会议不能跨过 19:00，建议提前半小时开始。' }, reply: '', created_at: ago(0, 6) },
    { id: 'mt' + rid(6), user_id: U(4).id, date: addDays(today, 2), start: '10:30', end: '12:00', party_size: 6, needs: '投资人见面，需要安静。', status: 'submitted', counter: null, reply: '', created_at: ago(0, 3) },
  );
  db.shelf.push({ id: 'sh' + rid(6), user_id: U(1).id, book: 'k1', date: addDays(today, -2), at: ago(2) });

  // notices for the personas
  const note = (u, kind, title, body, at, read = true) => db.notices.push({ id: 'n' + rid(8), to: u.id, kind, title, body, at, read });
  note(lin, 'meeting', '门店提议调整会议时间', '会议不能跨过 19:00，建议改为 16:30–18:30。', ago(0, 6), false);
  note(lin, 'booking', '已交割 · 墙边卡座', '明晚的墙边卡座已确认，桌号 B02「1968」。', ago(1), true);
  note(visitor, 'refund', '退款已到账', `${yuan(rp.amount)} 已原路退回。`, ago(1, 22), false);
  note(visitor, 'booking', '本轮未进 · 门店未接受', '那晚墙边卡座已被包场。可以改订沙龙沙发，或者第二天的墙边卡座。', ago(2), true);
  db.audit.push({ id: 'au' + rid(6), actor: 'st1', action: 'booking.reject', object_type: 'booking', object_id: rej.id, reason: '那晚墙边卡座已被包场。', at: ago(2) });
  return db;
}
function structuredCopy(v) { return JSON.parse(JSON.stringify(v)); }

/* =========================================================
   Derived facts
   ========================================================= */
const userOf = (db, id) => byId(db.users, id);
const segsOf = (db, uid) => db.memberships.filter(m => m.user_id === uid).sort((a, b) => a.start_at.localeCompare(b.start_at));
const activeSeg = (db, uid, t) => segsOf(db, uid).find(m => Date.parse(m.start_at) <= t && t <= Date.parse(m.end_at));
const latestApp = (db, uid) => db.applications.filter(a => a.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
const heldInvite = (db, u, t) => db.invites.find(i => i.status === 'issued' && Date.parse(i.claim_deadline) >= t && (i.held_by === u.id || (i.bound_phone && i.bound_phone === u.phone)));

export function identityOf(db, u, t) {
  if (!u) return 'guest';
  if (activeSeg(db, u.id, t)) return 'member_active';
  if (heldInvite(db, u, t)) return 'invitee';
  const app = latestApp(db, u.id);
  if (app && ['under_review', 'need_info', 'approved_awaiting_payment'].includes(app.status)) return 'applicant';
  if (segsOf(db, u.id).length) return 'member_expired';
  return 'non_member';
}
const isMemberOn = (db, u, date) => !!u && segsOf(db, u.id).some(m => hzDate(m.start_at) <= date && date <= hzDate(m.end_at));

function membershipView(db, u, t) {
  const segs = segsOf(db, u.id);
  if (!segs.length) return null;
  const cur = activeSeg(db, u.id, t);
  const last = segs[segs.length - 1];
  const end = cur ? segs.filter(s => Date.parse(s.start_at) >= Date.parse(cur.start_at)).reduce((e, s) => (s.end_at > e ? s.end_at : e), cur.end_at) : last.end_at;
  const daysLeft = daysBetween(hzDate(t), hzDate(end));
  const sinceExpiry = cur ? 0 : daysBetween(hzDate(end), hzDate(t));
  return {
    active: !!cur, member_no: u.member_no, source: (cur || last).source, since: segs[0].start_at, end_at: end, days_left: daysLeft,
    expiring_soon: !!cur && daysLeft <= 7, expired_days: sinceExpiry,
    can_renew: !!cur || sinceExpiry <= db.config.renewWithoutReviewDays,
    segments: segs.map(s => ({ source: s.source, start_at: s.start_at, end_at: s.end_at })),
  };
}

/* ---------- inventory ---------- */
const liveOcc = (db, t) => db.occupancies.filter(o => !o.released_at && (!o.expires_at || Date.parse(o.expires_at) > t));
const sessionOf = (db, id) => byId(db.sessions, id);

/* the state of every table for one viewer (spec 9.2), top rule wins */
function tableStates(db, session, viewer, t, { admin = false } = {}) {
  const occ = liveOcc(db, t).filter(o => o.session_id === session.id);
  const member = viewer && isMemberOn(db, viewer, session.date);
  const beforeRelease = t < Date.parse(atHz(session.date, db.config.switchAt));
  const out = {};
  for (const r of RESOURCES) {
    const mine = occ.filter(o => o.resource === r.code);
    const taken = mine.reduce((s, o) => s + (r.unit === 'whole' ? r.capacity : (o.seats || 0)), 0);
    const reserved = session.reserved.includes(r.code);
    let state;
    const ownBooking = viewer && mine.find(o => o.booking_id && (byId(db.bookings, o.booking_id) || {}).user_id === viewer.id);
    if (session.paused.includes(r.code)) state = 'paused';
    else if (!admin && ownBooking) state = 'mine';
    else if (r.unit === 'whole' && mine.length) {
      const k = mine[0].kind;
      state = admin ? ({ payment_lock: 'locking', pending_hold: 'pending', confirmed: 'booked', offline_hold: 'offline' })[k] : k === 'payment_lock' ? 'locking' : 'booked';
    } else if (r.unit === 'seats' && taken >= r.capacity) state = admin && mine.some(o => o.kind === 'pending_hold') ? 'pending' : 'booked';
    else if (reserved && admin) state = 'reserved_open';
    else if (reserved && !member && beforeRelease) state = 'reserved_sealed';
    else if (reserved && member) state = 'reserved_open';
    else state = admin && mine.some(o => o.kind === 'pending_hold') ? 'pending' : 'available';
    out[r.code] = { state, taken: r.unit === 'seats' ? Math.min(r.capacity, taken) : 0, reserved, booking: admin && mine[0] ? mine[0].booking_id || null : undefined, hold: admin && mine[0] && mine[0].hold_id ? mine[0].hold_id : undefined };
  }
  return out;
}

function priceFor(db, tier, member) {
  const p = db.config.prices[tier] || { member: 0, guest: 0 };
  return { min_member: p.member, min_guest: p.guest, deposit_member: fen(p.member * db.config.depositRatio), deposit_guest: fen(p.guest * db.config.depositRatio), min: member ? p.member : p.guest, deposit: fen((member ? p.member : p.guest) * db.config.depositRatio) };
}

function zoneSummary(db, session, viewer, t, states) {
  const member = viewer && isMemberOn(db, viewer, session.date);
  return ZONES.map(z => {
    const rs = RESOURCES.filter(r => r.zone === z.id);
    const free = r => ['available', 'reserved_open'].includes(states[r.code].state);
    if (z.kind === 'booth') {
      const cap = rs[0].capacity;
      return { id: z.id, kind: 'booth', unit: 'booth', total: rs.length, free: rs.filter(free).length, capacity: cap, sealed: rs.some(r => states[r.code].state === 'reserved_sealed'), reserved: rs.some(r => states[r.code].reserved), price: priceFor(db, rs[0].tier, member) };
    }
    const seatsTotal = rs.reduce((s, r) => s + r.capacity, 0);
    const seatsFree = rs.filter(r => states[r.code].state !== 'paused').reduce((s, r) => s + (r.capacity - states[r.code].taken), 0);
    return { id: z.id, kind: z.kind, unit: 'seat', total: seatsTotal, free: Math.max(0, seatsFree), capacity: rs[0].capacity, sealed: false, reserved: false, ticket: member ? 0 : db.config.ticketPrice };
  });
}

/* ---------- booking: quote, then create (zone-based) ---------- */
function bookingWindow(db, viewer, t) {
  const member = identityOf(db, viewer, t) === 'member_active';
  const days = member ? db.config.windowMember : db.config.windowGuest;
  const start = tonightDate(db.config, t);
  return { member, dates: Array.from({ length: days }, (_, i) => addDays(start, i)) };
}

function quote(db, user, args, t) {
  const session = sessionOf(db, args.session_id);
  if (!session || session.status !== 'on_sale') fail('这一场暂不开放预订', 'not_found', 404);
  const win = bookingWindow(db, user, t);
  if (!win.dates.includes(session.date)) ruleFail('R-BK-03', `${win.member ? '会员' : '非会员'}可以预订 ${win.dates.length} 天内的场次`);
  if (t > Date.parse(atHz(session.date, db.config.onlineCutoff))) ruleFail('R-BK-05', `当晚 ${db.config.onlineCutoff} 后停止线上订座，请到现场`);
  const z = zoneOf(args.zone);
  if (!z) fail('请选择一个区域');
  const party = parseInt(args.party_size, 10);
  if (!(party >= 1 && party <= 40)) fail('请填写人数');
  const member = isMemberOn(db, user, session.date);
  const warnings = [];
  if (identityOf(db, user, t) === 'member_active' && !member) warnings.push({ rule: 'R-BK-04', text: '这一晚超出了你的会员有效期，将按非会员规则预订；先续费可按会员规则。' });
  const states = tableStates(db, session, user, t);
  const reasons = [];
  let lines = [];
  let required = 1;
  const extra = Math.max(0, Math.min(2, parseInt(args.extra, 10) || 0));
  const note = cleanText(args.note, 120);
  const explanation = cleanText(args.explanation, 120);
  const already = db.bookings.filter(b => b.user_id === (user && user.id) && b.session_id === session.id && ['pending_payment', 'pending_confirm', 'confirmed'].includes(b.status));
  if (already.length) warnings.push({ rule: 'R-BK-11', text: `你这一晚已有 ${already.reduce((s, b) => s + b.units, 0)} 桌` });
  if (z.kind === 'booth') {
    const rs = RESOURCES.filter(r => r.zone === z.id);
    const cap = rs[0].capacity;
    required = Math.ceil(party / cap);
    const count = required + extra;
    if (count > db.config.maxResources) ruleFail('R-BK-06', `一笔订单最多 ${db.config.maxResources} 张桌，更多请分开下单或联系门店`);
    const free = rs.filter(r => ['available', 'reserved_open'].includes(states[r.code].state))
      .sort((a, b) => (states[b.code].reserved - states[a.code].reserved) * (member ? 1 : -1) || a.code.localeCompare(b.code));
    if (free.length < count) fail(free.length ? `${z.zh}这一晚只剩 ${free.length} 张了` : `${z.zh}这一晚已经订满了`, 'conflict', 409, 'R-BK-12');
    lines = free.slice(0, count).map(r => ({ code: r.code, seats: r.capacity }));
    reasons.push('booth');
    if (count > 1) reasons.push('multi_resource');
    if (extra) reasons.push('over_required');
    const reservedBefore = already.flatMap(b => b.lines.map(l => l.code)).filter(c => session.reserved.includes(c)).length;
    if (lines.filter(l => session.reserved.includes(l.code)).length + reservedBefore > 1) reasons.push('extra_reserved');
    if ((reasons.includes('over_required') || reasons.includes('extra_reserved')) && !explanation) ruleFail(reasons.includes('extra_reserved') ? 'R-BK-10' : 'R-BK-08', '多要的桌需要写一句说明，门店人工确认');
  } else {
    if (!member) {
      if (!db.config.ticketSalesEnabled) ruleFail('R-TK-07', '门票暂未开售，非会员可以预订卡座');
      const bought = db.tickets.filter(k => k.user_id === (user && user.id) && k.session_id === session.id && k.verification !== 'expired').reduce((s, k) => s + k.count, 0)
        + db.bookings.filter(b => b.user_id === (user && user.id) && b.session_id === session.id && b.status === 'pending_payment').reduce((s, b) => s + (b.price_snapshot.tickets || 0), 0);
      if (party > db.config.ticketCompanions + 1) ruleFail('R-TK-03', `购票人本人到场，最多带 ${db.config.ticketCompanions} 位同行人`);
      if (bought + party > db.config.ticketLimit) ruleFail('R-TK-02', `每人每场最多 ${db.config.ticketLimit} 张票${bought ? `，你已买了 ${bought} 张` : ''}`);
    }
    const rs = RESOURCES.filter(r => r.zone === z.id && states[r.code].state !== 'paused');
    const freeOf = r => r.capacity - states[r.code].taken;
    const whole = rs.filter(r => states[r.code].state !== 'booked' && freeOf(r) >= party).sort((a, b) => freeOf(a) - freeOf(b) || a.code.localeCompare(b.code))[0];
    if (whole) lines = [{ code: whole.code, seats: party }];
    else {
      let left = party;
      for (const r of rs.filter(r => freeOf(r) > 0).sort((a, b) => freeOf(b) - freeOf(a))) {
        if (left <= 0) break;
        const n = Math.min(left, freeOf(r));
        lines.push({ code: r.code, seats: n });
        left -= n;
      }
      if (left > 0) fail(`${z.zh}这一晚只剩 ${party - left} 个座位`, 'conflict', 409, 'R-BK-12');
      if (lines.length > db.config.maxResources) ruleFail('R-BK-06', `${z.zh}剩下的座位太分散了，请减少人数或换个区域`);
    }
    if (lines.length > 1) reasons.push('multi_resource');
  }
  if (note) reasons.push('special_note');
  if (session.confirm_policy === 'all_manual') reasons.push('session_all_manual');
  if (already.length && z.kind === 'booth') reasons.push('over_required');
  const tier = resourceOf(lines[0].code).tier;
  const pr = priceFor(db, tier, member);
  const deposit = z.kind === 'booth' ? pr.deposit : 0;
  const tickets = z.kind !== 'booth' && !member ? party : 0;
  const total = z.kind === 'booth' ? deposit * lines.length : tickets * db.config.ticketPrice;
  return {
    session, zone: z, member, party, required, extra, note, explanation, lines, warnings,
    confirm_mode: reasons.length ? 'manual' : 'instant', manual_reasons: [...new Set(reasons)],
    price: { min_member: pr.min_member, min_guest: pr.min_guest, deposit_member: pr.deposit_member, deposit_guest: pr.deposit_guest, deposit_each: deposit, tickets, ticket_price: db.config.ticketPrice, ticket_drink: db.config.ticketDrink, total_due: total },
  };
}

const quoteView = q => ({
  session_id: q.session.id, zone: q.zone.id, member: q.member, party_size: q.party, required: q.required, units: q.lines.length,
  seats: q.lines.reduce((s, l) => s + l.seats, 0), extra: q.extra, warnings: q.warnings, confirm_mode: q.confirm_mode, manual_reasons: q.manual_reasons, price: q.price,
});

/* =========================================================
   Methods
   ========================================================= */
const METHODS = {};
const def = (name, role, fn) => { METHODS[name] = { role, fn }; };

function log(ctx, action, object_type, object_id, extra = {}) {
  ctx.db.audit.unshift({ id: 'au' + rid(6), actor: ctx.staff ? ctx.staff.id : ctx.user ? ctx.user.id : 'system', action, object_type, object_id, at: iso(ctx.now), ...extra });
  ctx.db.audit.length = Math.min(ctx.db.audit.length, 400);
}
function notify(ctx, uid, kind, title, body = '') {
  ctx.db.notices.unshift({ id: 'n' + rid(8), to: uid, kind, title, body, at: iso(ctx.now), read: false });
  ctx.db.notices.length = Math.min(ctx.db.notices.length, 600);
  ctx.touch('notices');
}
function issue(ctx, kind, id) {
  const t = rid(32);
  ctx.db.tokens[t] = { kind, id, at: iso(ctx.now) };
  const keys = Object.keys(ctx.db.tokens);
  if (keys.length > 400) keys.sort((a, b) => ctx.db.tokens[a].at.localeCompare(ctx.db.tokens[b].at)).slice(0, keys.length - 400).forEach(k => delete ctx.db.tokens[k]);
  ctx.touch('session');
  return t;
}
const need = (ctx, ...ids) => { const idn = identityOf(ctx.db, ctx.user, ctx.now); if (!ids.includes(idn)) fail(ids.includes('member_active') ? '这是会员功能' : '现在不能这样操作', 'forbidden', 403); return idn; };
const unlockedKeys = (db, u, t) => (u && identityOf(db, u, t) === 'member_active' ? db.unlocks.filter(x => x.user_id === u.id && !x.revoked_at).map(x => x.key) : []);
function grant(ctx, u, key, source, by = null) {
  if (ctx.db.unlocks.some(x => x.user_id === u.id && x.key === key && !x.revoked_at)) return false;
  ctx.db.unlocks.push({ id: 'ul' + rid(6), user_id: u.id, key, source, granted_by: by, at: iso(ctx.now), revoked_at: null });
  const item = ctx.db.content.find(c => c.key === key);
  notify(ctx, u.id, 'unlock', `解锁 · ${item ? item.teaser.title : key}`, item ? item.teaser.hook : '');
  ctx.touch('content');
  return true;
}
function unlockBy(ctx, u, type) {
  const n = { checkin_count: ctx.db.checkins.filter(c => c.user_id === u.id).length, event_attended: ctx.db.registrations.filter(r => r.user_id === u.id && r.status === 'attended').length, hosted_session: ctx.db.registrations.filter(r => r.user_id === u.id && r.hosted).length };
  for (const c of ctx.db.content) if (c.active !== false && c.unlock_rule && c.unlock_rule.type === type && n[type] >= (c.unlock_rule.n || 1)) grant(ctx, u, c.key, type);
}

function release(ctx, b, reason) {
  for (const o of ctx.db.occupancies) if (o.booking_id === b.id && !o.released_at) { o.released_at = iso(ctx.now); o.release_reason = reason; }
  ctx.touch('board');
}
function refundFor(ctx, b, reason) {
  const p = ctx.db.payments.find(x => x.booking_id === b.id && x.status === 'paid');
  if (!p || ctx.db.refunds.some(r => r.payment_id === p.id)) return null;
  const r = { id: 'rf' + rid(6), payment_id: p.id, booking_id: b.id, user_id: b.user_id, amount: p.amount, reason, status: 'processing', created_at: iso(ctx.now), settled_at: null };
  ctx.db.refunds.push(r);
  ctx.touch('ledger');
  return r;
}
function setStatus(ctx, b, status, extra = {}) {
  b.status = status;
  b.history.push({ status, at: iso(ctx.now), ...extra });
  ctx.touch('bookings');
}

/* lazy timers (spec 12.2): run before every call, idempotent */
export function sweep(db, t) {
  const changed = new Set();
  const ctx = { db, now: t, touch: (...x) => x.forEach(k => changed.add(k)), staff: null, user: null };
  for (const b of db.bookings) {
    if (b.status === 'pending_payment' && t > Date.parse(b.lock_expires_at)) { // T5
      setStatus(ctx, b, 'payment_expired');
      release(ctx, b, 'payment_timeout');
      for (const p of db.payments) if (p.booking_id === b.id && p.status !== 'paid') p.status = 'failed_closed';
    } else if (b.status === 'pending_confirm' && t > Date.parse(b.confirm_deadline_at)) { // T10
      setStatus(ctx, b, 'confirm_timeout_closed');
      release(ctx, b, 'confirm_timeout');
      const r = refundFor(ctx, b, 'confirm_timeout');
      notify(ctx, b.user_id, 'booking', '确认超时，订单已关闭', r ? `${yuan(r.amount)} 正在原路退回。` : '桌位已释放。');
    } else if (b.status === 'confirmed' && t > sessionEnd(db.config, b.date)) { // T14
      setStatus(ctx, b, 'no_show');
      release(ctx, b, 'session_closed');
      for (const k of db.tickets) if (k.booking_id === b.id && k.verification === 'unverified') k.verification = 'expired';
    }
  }
  for (const h of db.holds) if (!h.released_at && t > sessionEnd(db.config, (sessionOf(db, h.session_id) || {}).date || '2000-01-01')) h.released_at = iso(t);
  for (const r of db.refunds) if (r.status === 'processing' && t - Date.parse(r.created_at) > db.config.refundSettleSeconds * 1000) {
    r.status = 'succeeded'; r.settled_at = iso(t);
    ctx.touch('ledger');
    notify(ctx, r.user_id, 'refund', '退款已到账', `${yuan(r.amount)} 已原路退回。`);
  }
  return [...changed];
}

/* ---------- views ---------- */
const sessionView = s => s && ({ id: s.id, date: s.date, title: s.title, en: s.en, performers: s.performers, show_start: s.show_start, hold_deadline: s.hold_deadline, status: s.status, reserved: s.reserved, confirm_policy: s.confirm_policy, paused: s.paused });
function bookingView(db, b, t, admin = false) {
  const s = sessionOf(db, b.session_id);
  const pay = db.payments.find(p => p.booking_id === b.id);
  const ref = db.refunds.find(r => r.booking_id === b.id);
  const tk = db.tickets.find(k => k.booking_id === b.id);
  const redeemed = db.redemptions.filter(r => r.booking_id === b.id).reduce((x, r) => x + r.amount, 0);
  const deposit = pay && pay.kind === 'deposit' && pay.status === 'paid' ? pay.amount : 0;
  const v = {
    id: b.id, code: b.code, session: sessionView(s), date: b.date, zone: b.zone, kind: b.kind, party_size: b.party_size, units: b.units,
    lines: b.status === 'confirmed' || b.status === 'fulfilled' || admin || b.kind === 'seats' ? b.lines.map(l => ({ ...l, name: resourceOf(l.code).card.name })) : [],
    status: b.status, label: BOOKING_STATUS[b.status], confirm_mode: b.confirm_mode, manual_reasons: b.manual_reasons, note: b.note, explanation: b.explanation,
    lock_expires_at: b.lock_expires_at, confirm_deadline_at: b.confirm_deadline_at, table_released: b.table_released,
    reject_reason: b.reject_reason, suggestion: b.suggestion, suggestion_zone: b.suggestion_zone, price: b.price_snapshot, identity_snapshot: b.identity_snapshot,
    payment: pay ? { status: pay.status, amount: pay.amount, kind: pay.kind, paid_at: pay.paid_at } : null,
    refund: ref ? { status: ref.status, amount: ref.amount, created_at: ref.created_at, settled_at: ref.settled_at } : null,
    ticket: tk ? { count: tk.count, drink_redeemed: tk.drink_redeemed, verification: tk.verification } : null,
    deposit: deposit ? { paid: deposit, redeemed, left: deposit - redeemed, state: b.status === 'no_show' ? 'expired' : redeemed >= deposit ? 'used' : redeemed ? 'partially_used' : b.table_released ? 'valid_tonight_table_released' : 'unused' } : null,
    created_at: b.created_at, confirmed_at: b.confirmed_at, verified_at: b.verified_at, history: b.history, server_time: iso(t),
  };
  if (admin) { const u = userOf(db, b.user_id); v.user = u && { id: u.id, name: u.name, phone: u.phone, member_no: u.member_no }; }
  return v;
}
function eventView(db, e, u, t, layer) {
  const regs = db.registrations.filter(r => r.event_id === e.id && r.status !== 'cancelled');
  const mine = u ? regs.find(r => r.user_id === u.id) : null;
  const locked = e.layer > layer;
  const base = { id: e.id, kind: e.kind, kindInfo: EVENT_KINDS[e.kind], layer: e.layer, title: e.teaser.title, hook: e.teaser.hook, start_at: e.start_at, end_at: e.end_at, locked, tags: e.tags, status: e.status };
  if (locked) return base; // INV-11: no body for those who can't see it
  return { ...base, en: e.en, intro: e.intro, host: e.host, guests: e.guests, location: e.location, capacity: e.capacity, taken: regs.length, left: Math.max(0, e.capacity - regs.length), public_signup: e.public_signup, signup_close_at: e.signup_close_at, mine: mine ? mine.status : null, past: Date.parse(e.end_at) < t };
}
function contentBody(db, c, u, t) {
  if (!c.body.dynamic) return c.body;
  if (c.body.dynamic === 'shelf') return { books: BOOKS, mine: db.shelf.filter(s => s.user_id === u.id).map(s => ({ ...BOOKS.find(b => b.id === s.book), date: s.date })), borrowed_today: db.shelf.some(s => s.user_id === u.id && s.date === hzDate(t)), checked_in_today: db.checkins.some(c2 => c2.user_id === u.id && c2.date === hzDate(t)) };
  if (c.body.dynamic === 'recordings') return { items: db.registrations.filter(r => r.user_id === u.id && r.status === 'attended').map(r => { const e = byId(db.events, r.event_id); return { title: e.title, date: hzDate(e.start_at), host: e.host, minutes: 60 + (hash53(e.id) % 50) }; }) };
  if (c.body.dynamic === 'speakers') return { names: [...new Set(db.registrations.filter(r => r.hosted).map(r => r.user_id))].map(id => { const x = userOf(db, id); const e = db.registrations.filter(r => r.hosted && r.user_id === id).map(r => byId(db.events, r.event_id).title); return { name: x.name, en: x.en, no: x.member_no, talks: e }; }) };
  return c.body;
}
function contentFor(db, u, t, mode) {
  const idn = identityOf(db, u, t);
  const keys = unlockedKeys(db, u, t);
  return db.content.filter(c => c.active !== false).map(c => {
    if (idn !== 'member_active') {
      if (c.layer !== 1) return null; // R-LAY-03: L2/L3 are invisible to L0
      return { key: c.key, layer: 1, mode: c.mode, teaser: c.teaser, locked: true };
    }
    if (c.layer <= 1) return { key: c.key, layer: c.layer, mode: c.mode, teaser: c.teaser, locked: false, dim: c.mode !== 'any' && c.mode !== mode };
    if (keys.includes(c.key)) return { key: c.key, layer: c.layer, mode: c.mode, teaser: c.teaser, locked: false, rule: c.unlock_rule.type };
    if (c.locked_placeholder) return { key: c.key, layer: c.layer, mode: c.mode, teaser: { title: c.teaser.title, hook: c.teaser.hook }, locked: true, rule: c.unlock_rule.type };
    return null;
  }).filter(Boolean);
}

/* ---------- public ---------- */
def('ping', 'public', ctx => ({ ok: true, version: VERSION, now: ctx.now }));

def('club.info', 'public', ctx => ({ store: STORE, mode: modeAt(ctx.db.config, ctx.now), now: iso(ctx.now), config: { switchAt: ctx.db.config.switchAt, dayOpenAt: ctx.db.config.dayOpenAt, nightCloseAt: ctx.db.config.nightCloseAt } }));

def('staff.list', 'public', ctx => ctx.db.staff.map(s => ({ id: s.id, name: s.name, role: s.role, title: s.title })));

def('auth.login', 'public', (ctx, { phone, code }) => {
  phone = normPhone(phone);
  if (!/^1\d{10}$/.test(phone)) fail('请输入 11 位手机号');
  if (String(code ?? '').trim() !== DEMO_CODE) fail(`验证码不正确（演示验证码：${DEMO_CODE}）`);
  let u = ctx.db.users.find(x => x.phone === phone);
  if (!u) {
    u = { id: 'u' + rid(8), name: '', en: '', phone, city: '', company_role: '', intro: '', member_no: null, unlock_seen: false, secret: 'sv-m-' + rid(12), created_at: iso(ctx.now), notices_seen_at: '' };
    ctx.db.users.push(u);
    ctx.touch('members');
  }
  return { token: issue(ctx, 'user', u.id) };
});

export const PERSONAS = {
  non_member: '13700000001', applicant: '13900000021', need_info: '13900000024', approved: '13900000031', invitee: '13900000011', member: '13800000007', expired: '13800000015',
};
def('auth.demo', 'public', (ctx, { as }) => {
  const u = ctx.db.users.find(x => x.phone === PERSONAS[as]);
  if (!u) fail('没有这个演示身份');
  return { token: issue(ctx, 'user', u.id) };
});

def('auth.logout', 'any', ctx => { delete ctx.db.tokens[ctx.token]; ctx.touch('session'); return { ok: true }; });

/* ---------- user ---------- */
def('me', 'optional', ctx => {
  const { db, now, user: u } = ctx;
  const mode = modeAt(db.config, now);
  const idn = identityOf(db, u, now);
  if (!u) return { identity: 'guest', layer: 0, mode, now: iso(now), store: STORE, user: null };
  const app = latestApp(db, u.id);
  const inv = heldInvite(db, u, now);
  return {
    identity: idn, identityInfo: IDENTITIES[idn], layer: idn === 'member_active' ? 1 : 0, mode, now: iso(now), store: STORE,
    user: { id: u.id, name: u.name, en: u.en, phone: u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1 **** $2'), member_no: u.member_no, company_role: u.company_role, city: u.city, initials: (u.name || u.phone).slice(0, 1) },
    secret: idn === 'member_active' ? u.secret : null,
    membership: membershipView(db, u, now),
    application: app && app.status !== 'completed' ? { id: app.id, status: app.status, label: APP_STATUS[app.status], profile: app.profile, review_note: app.review_note, history: app.history, price: db.config.memberPrice } : null,
    invite: inv ? { token: inv.token, note: inv.note, deadline: inv.claim_deadline, months: db.config.giftMonths } : null,
    unlocked: unlockedKeys(db, u, now),
    play_unlock: idn === 'member_active' && !u.unlock_seen,
    unread: db.notices.filter(n => n.to === u.id && !n.read).length,
    member_price: db.config.memberPrice,
  };
});

def('profile.update', 'user', (ctx, { name }) => {
  const n = clean(name, 20);
  if (!n) fail('请填写你的称呼');
  ctx.user.name = n;
  ctx.touch('members');
  return { name: n };
});
def('unlock.seen', 'user', ctx => { ctx.user.unlock_seen = true; ctx.touch('session'); return { ok: true }; });

def('home', 'optional', ctx => {
  const { db, now, user: u } = ctx;
  const mode = modeAt(db.config, now);
  const idn = identityOf(db, u, now);
  const date = tonightDate(db.config, now);
  const s = db.sessions.find(x => x.date === date && x.status === 'on_sale') || db.sessions.find(x => x.date > date && x.status === 'on_sale');
  const states = s ? tableStates(db, s, u, now) : {};
  const zones = s ? zoneSummary(db, s, u, now, states) : [];
  const layer = idn === 'member_active' ? 1 : 0;
  const events = db.events.filter(e => e.status === 'published' && Date.parse(e.end_at) > now).sort((a, b) => a.start_at.localeCompare(b.start_at)).map(e => eventView(db, e, u, now, layer));
  const out = {
    mode, now: iso(now), identity: idn, layer, store: STORE,
    tonight: s ? { session: sessionView(s), zones, ticket_price: db.config.ticketPrice, ticket_drink: db.config.ticketDrink, ticket_sales: db.config.ticketSalesEnabled, release_at: db.config.switchAt, show_start: s.show_start } : null,
    content: contentFor(db, u, now, mode),
    events: events.slice(0, 6),
    switch_at: db.config.switchAt, day_open_at: db.config.dayOpenAt, night_close_at: db.config.nightCloseAt,
  };
  if (u) {
    out.mine = db.bookings.filter(b => b.user_id === u.id && ['pending_payment', 'pending_confirm', 'confirmed'].includes(b.status) && b.date >= date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3).map(b => bookingView(db, b, now));
  }
  if (layer === 1) {
    const today = hzDate(now);
    const ci = db.checkins.find(c => c.user_id === u.id && c.date === today);
    out.member = {
      reserved: s ? s.reserved.map(code => ({ code, name: resourceOf(code).card.name, state: states[code].state })) : [],
      checkin: { today: !!ci, at: ci ? ci.at : null, companions: ci ? ci.companions : 0, here: db.checkins.filter(c => c.date === today).length },
      meetings: db.meetings.filter(m => m.user_id === u.id && m.date >= today && !['cancelled', 'rejected', 'user_declined'].includes(m.status)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
      roundtables: events.filter(e => e.kind === 'roundtable' && hzDate(e.start_at) === today),
      unlocked: unlockedKeys(db, u, now),
    };
  }
  return out;
});

def('sessions.window', 'optional', ctx => {
  const { db, now, user: u } = ctx;
  const win = bookingWindow(db, u, now);
  return { member: win.member, days: win.dates.length, sessions: win.dates.map(d => { const s = db.sessions.find(x => x.date === d); return s ? { ...sessionView(s), past_cutoff: now > Date.parse(atHz(d, db.config.onlineCutoff)) } : { date: d, status: 'none' }; }) };
});

def('session.map', 'optional', (ctx, { session_id }) => {
  const { db, now, user: u } = ctx;
  const s = sessionOf(db, session_id);
  if (!s) fail('找不到这一场', 'not_found', 404);
  const states = tableStates(db, s, u, now);
  return {
    session: sessionView(s), identity: identityOf(db, u, now), member_on_date: isMemberOn(db, u, s.date), mode: modeAt(db.config, now), now: iso(now),
    states, zones: zoneSummary(db, s, u, now, states), release_at: atHz(s.date, db.config.switchAt),
    my_tonight: u ? db.bookings.filter(b => b.user_id === u.id && b.session_id === s.id && ['pending_payment', 'pending_confirm', 'confirmed'].includes(b.status)).reduce((x, b) => x + b.units, 0) : 0,
    ticket_sales: db.config.ticketSalesEnabled, ticket_price: db.config.ticketPrice, ticket_drink: db.config.ticketDrink, deposit_ratio: db.config.depositRatio, confirm_minutes: db.config.confirmMinutes, lock_minutes: db.config.lockMinutes,
  };
});

def('booking.quote', 'user', (ctx, args) => quoteView(quote(ctx.db, ctx.user, args, ctx.now)));

def('booking.create', 'user', (ctx, args) => {
  const { db, now, user: u } = ctx;
  const q = quote(db, u, args, now);
  const due = q.price.total_due;
  if (due > 0 && db.bookings.some(b => b.user_id === u.id && b.status === 'pending_payment')) ruleFail('R-BK-07', '你还有一笔待支付的订单，先完成或取消它');
  const b = {
    id: 'bk' + rid(8), code: 'LL-' + token(4), user_id: u.id, session_id: q.session.id, date: q.session.date, zone: q.zone.id, kind: q.zone.kind === 'booth' ? 'booth' : 'seats',
    party_size: q.party, units: q.lines.length, identity_snapshot: q.member ? 'member_active' : identityOf(db, u, now) === 'member_active' ? 'non_member' : identityOf(db, u, now),
    lines: q.lines, confirm_mode: q.confirm_mode, manual_reasons: q.manual_reasons, note: q.note, explanation: q.explanation, status: 'pending_payment',
    lock_expires_at: null, confirm_deadline_at: null, table_released: false, reject_reason: '', suggestion: '', suggestion_zone: '',
    price_snapshot: { lines: q.lines.map(l => ({ code: l.code, deposit: q.price.deposit_each, tickets: q.price.tickets ? l.seats : 0 })), deposit_each: q.price.deposit_each, min_spend_member: q.zone.kind === 'booth' ? q.price.min_member : 0, min_spend_guest: q.zone.kind === 'booth' ? q.price.min_guest : 0, ticket_price: q.price.ticket_price, tickets: q.price.tickets, total_due: due },
    rules_version: RULES_VERSION, created_at: iso(now), paid_at: null, confirmed_at: null, verified_at: null, history: [],
  };
  const occ = kind => q.lines.forEach(l => db.occupancies.push({ id: 'oc' + rid(8), resource: l.code, session_id: b.session_id, booking_id: b.id, kind, seats: b.kind === 'seats' ? l.seats : null, expires_at: kind === 'payment_lock' ? b.lock_expires_at : null, released_at: null, release_reason: null, used_at: null }));
  if (due > 0) { // T1: lock everything for ten minutes (INV-03: all lines or none — quote already proved they are free)
    b.lock_expires_at = iso(now + db.config.lockMinutes * MIN);
    b.history.push({ status: 'pending_payment', at: iso(now) });
    occ('payment_lock');
    db.payments.push({ id: 'pm' + rid(6), kind: b.kind === 'booth' ? 'deposit' : 'ticket', user_id: u.id, booking_id: b.id, amount: due, provider: 'mock', status: 'unpaid', created_at: iso(now), expires_at: b.lock_expires_at, paid_at: null });
  } else if (q.confirm_mode === 'instant') { // T2
    b.status = 'confirmed'; b.confirmed_at = iso(now);
    b.history.push({ status: 'confirmed', at: iso(now) });
    occ('confirmed');
  } else { // T2b
    b.status = 'pending_confirm'; b.confirm_deadline_at = iso(now + db.config.confirmMinutes * MIN);
    b.history.push({ status: 'pending_confirm', at: iso(now) });
    occ('pending_hold');
  }
  db.bookings.push(b);
  ctx.touch('bookings', 'board');
  log(ctx, 'booking.create', 'booking', b.id, { reason: `${q.zone.zh} · ${q.party} 人` });
  return bookingView(db, b, now);
});

def('booking.pay', 'user', (ctx, { id }) => { // mock payment channel (payment.provider = mock)
  const { db, now } = ctx;
  const b = db.bookings.find(x => x.id === id && x.user_id === ctx.user.id);
  if (!b) fail('找不到这笔订单', 'not_found', 404);
  const p = db.payments.find(x => x.booking_id === b.id);
  if (p && p.status === 'paid') return bookingView(db, b, now); // R-PAY-06: idempotent
  if (b.status !== 'pending_payment' && b.status !== 'payment_expired') fail('这笔订单不需要支付');
  if (b.status === 'payment_expired') { // T6 / T7: the payment arrived after the lock
    const occ = liveOcc(db, now).filter(o => o.session_id === b.session_id && o.booking_id !== b.id);
    const clash = b.lines.some(l => { const r = resourceOf(l.code); const taken = occ.filter(o => o.resource === l.code).reduce((s, o) => s + (r.unit === 'whole' ? r.capacity : o.seats), 0); return r.unit === 'whole' ? taken > 0 : taken + l.seats > r.capacity; });
    p.status = 'paid'; p.paid_at = iso(now); b.paid_at = iso(now);
    if (clash) {
      setStatus(ctx, b, 'cancelled', { reason: 'late_payment_conflict' });
      const r = refundFor(ctx, b, 'late_payment_conflict');
      notify(ctx, b.user_id, 'booking', '付款晚到，桌位已被订走', `${yuan(r.amount)} 正在原路退回。`);
      return bookingView(db, b, now);
    }
    b.lines.forEach(l => db.occupancies.push({ id: 'oc' + rid(8), resource: l.code, session_id: b.session_id, booking_id: b.id, kind: 'pending_hold', seats: b.kind === 'seats' ? l.seats : null, expires_at: null, released_at: null, release_reason: null, used_at: null }));
  } else {
    p.status = 'paid'; p.paid_at = iso(now); b.paid_at = iso(now);
  }
  const live = db.occupancies.filter(o => o.booking_id === b.id && !o.released_at);
  if (b.confirm_mode === 'instant') { // T3
    live.forEach(o => { o.kind = 'confirmed'; o.expires_at = null; });
    setStatus(ctx, b, 'confirmed'); b.confirmed_at = iso(now);
    if (b.price_snapshot.tickets) db.tickets.push({ id: 'tk' + rid(6), booking_id: b.id, session_id: b.session_id, user_id: b.user_id, count: b.price_snapshot.tickets, drink_redeemed: false, verification: 'unverified' });
  } else { // T4
    live.forEach(o => { o.kind = 'pending_hold'; o.expires_at = null; });
    b.confirm_deadline_at = iso(now + db.config.confirmMinutes * MIN);
    setStatus(ctx, b, 'pending_confirm');
  }
  ctx.touch('ledger', 'board');
  return bookingView(db, b, now);
});

def('booking.abandon', 'user', (ctx, { id }) => {
  const b = ctx.db.bookings.find(x => x.id === id && x.user_id === ctx.user.id);
  if (!b || b.status !== 'pending_payment') fail('这笔订单不能取消');
  setStatus(ctx, b, 'payment_expired', { reason: 'abandoned' });
  release(ctx, b, 'payment_timeout');
  for (const p of ctx.db.payments) if (p.booking_id === b.id && p.status !== 'paid') p.status = 'failed_closed';
  return bookingView(ctx.db, b, ctx.now);
});

def('booking.withdraw', 'user', ctx => ruleFail('R-PAY-08', '待确认期间撤回的规则老板还没拍板，暂不开放（Q-16）'));
def('booking.cancel', 'user', ctx => ruleFail('R-PAY-07', '已确认订单的取消与退款规则老板还没拍板，暂不开放（Q-10）'));

def('bookings.mine', 'user', ctx => ctx.db.bookings.filter(b => b.user_id === ctx.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(b => bookingView(ctx.db, b, ctx.now)));
def('booking.get', 'user', (ctx, { id }) => {
  const b = ctx.db.bookings.find(x => x.id === id && x.user_id === ctx.user.id);
  if (!b) fail('找不到这笔订单', 'not_found', 404);
  return bookingView(ctx.db, b, ctx.now);
});

def('events.list', 'optional', ctx => {
  const { db, now, user: u } = ctx;
  const layer = identityOf(db, u, now) === 'member_active' ? 1 : 0;
  return db.events.filter(e => e.status === 'published').map(e => eventView(db, e, u, now, layer))
    .sort((a, b) => (a.past || false) - (b.past || false) || (a.past ? b.start_at.localeCompare(a.start_at) : a.start_at.localeCompare(b.start_at)));
});
def('event.get', 'optional', (ctx, { id }) => {
  const e = byId(ctx.db.events, id);
  if (!e) fail('找不到这场活动', 'not_found', 404);
  return eventView(ctx.db, e, ctx.user, ctx.now, identityOf(ctx.db, ctx.user, ctx.now) === 'member_active' ? 1 : 0);
});
def('event.register', 'user', (ctx, { id }) => {
  const { db, now, user: u } = ctx;
  const e = byId(db.events, id);
  if (!e || e.status !== 'published') fail('找不到这场活动', 'not_found', 404);
  const idn = identityOf(db, u, now);
  if (e.layer === 1 && idn !== 'member_active') fail('这是会员活动', 'forbidden', 403, 'R-EV-05');
  if (e.layer === 0 && idn !== 'member_active' && !e.public_signup) ruleFail('R-EV-03', '这场活动暂只对会员开放报名');
  if (now > Date.parse(e.signup_close_at)) fail('报名已截止');
  const mine = db.registrations.find(r => r.event_id === e.id && r.user_id === u.id && r.status !== 'cancelled');
  if (mine) return eventView(db, e, u, now, idn === 'member_active' ? 1 : 0);
  const taken = db.registrations.filter(r => r.event_id === e.id && r.status !== 'cancelled').length;
  if (taken >= e.capacity) ruleFail('R-EV-04', '名额已满');
  db.registrations.push({ id: 'rg' + rid(6), event_id: e.id, user_id: u.id, status: 'registered', hosted: false, created_at: iso(now) });
  notify(ctx, u.id, 'event', `已报名 · ${e.title}`, '到场时出示会员卡或报名记录。');
  ctx.touch('events');
  return eventView(db, e, u, now, idn === 'member_active' ? 1 : 0);
});
def('event.cancel', 'user', (ctx, { id }) => {
  const r = ctx.db.registrations.find(x => x.event_id === id && x.user_id === ctx.user.id && x.status === 'registered');
  if (!r) fail('没有找到你的报名');
  r.status = 'cancelled';
  ctx.touch('events');
  return eventView(ctx.db, byId(ctx.db.events, id), ctx.user, ctx.now, identityOf(ctx.db, ctx.user, ctx.now) === 'member_active' ? 1 : 0);
});

def('content.list', 'optional', ctx => contentFor(ctx.db, ctx.user, ctx.now, modeAt(ctx.db.config, ctx.now)));
def('content.get', 'optional', (ctx, { key }) => {
  const { db, now, user: u } = ctx;
  const c = db.content.find(x => x.key === key && x.active !== false);
  if (!c) fail('找不到这一页', 'not_found', 404);
  const idn = identityOf(db, u, now);
  if (idn !== 'member_active') {
    if (c.layer !== 1) fail('找不到这一页', 'not_found', 404); // INV-11 / R-LAY-03
    return { key: c.key, layer: c.layer, teaser: c.teaser, locked: true };
  }
  if (c.layer >= 2 && !unlockedKeys(db, u, now).includes(c.key)) {
    if (!c.locked_placeholder) fail('找不到这一页', 'not_found', 404);
    return { key: c.key, layer: c.layer, teaser: c.teaser, locked: true, rule: c.unlock_rule.type };
  }
  return { key: c.key, layer: c.layer, mode: c.mode, teaser: c.teaser, locked: false, body: contentBody(db, c, u, now) };
});
def('egg.trigger', 'user', (ctx, { key }) => {
  const { db, now, user: u } = ctx;
  need(ctx, 'member_active');
  const c = db.content.find(x => x.unlock_rule && x.unlock_rule.type === 'easter_egg' && x.unlock_rule.egg_key === key);
  if (!c) fail('没有发生什么。');
  if (key === 'ink') { const x = hz(now); if (!(x.h >= 23 || x.h < 2)) fail('墨水还没有显影。23:00 以后再看看。'); }
  const fresh = grant(ctx, u, c.key, 'easter_egg');
  return { key: c.key, fresh, title: c.teaser.title };
});

def('shelf.borrow', 'user', (ctx, { id }) => {
  const { db, now, user: u } = ctx;
  need(ctx, 'member_active');
  if (!unlockedKeys(db, u, now).includes('shelf')) fail('白天签到一次后解锁', 'forbidden', 403);
  const today = hzDate(now);
  if (!db.checkins.some(c => c.user_id === u.id && c.date === today)) fail('今天先签到，再借书');
  if (db.shelf.some(s => s.user_id === u.id && s.date === today)) fail('今天已经借过一本了');
  if (!BOOKS.find(b => b.id === id)) fail('找不到这本书');
  db.shelf.push({ id: 'sh' + rid(6), user_id: u.id, book: id, date: today, at: iso(now) });
  ctx.touch('content');
  return { ok: true };
});

/* ---------- day: check-in and meetings ---------- */
def('checkin.today', 'user', ctx => {
  const { db, now, user: u } = ctx;
  const today = hzDate(now);
  const ci = db.checkins.find(c => c.user_id === u.id && c.date === today);
  const here = db.checkins.filter(c => c.date === today);
  const rt = db.events.filter(e => e.kind === 'roundtable' && hzDate(e.start_at) === today && Date.parse(e.end_at) > now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const people = here.reduce((s, c) => s + 1 + c.companions, 0);
  return {
    mode: modeAt(db.config, now), date: today, checked_in: !!ci, at: ci ? ci.at : null, companions: ci ? ci.companions : 0,
    status: `今天 ${here.length} 位会员签到，${people} 人在座。${rt ? `${hz(rt.start_at).h}:${String(hz(rt.start_at).mi).padStart(2, '0')} 有一场「${rt.title}」。` : '今天没有排座谈，适合读书。'}${people > 30 ? '有点热闹。' : '很安静。'}`,
    demo_code: checkinCode(db, today), // demo helper: stands in for scanning the code at the door
  };
});
def('checkin.submit', 'user', (ctx, { code, companions }) => {
  const { db, now, user: u } = ctx;
  need(ctx, 'member_active');
  if (modeAt(db.config, now) !== 'day') ruleFail('R-DAY-04', `签到码只在白天（${db.config.dayOpenAt}–${db.config.switchAt}）有效`);
  const today = hzDate(now);
  if (String(code || '').trim().toUpperCase() !== checkinCode(db, today)) ruleFail('R-DAY-04', '签到码不对，以门口今天的图案为准');
  const exists = db.checkins.find(c => c.user_id === u.id && c.date === today);
  if (exists) return { repeat: true, at: exists.at, companions: exists.companions };
  const n = Math.max(0, Math.min(20, parseInt(companions, 10) || 0));
  db.checkins.push({ id: 'ci' + rid(6), user_id: u.id, date: today, at: iso(now), companions: n });
  ctx.touch('checkins');
  unlockBy(ctx, u, 'checkin_count');
  return { repeat: false, at: iso(now), companions: n, unlocked: unlockedKeys(db, u, now) };
});

function meetingCheck(db, args, t) {
  const date = clean(args.date, 10), start = clean(args.start, 5), end = clean(args.end, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) fail('请填写日期和时间');
  const today = hzDate(t);
  if (date < today || daysBetween(today, date) > 14) fail('可以申请两周内的会议');
  if (mins(start) < mins(db.config.dayOpenAt)) fail(`白天 ${db.config.dayOpenAt} 开门`);
  if (mins(end) <= mins(start)) fail('结束时间要晚于开始时间');
  if (mins(end) > mins(db.config.switchAt)) ruleFail('R-DAY-06', `会议不能跨过 ${db.config.switchAt}，那时这里要变成演出现场`);
  return { date, start, end };
}
def('meeting.create', 'user', (ctx, args) => {
  const { db, now, user: u } = ctx;
  need(ctx, 'member_active');
  const v = meetingCheck(db, args, now);
  const party = parseInt(args.party_size, 10);
  if (!(party >= 2 && party <= 30)) fail('人数在 2 到 30 之间');
  const m = { id: 'mt' + rid(6), user_id: u.id, ...v, party_size: party, needs: cleanText(args.needs, 200), status: 'submitted', counter: null, reply: '', created_at: iso(now) };
  db.meetings.push(m);
  ctx.touch('meetings');
  return m;
});
def('meeting.respond', 'user', (ctx, { id, accept }) => {
  const m = ctx.db.meetings.find(x => x.id === id && x.user_id === ctx.user.id);
  if (!m || m.status !== 'counter_proposed') fail('这条申请不需要你确认');
  if (accept) { m.start = m.counter.start; m.end = m.counter.end; m.status = 'user_accepted'; } else m.status = 'user_declined';
  ctx.touch('meetings');
  return m;
});
def('meeting.cancel', 'user', (ctx, { id }) => {
  const m = ctx.db.meetings.find(x => x.id === id && x.user_id === ctx.user.id);
  if (!m || ['cancelled', 'rejected', 'user_declined'].includes(m.status)) fail('这条申请不能取消');
  if (ctx.now > Date.parse(atHz(m.date, m.start))) fail('会议已经开始了');
  m.status = 'cancelled';
  ctx.touch('meetings');
  return m;
});
def('meetings.mine', 'user', ctx => ctx.db.meetings.filter(m => m.user_id === ctx.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)));

/* ---------- membership: apply, invites, renew ---------- */
const profileOf = (a, u) => {
  const p = {
    name: clean(a.name, 30), phone: normPhone(a.phone || u.phone), city: clean(a.city, 20), company_role: clean(a.company_role, 60), intro: cleanText(a.intro, 300), referrer: clean(a.referrer, 30),
  };
  if (!p.name) fail('请填写姓名或称呼');
  if (!/^1\d{10}$/.test(p.phone)) fail('请填写 11 位手机号');
  if (!p.city) fail('请填写所在城市');
  if (!p.company_role) fail('请填写公司 / 项目与角色');
  return p;
};
def('application.submit', 'user', (ctx, args) => {
  const { db, now, user: u } = ctx;
  const idn = identityOf(db, u, now);
  if (idn === 'member_active') fail('你已经是会员了');
  if (idn === 'applicant') fail('你已经有一份申请在审核中');
  const p = profileOf(args, u);
  Object.assign(u, { name: u.name || p.name, city: p.city, company_role: p.company_role, intro: p.intro });
  const a = { id: 'ap' + rid(6), user_id: u.id, status: 'under_review', profile: p, history: [{ status: 'under_review', at: iso(now) }], reviewer: null, review_note: '', created_at: iso(now), updated_at: iso(now) };
  db.applications.push(a);
  ctx.touch('applications');
  log(ctx, 'application.submit', 'application', a.id);
  return { status: a.status };
});
def('application.update', 'user', (ctx, args) => {
  const a = latestApp(ctx.db, ctx.user.id);
  if (!a || a.status !== 'need_info') fail('现在不需要补充资料');
  a.profile = profileOf(args, ctx.user);
  a.status = 'under_review'; a.updated_at = iso(ctx.now);
  a.history.push({ status: 'under_review', at: iso(ctx.now), note: '已补充资料' });
  ctx.touch('applications');
  return { status: a.status };
});
function addSegment(ctx, u, source, extra = {}) {
  const { db, now } = ctx;
  const cur = activeSeg(db, u.id, now);
  const curEnd = cur ? segsOf(db, u.id).reduce((e, s) => (s.end_at > e ? s.end_at : e), cur.end_at) : null;
  // R-MEM-10: a gift starts on the day it is claimed; R-MEM-11: a paid month starts when the payment succeeds
  const start = curEnd ? Date.parse(curEnd) + 1000 : source === 'gift' ? Date.parse(atHz(hzDate(now), '00:00')) : now;
  const months = source === 'gift' ? db.config.giftMonths : 1;
  const endDate = addMonths(curEnd ? hzDate(curEnd) : hzDate(now), months);
  if (!u.member_no) u.member_no = String(db.nextNo++).padStart(4, '0');
  const seg = { id: 'ms' + rid(6), user_id: u.id, source, start_at: iso(start), end_at: atHz(endDate, '23:59:59'), ...extra };
  db.memberships.push(seg);
  ctx.touch('members');
  return seg;
}
def('application.pay', 'user', ctx => { // mock payment for the first month
  const { db, now, user: u } = ctx;
  const a = latestApp(db, u.id);
  if (!a || a.status !== 'approved_awaiting_payment') fail('申请还没有通过审核');
  const p = { id: 'pm' + rid(6), kind: 'membership', user_id: u.id, application_id: a.id, amount: db.config.memberPrice, provider: 'mock', status: 'paid', created_at: iso(now), paid_at: iso(now) };
  db.payments.push(p);
  a.status = 'completed'; a.updated_at = iso(now); a.history.push({ status: 'completed', at: iso(now) });
  const seg = addSegment(ctx, u, 'paid', { payment_id: p.id });
  notify(ctx, u.id, 'member', `欢迎，No.${u.member_no}`, `会员有效期至 ${hzDate(seg.end_at)}。`);
  log(ctx, 'membership.paid', 'user', u.id);
  ctx.touch('applications', 'ledger');
  return { ok: true, member_no: u.member_no, end_at: seg.end_at };
});
def('invite.view', 'optional', (ctx, { token: tk }) => {
  const { db, now, user: u } = ctx;
  const inv = db.invites.find(i => i.token === String(tk || '').trim().toUpperCase());
  if (!inv) fail('这张邀请不存在', 'not_found', 404);
  const expired = inv.status === 'issued' && Date.parse(inv.claim_deadline) < now;
  if (u && inv.status === 'issued' && !expired && !inv.held_by && (!inv.bound_phone || inv.bound_phone === u.phone) && identityOf(db, u, now) !== 'member_active') { inv.held_by = u.id; ctx.touch('session'); }
  return { token: inv.token, note: inv.note, deadline: inv.claim_deadline, months: db.config.giftMonths, status: expired ? 'expired' : inv.status, mine: !!u && inv.claimed_by === u.id, bound: !!inv.bound_phone, for_me: !inv.bound_phone || (u && inv.bound_phone === u.phone) };
});
def('invite.claim', 'user', (ctx, { token: tk }) => {
  const { db, now, user: u } = ctx;
  const inv = db.invites.find(i => i.token === String(tk || '').trim().toUpperCase());
  if (!inv) fail('这张邀请不存在', 'not_found', 404);
  if (inv.claimed_by === u.id) return { ok: true, repeat: true }; // A01: idempotent
  if (inv.status !== 'issued') fail(inv.status === 'claimed' ? '这张邀请已经被领取了' : '这张邀请已停用');
  if (Date.parse(inv.claim_deadline) < now) fail('这张邀请已过领取期');
  if (inv.bound_phone && inv.bound_phone !== u.phone) fail('这张邀请是给另一位朋友的');
  if (identityOf(db, u, now) === 'member_active') fail('你已经是会员了');
  inv.status = 'claimed'; inv.claimed_by = u.id; inv.claimed_at = iso(now);
  const seg = addSegment(ctx, u, 'gift', { invite_id: inv.id });
  notify(ctx, u.id, 'member', `欢迎，No.${u.member_no}`, `赠送的 ${db.config.giftMonths} 个月会员从今天开始，至 ${hzDate(seg.end_at)}。`);
  log(ctx, 'invite.claim', 'invite', inv.id);
  ctx.touch('invites');
  return { ok: true, member_no: u.member_no, end_at: seg.end_at };
});
def('membership.renew', 'user', ctx => {
  const { db, now, user: u } = ctx;
  const mv = membershipView(db, u, now);
  if (!mv) fail('还不是会员');
  if (!mv.can_renew) fail(`到期超过 ${db.config.renewWithoutReviewDays} 天，需要重新申请`);
  const p = { id: 'pm' + rid(6), kind: 'membership', user_id: u.id, amount: db.config.memberPrice, provider: 'mock', status: 'paid', created_at: iso(now), paid_at: iso(now) };
  db.payments.push(p);
  const seg = addSegment(ctx, u, 'paid', { payment_id: p.id });
  notify(ctx, u.id, 'member', '续费成功', `有效期至 ${hzDate(seg.end_at)}。`);
  ctx.touch('ledger');
  return { ok: true, end_at: seg.end_at };
});

def('notices.list', 'user', ctx => ctx.db.notices.filter(n => n.to === ctx.user.id).slice(0, 40));
def('notices.read', 'user', ctx => { ctx.db.notices.forEach(n => { if (n.to === ctx.user.id) n.read = true; }); ctx.touch('session'); return { ok: true }; });

/* =========================================================
   Back office
   ========================================================= */
const adminOnly = ctx => { if (ctx.staff.role !== 'admin') fail('这一步需要店长权限', 'forbidden', 403); };
const userBrief = (db, u, t) => u && ({ id: u.id, name: u.name || '（未填写）', en: u.en, phone: u.phone, member_no: u.member_no, identity: identityOf(db, u, t) });

def('admin.login', 'public', (ctx, { staffId, pin }) => {
  const s = byId(ctx.db.staff, staffId);
  if (!s) fail('请选择你的名字');
  if (String(pin ?? '').trim() !== DEMO_PIN) fail(`PIN 不正确（演示 PIN：${DEMO_PIN}）`);
  return { token: issue(ctx, 'staff', s.id), staff: s };
});
def('admin.me', 'staff', ctx => ctx.staff);

def('admin.badges', 'staff', ctx => {
  const { db } = ctx;
  return {
    confirms: db.bookings.filter(b => b.status === 'pending_confirm').length,
    reviews: db.applications.filter(a => a.status === 'under_review').length,
    meetings: db.meetings.filter(m => m.status === 'submitted').length,
    refunds: db.refunds.filter(r => r.status !== 'succeeded').length,
  };
});
def('admin.workbench', 'staff', ctx => {
  const { db, now } = ctx;
  const date = tonightDate(db.config, now);
  const s = db.sessions.find(x => x.date === date);
  const today = hzDate(now);
  const pending = db.bookings.filter(b => b.status === 'pending_confirm').sort((a, b) => a.confirm_deadline_at.localeCompare(b.confirm_deadline_at)).map(b => bookingView(db, b, now, true));
  const arrivals = s ? db.bookings.filter(b => b.session_id === s.id && ['confirmed', 'fulfilled'].includes(b.status)).map(b => bookingView(db, b, now, true)) : [];
  return {
    mode: modeAt(db.config, now), now: iso(now), session: sessionView(s),
    times: { switch_at: db.config.switchAt, day_open_at: db.config.dayOpenAt, night_close_at: db.config.nightCloseAt, online_cutoff: db.config.onlineCutoff, hold_deadline: db.config.holdDeadline },
    kpis: {
      reviews: db.applications.filter(a => ['under_review'].includes(a.status)).length,
      confirms: pending.length, arrivals: arrivals.length, arrived: arrivals.filter(b => b.status === 'fulfilled').length,
      meetings: db.meetings.filter(m => m.status === 'submitted').length,
      refunds: db.refunds.filter(r => r.status !== 'succeeded').length,
      checkins: db.checkins.filter(c => c.date === today).length,
      members: db.users.filter(u => identityOf(db, u, now) === 'member_active').length,
    },
    pending, arrivals,
    zones: s ? zoneSummary(db, s, null, now, tableStates(db, s, null, now, { admin: true })) : [],
    reviews: db.applications.filter(a => ['under_review', 'need_info'].includes(a.status)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(a => ({ id: a.id, status: a.status, profile: a.profile, created_at: a.created_at })),
    meetings: db.meetings.filter(m => ['submitted', 'counter_proposed'].includes(m.status)).map(m => ({ ...m, user: userBrief(db, userOf(db, m.user_id), now) })),
    events: db.events.filter(e => hzDate(e.start_at) === today).map(e => ({ id: e.id, title: e.title, start_at: e.start_at, taken: db.registrations.filter(r => r.event_id === e.id && r.status !== 'cancelled').length, capacity: e.capacity })),
    refunds: db.refunds.filter(r => r.status !== 'succeeded').map(r => ({ ...r, user: userBrief(db, userOf(db, r.user_id), now) })),
    audit: db.audit.slice(0, 8),
  };
});

def('admin.board', 'staff', (ctx, { session_id }) => {
  const { db, now } = ctx;
  const s = sessionOf(db, session_id) || db.sessions.find(x => x.date === tonightDate(db.config, now));
  const states = tableStates(db, s, null, now, { admin: true });
  const bookings = db.bookings.filter(b => b.session_id === s.id && !['payment_expired'].includes(b.status)).map(b => bookingView(db, b, now, true));
  return { session: sessionView(s), sessions: db.sessions.filter(x => x.status !== 'closed').map(sessionView), states, zones: zoneSummary(db, s, null, now, states), prices: db.config.prices, deposit_ratio: db.config.depositRatio, bookings, holds: db.holds.filter(h => h.session_id === s.id && !h.released_at), now: iso(now), mode: modeAt(db.config, now), hold_deadline: atHz(s.date, db.config.holdDeadline) };
});

def('admin.bookings', 'staff', (ctx, { status, date }) => ctx.db.bookings.filter(b => (!status || b.status === status) && (!date || b.date === date))
  .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200).map(b => bookingView(ctx.db, b, ctx.now, true)));

def('admin.booking.confirm', 'staff', (ctx, { id, codes }) => {
  const { db, now } = ctx;
  const b = byId(db.bookings, id);
  if (!b) fail('找不到这笔订单', 'not_found', 404);
  if (b.status !== 'pending_confirm') fail(`订单状态已是「${BOOKING_STATUS[b.status].zh}」，不能再确认`, 'conflict', 409, 'INV-05');
  const mine = db.occupancies.filter(o => o.booking_id === b.id && !o.released_at);
  if (Array.isArray(codes) && codes.length) { // assign exact tables inside the zone the guest chose
    if (b.kind !== 'booth') fail('按座位预订的订单由系统分配座位');
    if (codes.length !== b.units) fail(`需要安排 ${b.units} 张桌`);
    const s = sessionOf(db, b.session_id);
    const others = liveOcc(db, now).filter(o => o.session_id === b.session_id && o.booking_id !== b.id);
    for (const c of codes) {
      const r = resourceOf(c);
      if (!r || r.zone !== b.zone) fail(`${c} 不在客人选的区域里`);
      if (s.paused.includes(c)) fail(`${c} 已暂停`);
      if (others.some(o => o.resource === c)) fail(`${c} 已被占用`, 'conflict', 409, 'INV-01');
    }
    mine.forEach((o, i) => { o.resource = codes[i]; });
    b.lines = codes.map(c => ({ code: c, seats: resourceOf(c).capacity }));
  }
  mine.forEach(o => { o.kind = 'confirmed'; });
  setStatus(ctx, b, 'confirmed', { by: ctx.staff.id }); // T8
  b.confirmed_at = iso(now);
  if (b.price_snapshot.tickets && !db.tickets.some(k => k.booking_id === b.id)) db.tickets.push({ id: 'tk' + rid(6), booking_id: b.id, session_id: b.session_id, user_id: b.user_id, count: b.price_snapshot.tickets, drink_redeemed: false, verification: 'unverified' });
  const z = zoneOf(b.zone);
  notify(ctx, b.user_id, 'booking', `已交割 · ${z.zh}`, `${b.date.slice(5).replace('-', '.')} · 桌号 ${b.lines.map(l => `${l.code}「${resourceOf(l.code).card.name || l.code}」`).join('、')}。`);
  log(ctx, 'booking.confirm', 'booking', b.id, { after: b.lines.map(l => l.code).join(',') });
  ctx.touch('board');
  return bookingView(db, b, now, true);
});
def('admin.booking.reject', 'staff', (ctx, { id, reason, suggestion, suggestion_zone }) => {
  const { db, now } = ctx;
  const b = byId(db.bookings, id);
  if (!b) fail('找不到这笔订单', 'not_found', 404);
  if (b.status !== 'pending_confirm') fail(`订单状态已是「${BOOKING_STATUS[b.status].zh}」`, 'conflict', 409, 'INV-05');
  b.reject_reason = cleanText(reason, 120) || '这一晚安排不过来，抱歉。';
  b.suggestion = cleanText(suggestion, 120);
  b.suggestion_zone = zoneOf(suggestion_zone) ? suggestion_zone : '';
  setStatus(ctx, b, 'rejected', { by: ctx.staff.id }); // T9
  release(ctx, b, 'rejected');
  const r = refundFor(ctx, b, 'rejected');
  notify(ctx, b.user_id, 'booking', '本轮未进 · 门店未接受', `${b.reject_reason}${r ? ` ${yuan(r.amount)} 正在原路退回。` : ''}`);
  log(ctx, 'booking.reject', 'booking', b.id, { reason: b.reject_reason });
  return bookingView(db, b, now, true);
});
def('admin.booking.release', 'staff', (ctx, { id }) => {
  const { db, now } = ctx;
  const b = byId(db.bookings, id);
  if (!b || b.status !== 'confirmed') fail('只有已确认、未到店的订单可以释放');
  if (now < Date.parse(atHz(b.date, db.config.holdDeadline))) ruleFail('R-BK-31', `${db.config.holdDeadline} 留位截止后才能释放`);
  if (b.table_released) return bookingView(db, b, now, true);
  b.table_released = true; // T13
  release(ctx, b, 'late_release');
  b.history.push({ status: 'confirmed', at: iso(now), note: 'table_released', by: ctx.staff.id });
  notify(ctx, b.user_id, 'booking', '桌位已释放', '已过留位时间。订金今晚仍可抵扣消费，到店后由门店重新安排。');
  log(ctx, 'booking.release', 'booking', b.id);
  ctx.touch('bookings');
  return bookingView(db, b, now, true);
});

def('admin.verify', 'staff', (ctx, { code }) => {
  const { db, now } = ctx;
  const raw = String(code || '').trim().toUpperCase();
  if (/^\d{6}$/.test(raw)) { // a member's rotating card code (R-MEM-05)
    const u = db.users.find(x => x.secret && identityOf(db, x, now) === 'member_active' && [-1, 0, 1].some(k => memberCode(x.secret, now, k) === raw));
    if (!u) fail('会员码无效或已过期，请会员刷新会员卡', 'not_found', 404);
    const date = tonightDate(db.config, now);
    const tonight = db.bookings.filter(b => b.user_id === u.id && b.date === date && ['confirmed', 'fulfilled'].includes(b.status)).map(b => bookingView(db, b, now, true));
    log(ctx, 'verify.member', 'user', u.id);
    return { kind: 'member', member: { ...userBrief(db, u, now), membership: membershipView(db, u, now), company_role: u.company_role }, bookings: tonight };
  }
  const b = db.bookings.find(x => x.code === raw || x.code === 'LL-' + raw);
  if (!b) fail('找不到这张凭证', 'not_found', 404);
  if (b.status === 'fulfilled') return { kind: 'booking', repeat: true, booking: bookingView(db, b, now, true) }; // R-VER-02
  if (b.status !== 'confirmed') fail(`这笔订单是「${BOOKING_STATUS[b.status].zh}」，不能入场`);
  if (b.date !== tonightDate(db.config, now)) fail(`这是 ${b.date.slice(5).replace('-', '.')} 的订单`);
  setStatus(ctx, b, 'fulfilled', { by: ctx.staff.id }); // T12
  b.verified_at = iso(now);
  for (const o of db.occupancies) if (o.booking_id === b.id && !o.released_at) o.used_at = iso(now);
  for (const k of db.tickets) if (k.booking_id === b.id) k.verification = 'verified';
  log(ctx, 'verify.booking', 'booking', b.id);
  ctx.touch('board');
  return { kind: 'booking', repeat: false, booking: bookingView(db, b, now, true) };
});
def('admin.ticket.drink', 'staff', (ctx, { booking_id }) => {
  const k = ctx.db.tickets.find(x => x.booking_id === booking_id);
  if (!k) fail('这笔订单没有门票');
  if (k.verification !== 'verified') fail('先核验入场');
  if (k.drink_redeemed) ruleFail('R-TK-05', '赠饮已经兑换过了');
  k.drink_redeemed = true;
  log(ctx, 'ticket.drink', 'booking', booking_id);
  ctx.touch('bookings');
  return { ok: true };
});
def('admin.deposit.redeem', 'staff', (ctx, { booking_id, amount, note }) => {
  const { db, now } = ctx;
  const b = byId(db.bookings, booking_id);
  if (!b) fail('找不到这笔订单', 'not_found', 404);
  const p = db.payments.find(x => x.booking_id === b.id && x.kind === 'deposit' && x.status === 'paid');
  if (!p) fail('这笔订单没有订金');
  if (!['confirmed', 'fulfilled'].includes(b.status) || b.date !== tonightDate(db.config, now)) fail('订金只能在当晚抵扣');
  const used = db.redemptions.filter(r => r.booking_id === b.id).reduce((s, r) => s + r.amount, 0);
  const a = Math.round(Number(amount) * 100);
  if (!(a > 0)) fail('请填写抵扣金额');
  if (used + a > p.amount) ruleFail('R-VER-03', `订金只剩 ${yuan(p.amount - used)}，不能重复抵扣`);
  db.redemptions.push({ id: 'rd' + rid(6), booking_id: b.id, amount: a, staff_id: ctx.staff.id, bill_note: clean(note, 60), at: iso(now) });
  log(ctx, 'deposit.redeem', 'booking', b.id, { after: yuan(a) });
  ctx.touch('ledger');
  return bookingView(db, b, now, true);
});
def('admin.table.pause', 'staff', (ctx, { session_id, code, paused }) => {
  const s = sessionOf(ctx.db, session_id);
  if (!s || !resourceOf(code)) fail('找不到这张桌');
  s.paused = paused ? [...new Set([...s.paused, code])] : s.paused.filter(c => c !== code);
  const live = liveOcc(ctx.db, ctx.now).filter(o => o.session_id === s.id && o.resource === code && o.booking_id);
  log(ctx, paused ? 'table.pause' : 'table.resume', 'resource', code, { reason: s.date });
  ctx.touch('board');
  return { ok: true, warning: paused && live.length ? '这张桌已有订单：订单保留原桌号，请联系客人处理。' : '' };
});
def('admin.hold.create', 'staff', (ctx, { session_id, code, note }) => {
  const { db, now } = ctx;
  const s = sessionOf(db, session_id);
  const r = resourceOf(code);
  if (!s || !r) fail('找不到这张桌');
  if (liveOcc(db, now).some(o => o.session_id === s.id && o.resource === code) || s.paused.includes(code)) fail('只能为空闲的桌位线下占桌');
  const h = { id: 'hd' + rid(6), session_id: s.id, codes: [code], note: clean(note, 60) || '电话预订', staff_id: ctx.staff.id, created_at: iso(now), released_at: null };
  db.holds.push(h);
  db.occupancies.push({ id: 'oc' + rid(8), resource: code, session_id: s.id, booking_id: null, hold_id: h.id, kind: 'offline_hold', seats: r.unit === 'seats' ? r.capacity : null, expires_at: null, released_at: null, release_reason: null, used_at: null });
  log(ctx, 'hold.create', 'resource', code, { reason: h.note });
  ctx.touch('board');
  return h;
});
def('admin.hold.release', 'staff', (ctx, { id }) => {
  const h = byId(ctx.db.holds, id);
  if (!h || h.released_at) fail('找不到这条线下占桌');
  h.released_at = iso(ctx.now);
  for (const o of ctx.db.occupancies) if (o.hold_id === h.id && !o.released_at) { o.released_at = iso(ctx.now); o.release_reason = 'staff'; }
  log(ctx, 'hold.release', 'resource', h.codes.join(','));
  ctx.touch('board');
  return { ok: true };
});

def('admin.members', 'staff', ctx => {
  const { db, now } = ctx;
  return db.users.filter(u => segsOf(db, u.id).length).map(u => ({ ...userBrief(db, u, now), city: u.city, company_role: u.company_role, membership: membershipView(db, u, now), checkins: db.checkins.filter(c => c.user_id === u.id).length, bookings: db.bookings.filter(b => b.user_id === u.id && ['confirmed', 'fulfilled'].includes(b.status)).length, unlocks: db.unlocks.filter(x => x.user_id === u.id && !x.revoked_at).map(x => x.key) }))
    .sort((a, b) => String(a.member_no).localeCompare(String(b.member_no)));
});
def('admin.member', 'staff', (ctx, { id }) => {
  const { db, now } = ctx;
  const u = userOf(db, id);
  if (!u) fail('找不到这位会员', 'not_found', 404);
  return {
    ...userBrief(db, u, now), city: u.city, company_role: u.company_role, intro: u.intro, membership: membershipView(db, u, now),
    applications: db.applications.filter(a => a.user_id === u.id), invites: db.invites.filter(i => i.claimed_by === u.id),
    bookings: db.bookings.filter(b => b.user_id === u.id).map(b => bookingView(db, b, now, true)).slice(0, 12),
    checkins: db.checkins.filter(c => c.user_id === u.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
    registrations: db.registrations.filter(r => r.user_id === u.id).map(r => ({ ...r, event: (e => e && { title: e.title, start_at: e.start_at })(byId(db.events, r.event_id)) })),
    unlocks: db.unlocks.filter(x => x.user_id === u.id),
  };
});
def('admin.applications', 'staff', ctx => ctx.db.applications.filter(a => a.status !== 'completed').sort((a, b) => b.created_at.localeCompare(a.created_at)).map(a => ({ ...a, user: userBrief(ctx.db, userOf(ctx.db, a.user_id), ctx.now) })));
def('admin.application.review', 'staff', (ctx, { id, action, note }) => {
  adminOnly(ctx);
  const a = byId(ctx.db.applications, id);
  if (!a) fail('找不到这份申请', 'not_found', 404);
  if (!['under_review', 'need_info'].includes(a.status)) fail('这份申请已经处理过了');
  const to = { approve: 'approved_awaiting_payment', need_info: 'need_info', reject: 'rejected' }[action];
  if (!to) fail('未知操作');
  a.status = to; a.reviewer = ctx.staff.id; a.review_note = cleanText(note, 200); a.updated_at = iso(ctx.now);
  a.history.push({ status: to, at: iso(ctx.now), by: ctx.staff.id, note: a.review_note });
  const msg = { approved_awaiting_payment: ['审核通过', `支付首月会员费 ${yuan(ctx.db.config.memberPrice)} 后，会员立即生效。`], need_info: ['请补充资料', a.review_note || '门店需要你补充一些信息。'], rejected: ['感谢你的申请', a.review_note || '这一次没能成行。'] }[to];
  notify(ctx, a.user_id, 'application', ...msg);
  log(ctx, `application.${action}`, 'application', a.id, { reason: a.review_note });
  ctx.touch('applications');
  return { ok: true, status: to };
});
def('admin.invites', 'staff', ctx => ctx.db.invites.map(i => ({ ...i, status: i.status === 'issued' && Date.parse(i.claim_deadline) < ctx.now ? 'expired' : i.status, claimer: userBrief(ctx.db, userOf(ctx.db, i.claimed_by), ctx.now) })).sort((a, b) => b.created_at.localeCompare(a.created_at)));
def('admin.invite.create', 'staff', (ctx, { note, phone }) => {
  adminOnly(ctx);
  const p = normPhone(phone);
  if (p && !/^1\d{10}$/.test(p)) fail('手机号格式不对');
  let tk;
  do { tk = 'SV-' + token(6); } while (ctx.db.invites.some(i => i.token === tk));
  const inv = { id: 'iv' + rid(6), token: tk, issued_by: ctx.staff.id, note: clean(note, 60) || '首批受邀朋友', claim_deadline: atHz(ctx.db.config.giftClaimDeadline, '23:59:59'), status: 'issued', claimed_by: null, claimed_at: null, bound_phone: p || null, held_by: null, created_at: iso(ctx.now) };
  ctx.db.invites.push(inv);
  log(ctx, 'invite.create', 'invite', inv.id);
  ctx.touch('invites');
  return inv;
});
def('admin.invite.disable', 'staff', (ctx, { id }) => {
  adminOnly(ctx);
  const inv = byId(ctx.db.invites, id);
  if (!inv || inv.status !== 'issued') fail('只能停用未领取的邀请');
  inv.status = 'disabled';
  log(ctx, 'invite.disable', 'invite', inv.id);
  ctx.touch('invites');
  return { ok: true };
});

def('admin.day', 'staff', (ctx, { date }) => {
  const { db, now } = ctx;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : hzDate(now);
  const code = checkinCode(db, d);
  return {
    date: d, mode: modeAt(db.config, now), code, pattern: stampPattern(code),
    checkins: db.checkins.filter(c => c.date === d).sort((a, b) => b.at.localeCompare(a.at)).map(c => ({ ...c, user: userBrief(db, userOf(db, c.user_id), now) })),
    meetings: db.meetings.filter(m => m.date >= hzDate(now)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).map(m => ({ ...m, user: userBrief(db, userOf(db, m.user_id), now) })),
    roundtables: db.events.filter(e => e.kind === 'roundtable' && hzDate(e.start_at) === d).map(e => ({ id: e.id, title: e.title, start_at: e.start_at, host: e.host, taken: db.registrations.filter(r => r.event_id === e.id && r.status !== 'cancelled').length, capacity: e.capacity })),
  };
});
def('admin.checkin.reset', 'staff', ctx => {
  const d = hzDate(ctx.now);
  ctx.db.checkinOverrides[d] = token(4);
  log(ctx, 'checkin.reset', 'checkin_code', d);
  ctx.touch('checkins');
  return { code: ctx.db.checkinOverrides[d] };
});
def('admin.meeting.respond', 'staff', (ctx, { id, action, start, end, note }) => {
  const { db, now } = ctx;
  const m = byId(db.meetings, id);
  if (!m || m.status !== 'submitted') fail('这条申请已经处理过了');
  if (action === 'accept') { m.status = 'accepted'; m.reply = cleanText(note, 120); notify(ctx, m.user_id, 'meeting', '会议申请已确认', `${m.date.slice(5).replace('-', '.')} ${m.start}–${m.end}。${m.reply}`); }
  else if (action === 'reject') { m.status = 'rejected'; m.reply = cleanText(note, 120); notify(ctx, m.user_id, 'meeting', '会议申请未能安排', m.reply || '那天的会议区已经排满。'); }
  else if (action === 'counter') {
    const v = meetingCheck(db, { date: m.date, start, end }, now);
    m.status = 'counter_proposed'; m.counter = { start: v.start, end: v.end, note: cleanText(note, 120) };
    notify(ctx, m.user_id, 'meeting', '门店提议调整会议时间', `建议改为 ${v.start}–${v.end}。${m.counter.note}`);
  } else fail('未知操作');
  log(ctx, `meeting.${action}`, 'meeting', m.id);
  ctx.touch('meetings');
  return m;
});

def('admin.events', 'staff', ctx => ctx.db.events.map(e => ({ ...e, taken: ctx.db.registrations.filter(r => r.event_id === e.id && r.status !== 'cancelled').length, attended: ctx.db.registrations.filter(r => r.event_id === e.id && r.status === 'attended').length })).sort((a, b) => b.start_at.localeCompare(a.start_at)));
def('admin.event.save', 'staff', (ctx, a) => {
  const { db, now } = ctx;
  const title = clean(a.title, 40);
  if (!title) fail('请填写标题');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') || !/^\d{2}:\d{2}$/.test(a.from || '') || !/^\d{2}:\d{2}$/.test(a.to || '')) fail('请填写日期和时间');
  const capacity = parseInt(a.capacity, 10);
  if (!(capacity > 0 && capacity <= 300)) fail('名额在 1 到 300 之间');
  if (!EVENT_KINDS[a.kind]) fail('请选择类型');
  const data = { kind: a.kind, title, en: clean(a.en, 60), intro: cleanText(a.intro, 400), host: clean(a.host, 20), guests: clean(a.guests, 40), start_at: atHz(a.date, a.from), end_at: atHz(a.date, a.to), location: clean(a.location, 30) || '3F · library live', capacity, layer: a.layer === 0 || a.layer === '0' ? 0 : 1, public_signup: a.public_signup === true || a.public_signup === 'true', teaser: { title, hook: clean(a.hook, 40) }, status: ['published', 'draft', 'cancelled'].includes(a.status) ? a.status : 'published' };
  let e = a.id ? byId(db.events, a.id) : null;
  if (e) Object.assign(e, data, { tags: e.tags });
  else db.events.push(e = { id: 'ev' + rid(6), ...data, tags: [], signup_open_at: iso(now), signup_close_at: data.start_at });
  e.signup_close_at = data.start_at;
  log(ctx, a.id ? 'event.update' : 'event.create', 'event', e.id);
  ctx.touch('events');
  return e;
});
def('admin.event.registrations', 'staff', (ctx, { id }) => ctx.db.registrations.filter(r => r.event_id === id && r.status !== 'cancelled').map(r => ({ ...r, user: userBrief(ctx.db, userOf(ctx.db, r.user_id), ctx.now) })));
def('admin.registration.mark', 'staff', (ctx, { id, status, hosted }) => {
  const r = byId(ctx.db.registrations, id);
  if (!r) fail('找不到这条报名');
  const u = userOf(ctx.db, r.user_id);
  if (status) { if (!['registered', 'attended', 'cancelled'].includes(status)) fail('未知状态'); r.status = status; }
  if (hosted != null) r.hosted = !!hosted;
  if (r.status === 'attended') unlockBy(ctx, u, 'event_attended'); // R-EV-06
  if (r.hosted) unlockBy(ctx, u, 'hosted_session');
  log(ctx, 'registration.mark', 'registration', r.id, { after: `${r.status}${r.hosted ? ' · host' : ''}` });
  ctx.touch('events');
  return r;
});

def('admin.content', 'staff', ctx => ctx.db.content.map(c => ({ key: c.key, kind: c.kind, layer: c.layer, mode: c.mode, teaser: c.teaser, unlock_rule: c.unlock_rule || (c.layer === 1 ? { type: 'membership' } : null), locked_placeholder: c.locked_placeholder, active: c.active !== false, unlocked: ctx.db.unlocks.filter(x => x.key === c.key && !x.revoked_at).map(x => ({ id: x.id, at: x.at, source: x.source, user: userBrief(ctx.db, userOf(ctx.db, x.user_id), ctx.now) })) })));
def('admin.unlock.grant', 'staff', (ctx, { user_id, key }) => {
  adminOnly(ctx);
  const c = ctx.db.content.find(x => x.key === key);
  const u = userOf(ctx.db, user_id);
  if (!c || !u) fail('找不到');
  if (!c.unlock_rule || c.unlock_rule.type !== 'staff_grant') fail('这一项不能手动授予');
  if (!grant(ctx, u, key, 'staff_grant', ctx.staff.id)) fail('已经授予过了');
  log(ctx, 'unlock.grant', 'content', key, { reason: u.name });
  return { ok: true };
});
def('admin.unlock.revoke', 'staff', (ctx, { id }) => {
  adminOnly(ctx);
  const x = byId(ctx.db.unlocks, id);
  if (!x || x.revoked_at) fail('找不到这条解锁记录');
  x.revoked_at = iso(ctx.now);
  log(ctx, 'unlock.revoke', 'content', x.key);
  ctx.touch('content');
  return { ok: true };
});

def('admin.ledger', 'staff', ctx => {
  const { db, now } = ctx;
  const pays = db.payments.filter(p => p.status === 'paid').sort((a, b) => b.paid_at.localeCompare(a.paid_at)).map(p => ({ ...p, user: userBrief(db, userOf(db, p.user_id), now), booking_code: p.booking_id ? (byId(db.bookings, p.booking_id) || {}).code : null }));
  const sum = kind => pays.filter(p => p.kind === kind).reduce((s, p) => s + p.amount, 0);
  return {
    totals: { membership: sum('membership'), deposit: sum('deposit'), ticket: sum('ticket'), refunded: db.refunds.filter(r => r.status === 'succeeded').reduce((s, r) => s + r.amount, 0), redeemed: db.redemptions.reduce((s, r) => s + r.amount, 0) },
    payments: pays.slice(0, 80),
    refunds: db.refunds.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => ({ ...r, user: userBrief(db, userOf(db, r.user_id), now) })),
    redemptions: db.redemptions.slice().reverse().map(r => ({ ...r, booking_code: (byId(db.bookings, r.booking_id) || {}).code })),
  };
});
def('admin.audit', 'staff', ctx => ctx.db.audit.slice(0, 120).map(a => ({ ...a, actor_name: (byId(ctx.db.staff, a.actor) || userOf(ctx.db, a.actor) || { name: a.actor }).name })));

def('admin.config', 'staff', ctx => ({ config: ctx.db.config, locked: LOCKED_CONFIG, sessions: ctx.db.sessions.filter(s => s.status !== 'closed').map(sessionView) }));
def('admin.config.set', 'staff', (ctx, { key, value }) => {
  adminOnly(ctx);
  const c = ctx.db.config;
  if (LOCKED_CONFIG[key]) fail(`这一项涉及收费或退款，老板拍板前不能打开（${LOCKED_CONFIG[key]}）`, 'forbidden', 403);
  const ints = ['lockMinutes', 'confirmMinutes', 'ticketPrice', 'memberPrice', 'windowMember', 'windowGuest'];
  if (ints.includes(key)) { const n = parseInt(value, 10); if (!(n > 0)) fail('请填一个正整数'); c[key] = n; }
  else if (key === 'ticketSalesEnabled') c[key] = !!value;
  else if (/^prices\.[SAB]\.(member|guest)$/.test(key)) { const [, tier, who] = key.split('.'); const n = parseInt(value, 10); if (!(n > 0)) fail('请填一个正整数'); c.prices[tier][who] = n; }
  else fail('这一项不能在这里修改');
  log(ctx, 'config.set', 'config', key, { after: String(value) });
  ctx.touch('config', 'board');
  return { ok: true };
});
def('admin.session.update', 'staff', (ctx, { id, status, confirm_policy, reserved }) => {
  const s = sessionOf(ctx.db, id);
  if (!s) fail('找不到这一场');
  if (status && ['on_sale', 'paused', 'cancelled'].includes(status)) s.status = status;
  if (confirm_policy && ['tiered', 'all_manual'].includes(confirm_policy)) s.confirm_policy = confirm_policy;
  if (Array.isArray(reserved)) s.reserved = reserved.filter(c => resourceOf(c) && resourceOf(c).type === 'booth').slice(0, 4);
  log(ctx, 'session.update', 'session', s.id);
  ctx.touch('board');
  return sessionView(s);
});

def('admin.reset', 'staff', ctx => {
  adminOnly(ctx);
  const { tokens, clock } = ctx.db;
  const fresh = seed(ctx.now);
  Object.keys(ctx.db).forEach(k => delete ctx.db[k]);
  Object.assign(ctx.db, fresh, { tokens, clock });
  ctx.touch('all');
  return { ok: true };
});

/* ---------- demo controls: a clock you can move, so 19:00 can happen on cue ---------- */
def('demo.clock', 'public', (ctx, { action, hhmm, minutes }) => {
  const { db } = ctx;
  const real = ctx.now - db.clock.offsetMs;
  if (action === 'real') db.clock.offsetMs = 0;
  else if (action === 'plus') db.clock.offsetMs += (parseInt(minutes, 10) || 0) * MIN;
  else if (action === 'set') {
    if (!/^\d{2}:\d{2}$/.test(hhmm || '')) fail('时间格式 HH:MM');
    let target = Date.parse(atHz(hzDate(ctx.now), hhmm));
    if (target <= ctx.now) target += D; // the demo clock only moves forward: the next HH:MM
    db.clock.offsetMs = target - real;
  } else fail('未知操作');
  const now = real + db.clock.offsetMs;
  ctx.touch('all');
  return { offsetMs: db.clock.offsetMs, now: iso(now), mode: modeAt(db.config, now) };
});
/* what the demo members' phones show right now, so the front desk can be tried without a second phone */
def('demo.codes', 'staff', ctx => {
  const { db, now } = ctx;
  const date = tonightDate(db.config, now);
  const members = db.users.filter(u => u.secret && Object.values(PERSONAS).includes(u.phone) && identityOf(db, u, now) === 'member_active')
    .map(u => ({ name: u.name, member_no: u.member_no, code: memberCode(u.secret, now), next_at: iso((Math.floor(now / CODE_STEP) + 1) * CODE_STEP) }));
  const bookings = db.bookings.filter(b => b.date === date && b.status === 'confirmed').map(b => ({ code: b.code, zone: b.zone, party_size: b.party_size, name: (userOf(db, b.user_id) || {}).name }));
  return { members, bookings };
});
def('demo.state', 'public', ctx => ({ offsetMs: ctx.db.clock.offsetMs, now: iso(ctx.now), mode: modeAt(ctx.db.config, ctx.now), personas: PERSONAS }));

/* =========================================================
   Dispatch
   ========================================================= */
export function handle(db, { token: tok, method, args, now: realNow = Date.now() }) {
  const m = METHODS[method];
  if (!m) fail('未知接口：' + method, 'not_found', 404);
  const now = realNow + ((db.clock && db.clock.offsetMs) || 0);
  const changed = new Set(sweep(db, now));
  const sess = tok ? db.tokens[tok] : null;
  const user = sess && sess.kind === 'user' ? userOf(db, sess.id) : null;
  const staff = sess && sess.kind === 'staff' ? byId(db.staff, sess.id) : null;
  if (m.role === 'user' && !user) fail('请先登录', 'auth', 401);
  if ((m.role === 'staff' || m.role === 'admin') && !staff) fail('请先登录后台', 'auth', 401);
  if (m.role === 'any' && !sess) fail('请先登录', 'auth', 401);
  const ctx = { db, now, token: tok, session: sess, user, staff, touch: (...t) => t.forEach(x => changed.add(x)) };
  const result = m.fn(ctx, args && typeof args === 'object' ? args : {});
  return { result: result === undefined ? null : result, changed: [...changed] };
}
export const methodNames = () => Object.keys(METHODS);
