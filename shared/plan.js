/* =========================================================
   library live · 杭州武林路 9 号 · floor plan
   Drawn from the 2026-11-06 plan (a long hall: lounge, stage,
   booths along the window wall, two round booths, high tables,
   four-tops, the bar, window two-tops, back of house, lobby).

   One geometry, two renderings:
   - planASCII  · the members' terminal (pure ASCII, aligns in any monospace font)
   - planSVG    · ink on paper, for the public layer and the back-office board
   Coordinates are character cells: x 0–46, y 0–78.
   ========================================================= */

export const PLAN_W = 47;
export const PLAN_H = 79;

/* Booking is by zone (分区); the store assigns the exact table. */
export const ZONES = [
  { id: 'round', zh: '舞台前圆卡座', en: 'The Rounds', kind: 'booth', tags: ['正对舞台', '会员预留', '8 人'],
    blurb: '离舞台最近的两张圆卡座，每晚为会员预留，19:00 后空着的向所有人开放。', rects: [[11, 16, 23, 22], [11, 34, 23, 40]] },
  { id: 'wall', zh: '墙边卡座', en: 'Sand Hill Booths', kind: 'booth', tags: ['靠窗', '适合谈事', '6 人'],
    blurb: '沿着窗墙的四张 U 形卡座，各以一个年份命名。看得见舞台，也听得清彼此。', rects: [[0, 17, 10, 45]] },
  { id: 'lounge', zh: '沙龙沙发', en: 'The Salon', kind: 'booth', tags: ['安静', '沙发', '6 人'],
    blurb: '大厅尽头的两组沙发。离舞台远一点，说话不用提高音量。', rects: [[23, 4, 38, 16]] },
  { id: 'pit', zh: '舞台池高桌', en: 'The Pit', kind: 'shared', tags: ['离乐手最近', '两人一桌', '可拼桌'],
    blurb: '乐手面前的六张高脚桌，两人一桌，按座位预订。', rects: [[11, 23, 25, 33]] },
  { id: 'tables', zh: '四人散台', en: 'The Commons', kind: 'table', tags: ['热闹', '四人一桌', '可拼桌'],
    blurb: '舞台与吧台之间的六张方桌，按座位预订。', rects: [[11, 44, 31, 57]] },
  { id: 'bar', zh: '车库吧台', en: 'Garage Bar', kind: 'bar', tags: ['一个人也好', '8 座'],
    blurb: '八个吧凳。一个人来也很好，调酒师会记得你。', rects: [[33, 43, 46, 61]] },
  { id: 'pairs', zh: '窗边双人桌', en: 'Co-founders', kind: 'shared', tags: ['靠窗', '两人一桌'],
    blurb: '两个人，一张桌，一扇窗。像所有故事的开头。', rects: [[0, 58, 11, 72]] },
];
export const zoneOf = id => ZONES.find(z => z.id === id);

/* The same rooms by day: members only, an open salon rather than a club. */
export const DAY_ZONES = {
  lounge: { zh: '座谈沙龙', en: 'Open Salon', blurb: '白天的开放式座谈在这里：一张话题卡，谁都可以坐下来。' },
  round: { zh: '圆桌座谈', en: 'Roundtables', blurb: '两张圆卡座白天是圆桌，留给当天的座谈与会面。' },
  wall: { zh: '安静卡座', en: 'Quiet Booths', blurb: '读书、写东西、一对一。多人会议请提前申请。' },
  pit: { zh: '站立讨论', en: 'Stand-up', blurb: '高脚桌白天用来站着聊十分钟。' },
  tables: { zh: '长桌', en: 'Commons', blurb: '带电源的工作桌，先到先坐。' },
  bar: { zh: '咖啡吧台', en: 'Coffee Bar', blurb: '咖啡另付，约 18 元一杯。' },
  pairs: { zh: '窗边一对一', en: '1:1 Window', blurb: '适合两个人的会面。' },
};

const R = (code, type, capacity, zone, tier, geo, card = {}) => ({
  code, type, unit: type === 'booth' ? 'whole' : 'seats', capacity, zone, tier, geo,
  card: { name: card.name || '', tags: card.tags || [], story: card.story || '' },
});

export const RESOURCES = [
  R('B01', 'booth', 6, 'wall', 'A', { box: [1, 18, 9, 23] }, { name: '1946', tags: ['靠窗', '看得见舞台'], story: 'ARD 成立，乔治·多里奥开启现代风险投资。' }),
  R('B02', 'booth', 6, 'wall', 'A', { box: [1, 25, 9, 30] }, { name: '1968', tags: ['靠窗', '适合谈事'], story: '亚瑟·洛克不到两天，为英特尔募得 250 万美元。' }),
  R('B03', 'booth', 6, 'wall', 'A', { box: [1, 32, 9, 37] }, { name: '1972', tags: ['靠窗', '适合谈事'], story: '红杉与凯鹏华盈先后成立，沙丘路开张。' }),
  R('B04', 'booth', 6, 'wall', 'A', { box: [1, 39, 9, 44] }, { name: '1984', tags: ['靠窗', '离散台近'], story: '思科在斯坦福两位工作人员手中诞生。' }),
  R('B05', 'booth', 8, 'round', 'S', { box: [12, 17, 22, 22], round: true }, { name: '1957', tags: ['正对舞台', '会员预留'], story: '「叛逆八人」离开肖克利，仙童半导体诞生。' }),
  R('B06', 'booth', 8, 'round', 'S', { box: [12, 34, 22, 39], round: true }, { name: '1976', tags: ['正对舞台', '会员预留'], story: '两个史蒂夫在车库里创立了苹果。' }),
  R('B07', 'booth', 6, 'lounge', 'B', { box: [24, 5, 36, 9] }, { name: '1998', tags: ['安静', '沙发'], story: '一张 10 万美元的支票，开给了还不存在的 Google。' }),
  R('B08', 'booth', 6, 'lounge', 'B', { box: [24, 11, 36, 15] }, { name: '2011', tags: ['安静', '沙发'], story: '同名纪录片上映，我们的名字由此而来。' }),
  ...[[12, 25], [19, 25], [12, 28], [19, 28], [12, 31], [19, 31]].map(([x, y], i) => R(`C0${i + 1}`, 'shared', 2, 'pit', 'P', { at: [x, y] })),
  ...[[13, 46], [22, 46], [13, 50], [22, 50], [13, 54], [22, 54]].map(([x, y], i) => R(`T0${i + 1}`, 'table', 4, 'tables', 'T', { at: [x, y] })),
  ...[45, 53].map((y, i) => R(`S0${i + 1}`, 'bar', 4, 'bar', 'S', { at: [34, y] })),
  ...Array.from({ length: 6 }, (_, i) => R(`P0${i + 1}`, 'shared', 2, 'pairs', 'P', { at: [2, 61 + i * 2] })),
];
export const resourceOf = code => RESOURCES.find(r => r.code === code);

/* ---------- ASCII ---------- */
const STAGE = [
  '         .----------',
  '      .-\'           ',
  '    .\'              ',
  '   /                ',
  '  /     S           ',
  ' |      T    [PIANO]',
  ' |      A           ',
  '|       G           ',
  '|       E           ',
  '|                   ',
  '|     .-.   .-.     ',
  '|    ( o ) ( o )    ',
  '|     \'-\'   \'-\'     ',
  '|                   ',
  '|      ~ live ~     ',
  ' |                  ',
  ' |                  ',
  '  \\                 ',
  '   \\                ',
  '    \'.              ',
  '      \'-.           ',
  '         \'----------',
];

function makeGrid() {
  const row = () => Array(PLAN_W).fill(' ');
  return {
    ch: Array.from({ length: PLAN_H }, row),
    cl: Array.from({ length: PLAN_H }, () => Array(PLAN_W).fill('')),
    zn: Array.from({ length: PLAN_H }, () => Array(PLAN_W).fill('')),
  };
}
function put(g, x, y, s, cl = '') {
  [...s].forEach((c, i) => {
    const xx = x + i;
    if (xx < 0 || xx >= PLAN_W || y < 0 || y >= PLAN_H) return;
    g.ch[y][xx] = c;
    g.cl[y][xx] = cl;
  });
}
function hline(g, x0, x1, y, c, cl) { for (let x = x0; x <= x1; x++) put(g, x, y, c, cl); }
function vline(g, x, y0, y1, c, cl) { for (let y = y0; y <= y1; y++) put(g, x, y, c, cl); }
function box(g, [x0, y0, x1, y1], cl) {
  hline(g, x0 + 1, x1 - 1, y0, '-', cl);
  hline(g, x0 + 1, x1 - 1, y1, '-', cl);
  vline(g, x0, y0 + 1, y1 - 1, '|', cl);
  vline(g, x1, y0 + 1, y1 - 1, '|', cl);
  put(g, x0, y0, '.', cl); put(g, x1, y0, '.', cl); put(g, x0, y1, '\'', cl); put(g, x1, y1, '\'', cl);
}
const center = (s, w) => { const p = Math.max(0, Math.floor((w - s.length) / 2)); return (' '.repeat(p) + s).padEnd(w).slice(0, w); };

/* what a booth says about itself, in eight characters or fewer */
const BOOTH_WORD = {
  available: 'open', reserved_open: '*member', reserved_sealed: 'sealed', booked: 'booked', locking: '..hold', mine: '>> you', paused: 'paused', pending: '?? due', offline: 'phone',
};

/* states: { [code]: { state, taken? } }  ·  layout 'night' | 'day'  ·  selected zone id */
export function planASCII({ states = {}, layout = 'night', selected = '' } = {}) {
  const g = makeGrid();
  // outer walls
  hline(g, 1, PLAN_W - 2, 0, '=', 'w'); hline(g, 1, PLAN_W - 2, PLAN_H - 1, '=', 'w');
  vline(g, 0, 1, PLAN_H - 2, '|', 'w'); vline(g, PLAN_W - 1, 1, PLAN_H - 2, '|', 'w');
  put(g, 0, 0, '+', 'w'); put(g, PLAN_W - 1, 0, '+', 'w'); put(g, 0, PLAN_H - 1, '+', 'w'); put(g, PLAN_W - 1, PLAN_H - 1, '+', 'w');
  // windows along the left wall
  for (let y = 18; y <= 72; y += 3) put(g, 0, y, ':', 'w');
  // service band at the far end
  put(g, 20, 0, '[ EXIT ]', 'd');
  put(g, 3, 1, 'WC', 'd'); put(g, 9, 1, 'STAFF', 'd'); put(g, 37, 1, 'STORE', 'd');
  hline(g, 1, 18, 3, '-', 'w'); hline(g, 28, PLAN_W - 2, 3, '-', 'w');
  // lounge furniture
  for (let y = 5; y <= 13; y += 2) put(g, 2, y, '[]', 'd');
  put(g, 13, 7, '(    )', 'd'); put(g, 13, 12, '(    )', 'd'); put(g, 9, 5, '*', 'd');
  put(g, 39, 7, layout === 'day' ? 'SALON' : 'SALON', 'z');
  // half wall before the stage room
  for (let x = 1; x <= PLAN_W - 2; x += 2) put(g, x, 16, '-', 'd');
  // stage
  STAGE.forEach((row, i) => put(g, 26, 19 + i, row, 'g'));
  // zone labels
  put(g, 1, 17, 'SAND HILL', 'z');
  put(g, 13, 24, 'THE PIT', 'z');
  put(g, 13, 45, 'THE COMMONS', 'z');
  put(g, 1, 59, 'PAIRS', 'z');
  ['B', 'A', 'R'].forEach((c, i) => put(g, 44, 49 + i, c, 'z'));
  // bar counter
  put(g, 39, 43, '+-+', 'w'); vline(g, 39, 44, 59, '|', 'w'); vline(g, 41, 44, 59, '|', 'w'); vline(g, 40, 44, 59, ':', 'd'); put(g, 39, 60, '+-+', 'w');
  // back of house
  box(g, [24, 62, 45, 72], 'w');
  for (let y = 63; y <= 71; y++) for (let x = 25; x <= 44; x++) if ((x + y) % 3 === 0) put(g, x, y, '/', 'd');
  put(g, 28, 67, ' KITCHEN . BOH ', 'd');
  // lobby
  hline(g, 1, 20, 73, '-', 'w'); hline(g, 27, PLAN_W - 2, 73, '-', 'w');
  put(g, 3, 75, '[ DESK ]', 'd'); put(g, 30, 75, '[LIFT]', 'd'); put(g, 30, 76, ' DT-19', 'd');
  for (let y = 74; y <= 77; y++) put(g, 39, y, '/////', 'd');
  put(g, 15, 77, '^ ENTRANCE ^', 'z');
  hline(g, 20, 26, PLAN_H - 1, ' ', 'w');

  // furniture with state
  for (const r of RESOURCES) {
    const s = states[r.code] || { state: 'available' };
    const cl = layout === 'day' ? 'st-day' : `st-${s.state}`;
    if (r.type === 'booth') {
      const [x0, y0, x1, y1] = r.geo.box;
      const w = x1 - x0 + 1;
      const word = layout === 'day' ? (r.zone === 'lounge' ? 'meet' : r.zone === 'round' ? 'table' : 'quiet') : BOOTH_WORD[s.state] || s.state;
      if (r.geo.round) {
        put(g, x0, y0, center(".-'''-.", w), cl);
        put(g, x0, y0 + 1, ' /' + ' '.repeat(w - 4) + '\\ ', cl);
        put(g, x0, y0 + 2, '|' + center(r.code, w - 2) + '|', cl);
        put(g, x0, y0 + 3, '|' + center(r.card.name, w - 2) + '|', cl);
        put(g, x0, y0 + 4, ' \\' + center(word, w - 4) + '/ ', cl);
        put(g, x0, y0 + 5, center("'-...-'", w), cl);
      } else {
        box(g, r.geo.box, cl);
        put(g, x0 + 1, y0 + 1, center(r.code, w - 2), cl);
        put(g, x0 + 1, y0 + 2, center(r.card.name, w - 2), cl);
        put(g, x0 + 1, y1 - 1, center(word, w - 2), cl);
      }
    } else {
      const [x, y] = r.geo.at;
      const taken = layout === 'day' ? 0 : (s.taken || 0);
      const seat = i => (i < taken ? '@' : 'o');
      const seatCl = i => (layout === 'day' ? 'st-day' : i < taken ? 'seat-taken' : `seat-${s.state === 'paused' ? 'paused' : 'free'}`);
      if (r.type === 'table') {
        put(g, x + 1, y, seat(0), seatCl(0)); put(g, x + 3, y, seat(1), seatCl(1));
        put(g, x, y + 1, `[${r.code}]`, cl);
        put(g, x + 1, y + 2, seat(2), seatCl(2)); put(g, x + 3, y + 2, seat(3), seatCl(3));
      } else if (r.type === 'bar') { // a section of four stools along the counter
        put(g, x, y, r.code.replace('0', ''), cl);
        for (let i = 0; i < r.capacity; i++) put(g, x + 3, y + i * 2, seat(i), seatCl(i));
      } else {
        put(g, x, y, seat(0), seatCl(0));
        put(g, x + 1, y, `(${r.code.replace('0', '')})`, cl);
        put(g, x + 5, y, seat(1), seatCl(1));
      }
    }
  }
  // zones: every cell inside a zone answers to a tap
  for (const z of ZONES) for (const [x0, y0, x1, y1] of z.rects) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y > 0 && y < PLAN_H - 1 && x > 0 && x < PLAN_W - 1) g.zn[y][x] = z.id;
  }
  const esc = c => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);
  const lines = g.ch.map((row, y) => {
    let out = '';
    let cur = null;
    let buf = '';
    const flush = () => {
      if (!buf) return;
      const [cl, zn] = cur;
      out += zn ? `<span class="${cl}" data-zone="${zn}">${buf}</span>` : cl ? `<span class="${cl}">${buf}</span>` : buf;
      buf = '';
    };
    row.forEach((c, x) => {
      const key = [g.cl[y][x], g.zn[y][x]];
      if (!cur || cur[0] !== key[0] || cur[1] !== key[1]) { flush(); cur = key; }
      buf += esc(c);
    });
    flush();
    return out;
  });
  return `<pre class="aplan" data-sel="${selected}" data-layout="${layout}" role="img" aria-label="library live 平面图">${lines.join('\n')}</pre>`;
}

/* ---------- SVG (ink on paper) ---------- */
const SX = 8;
const SY = 13;
const px = x => x * SX;
const py = y => y * SY;

export function planSVG({ states = {}, layout = 'night', selected = '', admin = false, initials = '', cracked = [] } = {}) {
  const W = PLAN_W * SX;
  const H = PLAN_H * SY;
  const out = [];
  out.push(`<svg class="splan" viewBox="0 0 ${W} ${H}" data-sel="${selected}" data-layout="${layout}" role="img" aria-label="library live 平面图">
  <defs>
    <pattern id="sp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="sp-hatch-bg"/><rect width="1.4" height="6" class="sp-hatch-fg"/></pattern>
    <pattern id="sp-grid" width="${SX * 2}" height="${SY * 2}" patternUnits="userSpaceOnUse"><path d="M${SX * 2} 0H0V${SY * 2}" class="sp-grid"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" class="sp-paper"/><rect width="${W}" height="${H}" fill="url(#sp-grid)"/>`);
  // service band, back of house, lobby
  out.push(`<rect x="${px(1)}" y="${py(0.5)}" width="${px(45)}" height="${py(2.5)}" fill="url(#sp-hatch)" class="sp-boh"/>
  <text x="${px(3)}" y="${py(2.2)}" class="sp-small">卫生间 · 员工区</text><text x="${px(23)}" y="${py(2.2)}" class="sp-small" text-anchor="middle">安全出口</text>
  <rect x="${px(24)}" y="${py(62)}" width="${px(21.5)}" height="${py(10.5)}" fill="url(#sp-hatch)" class="sp-boh"/>
  <text x="${px(34.75)}" y="${py(67.6)}" class="sp-small" text-anchor="middle">后场 · 厨房 · 卫生间</text>
  <line x1="${px(1)}" y1="${py(73.2)}" x2="${px(20)}" y2="${py(73.2)}" class="sp-wall-thin"/><line x1="${px(27)}" y1="${py(73.2)}" x2="${px(46)}" y2="${py(73.2)}" class="sp-wall-thin"/>
  <rect x="${px(3)}" y="${py(74.6)}" width="${px(7)}" height="${py(1.4)}" rx="3" class="sp-furn"/><text x="${px(6.5)}" y="${py(77.4)}" class="sp-small" text-anchor="middle">前台</text>
  <rect x="${px(30)}" y="${py(74)}" width="${px(6)}" height="${py(3.5)}" class="sp-furn"/><path d="M${px(30)} ${py(74)}L${px(36)} ${py(77.5)}M${px(36)} ${py(74)}L${px(30)} ${py(77.5)}" class="sp-thin"/>
  <text x="${px(33)}" y="${py(73.9) - 3}" class="sp-small" text-anchor="middle">电梯</text>
  ${Array.from({ length: 7 }, (_, i) => `<line x1="${px(39)}" y1="${py(74 + i * 0.55)}" x2="${px(45)}" y2="${py(74 + i * 0.55)}" class="sp-thin"/>`).join('')}
  <path d="M${px(23)} ${py(78.6)}V${py(75.4)}M${px(21.8)} ${py(76.6)}L${px(23)} ${py(75.4)}L${px(24.2)} ${py(76.6)}" class="sp-arrow"/>
  <text x="${px(23)}" y="${py(74.9)}" class="sp-label" text-anchor="middle">入口 · Entrance</text>`);
  // lounge decor
  for (let y = 5; y <= 13; y += 2) out.push(`<rect x="${px(2)}" y="${py(y) - 2}" width="${px(2)}" height="${py(1.3)}" rx="4" class="sp-furn"/>`);
  out.push(`<ellipse cx="${px(15.5)}" cy="${py(7.4)}" rx="${px(2.4)}" ry="${py(0.9)}" class="sp-furn"/><ellipse cx="${px(15.5)}" cy="${py(12.4)}" rx="${px(2.4)}" ry="${py(0.9)}" class="sp-furn"/>`);
  // stage
  out.push(`<path d="M${px(45.5)} ${py(19)}H${px(35)}C${px(29)} ${py(19)} ${px(26)} ${py(26)} ${px(26)} ${py(30)}C${px(26)} ${py(34)} ${px(29)} ${py(41)} ${px(35)} ${py(41)}H${px(45.5)}" class="sp-stage"/>
  <rect x="${px(36)} " y="${py(23.4)}" width="${px(7)}" height="${py(1.4)}" rx="2" class="sp-ink"/><text x="${px(39.5)}" y="${py(26.4)}" class="sp-small" text-anchor="middle">钢琴</text>
  <circle cx="${px(33)}" cy="${py(30.3)}" r="7" class="sp-furn"/><circle cx="${px(37.5)}" cy="${py(30.3)}" r="7" class="sp-furn"/>
  <text x="${px(36.5)}" y="${py(35.2)}" class="sp-stage-label" text-anchor="middle">STAGE</text><text x="${px(36.5)}" y="${py(36.7)}" class="sp-small" text-anchor="middle">舞台 · 21:00 开场</text>`);
  // bar counter
  out.push(`<rect x="${px(39.2)}" y="${py(43.4)}" width="${px(2.6)}" height="${py(17)}" rx="4" class="sp-ink-soft"/><text x="${px(43.6)}" y="${py(52)}" class="sp-small" text-anchor="middle" transform="rotate(90 ${px(43.6)} ${py(52)})">吧台 · BAR</text>`);
  // windows
  for (let y = 18; y <= 72; y += 6) out.push(`<line x1="0" y1="${py(y)}" x2="0" y2="${py(y + 3)}" class="sp-window"/>`);
  // outer wall
  out.push(`<path d="M${px(20)} 2H2V${H - 2}H${px(20)}M${px(26.5)} ${H - 2}H${W - 2}V2H${px(26.5)}" class="sp-wall"/>`);

  // furniture with state
  for (const r of RESOURCES) {
    const s = states[r.code] || { state: 'available' };
    const st = layout === 'day' ? 'day' : s.state;
    const g = [`<g class="sp-res t-${st}" data-code="${r.code}"${admin ? ` data-act="table" data-id="${r.code}" tabindex="0" role="button"` : ''}>`];
    if (r.type === 'booth') {
      const [x0, y0, x1, y1] = r.geo.box;
      const cx = px((x0 + x1 + 1) / 2);
      const cy = py((y0 + y1 + 1) / 2);
      if (r.geo.round) g.push(`<ellipse cx="${cx}" cy="${cy}" rx="${px((x1 - x0 + 1) / 2) - 2}" ry="${py((y1 - y0 + 1) / 2) - 2}" class="sp-booth"/>`);
      else g.push(`<rect x="${px(x0) + 2}" y="${py(y0) + 2}" width="${px(x1 - x0 + 1) - 4}" height="${py(y1 - y0 + 1) - 4}" rx="9" class="sp-booth"/>`);
      g.push(`<text x="${cx}" y="${cy - 3}" class="sp-code" text-anchor="middle">${r.code}</text><text x="${cx}" y="${cy + 11}" class="sp-year" text-anchor="middle">${r.card.name}</text>`);
      if (st === 'reserved_sealed' || cracked.includes(r.code)) g.push(`<g class="sp-seal${st === 'reserved_sealed' ? '' : ' is-cracking'}" transform="translate(${cx + 20} ${cy - 14})"><path class="sp-seal-l" d="M0 -11 A11 11 0 0 0 0 11 L2 4 L-2 0 L2 -5 Z"/><path class="sp-seal-r" d="M0 -11 A11 11 0 0 1 0 11 L2 4 L-2 0 L2 -5 Z"/><text y="3.5" text-anchor="middle" class="sp-seal-t">SV</text></g>`);
      if (st === 'booked' || st === 'offline') g.push(`<g transform="translate(${cx} ${cy + 1}) rotate(-8)"><rect x="-17" y="-9" width="34" height="18" class="sp-stamp"/><text y="4" text-anchor="middle" class="sp-stamp-t">${st === 'offline' ? '线下' : '已订'}</text></g>`);
      if (st === 'mine') g.push(`<g transform="translate(${cx + 22} ${cy - 12}) rotate(-10)"><circle r="11" class="sp-mine"/><text y="4" text-anchor="middle" class="sp-mine-t">${initials || '我'}</text></g>`);
      if (st === 'pending') g.push(`<circle cx="${cx + 24}" cy="${cy - 14}" r="5" class="sp-pulse"/>`);
    } else {
      const [x, y] = r.geo.at;
      const taken = layout === 'day' ? 0 : (s.taken || 0);
      const dot = (cx, cy, i) => `<circle cx="${cx}" cy="${cy}" r="3.3" class="${i < taken ? 'sp-seat-on' : 'sp-seat'}"/>`;
      if (r.type === 'table') {
        const cx = px(x + 2.5), cy = py(y + 1.5);
        g.push(`<rect x="${cx - 13}" y="${cy - 8}" width="26" height="16" rx="2" class="sp-table"/><text x="${cx}" y="${cy + 3.5}" class="sp-mini" text-anchor="middle">${r.code}</text>`);
        g.push(dot(cx - 7, cy - 14, 0), dot(cx + 7, cy - 14, 1), dot(cx - 7, cy + 14, 2), dot(cx + 7, cy + 14, 3));
      } else if (r.type === 'bar') {
        const cx = px(x + 3.5);
        for (let i = 0; i < r.capacity; i++) g.push(dot(cx, py(y + i * 2 + 0.5), i));
        g.push(`<text x="${px(x) - 2}" y="${py(y + 3.6)}" class="sp-mini">${r.code}</text>`);
      } else {
        const cx = px(x + 3), cy = py(y + 0.5);
        g.push(`<circle cx="${cx}" cy="${cy}" r="7" class="sp-table"/>`, dot(cx - 13, cy, 0), dot(cx + 13, cy, 1));
        g.push(`<text x="${cx + 21}" y="${cy + 3}" class="sp-mini">${r.code}</text>`);
      }
      if (st === 'paused') g.push(`<text x="${px(x + 2.5)}" y="${py(y + 1.5) - 10}" class="sp-mini" text-anchor="middle">暂停</text>`);
    }
    g.push('</g>');
    out.push(g.join(''));
  }
  // zone hit areas and labels
  for (const z of ZONES) {
    const label = layout === 'day' ? DAY_ZONES[z.id] : z;
    z.rects.forEach(([x0, y0, x1, y1], i) => {
      out.push(`<rect class="sp-zone" data-zone="${z.id}"${admin ? '' : ` data-act="zone" data-id="${z.id}" tabindex="${i ? -1 : 0}" role="button" aria-label="${label.zh}"`} x="${px(x0) + 1}" y="${py(y0) + 1}" width="${px(x1 - x0 + 1) - 2}" height="${py(y1 - y0 + 1) - 2}" rx="6"/>`);
    });
    const [x0, y0] = z.rects[0];
    const lx = z.id === 'lounge' ? px(38.4) : z.id === 'bar' ? px(33.4) : px(x0 + 0.6);
    const ly = z.id === 'lounge' ? py(6.6) : z.id === 'round' ? py(16.75) : z.id === 'bar' ? py(42.4) : z.id === 'pairs' ? py(59.8) : py(y0) + 11;
    out.push(`<text x="${lx}" y="${ly}" class="sp-zlabel" data-zone="${z.id}">${label.zh}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
