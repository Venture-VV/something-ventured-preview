/* =========================================================
   Tiny view helpers shared by the member app and the back office.
   `html` is a tagged template that escapes every interpolated value
   unless it is already markup (another html`` result or raw()).
   ========================================================= */
import { hz, daysBetween, hzDate } from './core.js';

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const flat = v => (v == null || v === false || v === true) ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(flat).join('') : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/* ---------- dates, always in Hangzhou time ---------- */
export const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const pad = n => String(n).padStart(2, '0');
const ofDate = date => hz(Date.parse(`${date}T12:00:00+08:00`));

export const fmt = {
  time: t => { const x = hz(t); return `${pad(x.h)}:${pad(x.mi)}`; },
  md: t => { const x = hz(t); return `${x.m}.${pad(x.d)}`; },
  mdOf: date => { const x = ofDate(date); return `${x.m}.${pad(x.d)}`; },
  dow: t => WEEK_ZH[hz(t).dow],
  dowOf: date => WEEK_ZH[ofDate(date).dow],
  dowEnOf: date => WEEK_EN[ofDate(date).dow],
  dayOf: date => ofDate(date).d,
  monthEnOf: date => MONTH_EN[ofDate(date).m - 1],
  parts: t => { const x = hz(t); return { ...x, mon: MONTH_EN[x.m - 1], dowEn: WEEK_EN[x.dow], dowZh: WEEK_ZH[x.dow] }; },
  full: t => { const x = hz(t); return `${x.y}.${pad(x.m)}.${pad(x.d)} ${WEEK_ZH[x.dow]} ${pad(x.h)}:${pad(x.mi)}`; },
  date: t => { const x = hz(t); return `${x.y}.${pad(x.m)}.${pad(x.d)}`; },
  range: (a, b) => `${fmt.md(a)} ${fmt.dow(a)} · ${fmt.time(a)} – ${fmt.time(b)}`,
  rel(t, now = Date.now()) {
    const s = (now - Date.parse(t)) / 1000;
    if (s < 0) {
      const days = daysBetween(hzDate(now), hzDate(t));
      return days === 0 ? `今天 ${fmt.time(t)}` : days === 1 ? `明天 ${fmt.time(t)}` : days < 7 ? `${days} 天后` : fmt.md(t);
    }
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400 && hzDate(t) === hzDate(now)) return `${Math.floor(s / 3600)} 小时前`;
    const days = daysBetween(hzDate(t), hzDate(now));
    if (days === 1) return `昨天 ${fmt.time(t)}`;
    if (days < 7) return `${days} 天前`;
    return fmt.md(t);
  },
};

/* ---------- toasts ---------- */
let toastHost;
export function toast(message, kind = 'info') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 4200 : 2800);
}

/* ---------- misc ---------- */
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const initialOf = name => String(name || '').trim().slice(0, 1) || '·';
