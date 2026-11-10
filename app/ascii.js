/* =========================================================
   The members' layer is made of characters.
   FIGlet lettering (generated with pyfiglet, "small" font), text that
   decodes itself, a typewriter, a punched card, and one spinning donut.
   Everything here is pure ASCII so it lines up in any monospace font.
   ========================================================= */

export const FIG = {
  brand: [
    '    _   _                 _                   _ ',
    ' __| |_| |_  __ _____ _ _| |_ _  _ _ _ ___ __| |',
    '(_-<  _| \' \\ \\ V / -_) \' \\  _| || | \'_/ -_) _` |',
    '/__/\\__|_||_(_)_/\\___|_||_\\__|\\_,_|_| \\___\\__,_|',
  ],
  access: [
    '   _   ___ ___ ___ ___ ___ ',
    '  /_\\ / __/ __| __/ __/ __|',
    ' / _ \\ (_| (__| _|\\__ \\__ \\',
    '/_/ \\_\\___\\___|___|___/___/',
  ],
  granted: [
    '  ___ ___    _   _  _ _____ ___ ___  ',
    ' / __| _ \\  /_\\ | \\| |_   _| __|   \\ ',
    '| (_ |   / / _ \\| .` | | | | _|| |) |',
    ' \\___|_|_\\/_/ \\_\\_|\\_| |_| |___|___/ ',
  ],
  night: [
    ' _  _ ___ ___ _  _ _____ ',
    '| \\| |_ _/ __| || |_   _|',
    '| .` || | (_ | __ | | |  ',
    '|_|\\_|___\\___|_||_| |_|  ',
  ],
  day: [
    ' ___   ___   __',
    '|   \\ /_\\ \\ / /',
    '| |) / _ \\ V / ',
    '|___/_/ \\_\\_|  ',
  ],
  closed: [
    '  ___ _    ___  ___ ___ ___  ',
    ' / __| |  / _ \\/ __| __|   \\ ',
    '| (__| |_| (_) \\__ \\ _|| |) |',
    ' \\___|____\\___/|___/___|___/ ',
  ],
};

const GLYPHS = '!<>-_\\/[]{}=+*^?#$%&@0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const rand = s => s[Math.floor(Math.random() * s.length)];
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* text that decodes itself, left to right (Latin and digits only; other characters appear as they are) */
export function scramble(el, { duration = 700 } = {}) {
  const final = el.dataset.text || el.textContent;
  el.dataset.text = final;
  if (reduce() || !/[A-Za-z0-9]/.test(final)) { el.textContent = final; return; }
  const start = performance.now();
  const step = now => {
    const p = Math.min(1, (now - start) / duration);
    const fixed = Math.floor(final.length * p);
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const c = final[i];
      out += i < fixed || !/[A-Za-z0-9]/.test(c) ? c : rand(GLYPHS);
    }
    el.textContent = out;
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* print lines one character at a time, like a teletype */
export function typewrite(el, { cps = 90 } = {}) {
  const full = el.textContent;
  if (reduce()) return;
  el.textContent = '';
  el.classList.add('is-typing');
  let i = 0;
  const t = setInterval(() => {
    i += Math.max(1, Math.round(cps / 30));
    el.textContent = full.slice(0, i);
    if (i >= full.length || !el.isConnected) { clearInterval(t); el.textContent = full; el.classList.remove('is-typing'); }
  }, 33);
}

/* [##########------]  a progress bar made of characters */
export function bar(frac, width = 16) {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return '[' + '#'.repeat(n) + '-'.repeat(width - n) + ']';
}

/* a stamp pattern (7x7 of 0/1) drawn as blocks of characters */
export const stampText = rows => rows.map(r => r.map(v => (v ? '##' : '  ')).join('')).join('\n');

/* The unlock animation (R-LAY-05): noise settles into the words, under three seconds, skippable. */
export function decrypt(pre, lines, { duration = 2200, onDone = () => {} } = {}) {
  const W = Math.max(...lines.map(l => l.length));
  const H = lines.length;
  const target = lines.map(l => l.padEnd(W));
  const order = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) order.push([x, y, Math.random() * 0.75 + (x / W) * 0.25]);
  const start = performance.now();
  let done = false;
  const finish = () => { if (done) return; done = true; pre.textContent = target.join('\n'); onDone(); };
  if (reduce()) { finish(); return finish; }
  const frame = now => {
    if (done) return;
    const p = (now - start) / duration;
    const grid = target.map(l => [...l]);
    for (const [x, y, k] of order) if (k > p && target[y][x] !== ' ') grid[y][x] = rand(GLYPHS);
      else if (k > p && Math.random() < 0.04) grid[y][x] = rand('.:');
    pre.textContent = grid.map(r => r.join('')).join('\n');
    if (p < 1) requestAnimationFrame(frame); else finish();
  };
  requestAnimationFrame(frame);
  return finish;
}

/* The member card as an IBM 029 punched card: each column is punched in Hollerith code. */
const ROWS = ['12', '11', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
function holes(c) {
  c = c.toUpperCase();
  if (/[0-9]/.test(c)) return [c];
  const i = 'ABCDEFGHI'.indexOf(c); if (i >= 0) return ['12', String(i + 1)];
  const j = 'JKLMNOPQR'.indexOf(c); if (j >= 0) return ['11', String(j + 1)];
  const k = 'STUVWXYZ'.indexOf(c); if (k >= 0) return ['0', String(k + 2)];
  if (c === '-') return ['11'];
  if (c === '.') return ['12', '3', '8'];
  return [];
}
export function punchCard(text, cols = 24) {
  const t = text.toUpperCase().slice(0, cols).padEnd(cols);
  const head = `<div class="pc__print">${[...t].map(c => `<i>${c === ' ' ? '&nbsp;' : c.replace('<', '&lt;')}</i>`).join('')}</div>`;
  const grid = ROWS.map(r => `<div class="pc__row">${[...t].map(c => `<i class="${holes(c).includes(r) ? 'is-hole' : ''}">${/^\d$/.test(r) ? r : ''}</i>`).join('')}</div>`).join('');
  return `<div class="pc__grid">${head}${grid}</div>`;
}

/* The donut. After Andy Sloane's donut.c (2006): a torus, lit, drawn with .,-~:;=!*#$@ */
export function donut(pre) {
  let A = 1, B = 1;
  const W = 46, H = 22;
  let alive = true;
  const frame = () => {
    if (!alive || !pre.isConnected) return;
    const b = Array(W * H).fill(' ');
    const z = Array(W * H).fill(0);
    const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
    for (let j = 0; j < 6.28; j += 0.07) {
      const cj = Math.cos(j), sj = Math.sin(j);
      for (let i = 0; i < 6.28; i += 0.02) {
        const ci = Math.cos(i), si = Math.sin(i);
        const h = cj + 2;
        const D = 1 / (si * h * sA + sj * cA + 5);
        const t = si * h * cA - sj * sA;
        const x = Math.floor(W / 2 + 20 * D * (ci * h * cB - t * sB));
        const y = Math.floor(H / 2 + 10 * D * (ci * h * sB + t * cB));
        const o = x + W * y;
        const N = Math.floor(8 * ((sj * sA - si * cj * cA) * cB - si * cj * sA - sj * cA - ci * cj * sB));
        if (y >= 0 && y < H && x >= 0 && x < W && D > z[o]) { z[o] = D; b[o] = '.,-~:;=!*#$@'[N > 0 ? N : 0]; }
      }
    }
    let s = '';
    for (let k = 0; k < H; k++) s += b.slice(k * W, k * W + W).join('') + '\n';
    pre.textContent = s;
    A += 0.07; B += 0.03;
    setTimeout(() => requestAnimationFrame(frame), 40);
  };
  frame();
  return () => { alive = false; };
}
