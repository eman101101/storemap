/** Shared design system + slide builders for the StoreMap system decks. */
import pptxgen from 'pptxgenjs';

// Palette — derived from StoreMap itself: brand green, floor cream tints,
// route-orange accent. Dark green-black covers, white content slides.
const C = {
  BG_DARK: '13201A',
  BG: 'FFFFFF',
  INK: '1D2A20',
  MUTED: '5B6B5F',
  FAINT: '8A978C',
  PRIMARY: '2F6F3E',
  PRIMARY_DK: '245831',
  TINT: 'E9F0EA',
  TINT2: 'F4F7F3',
  ACCENT: 'E4572E',
  ACCENT_TINT: 'FBEAE3',
  LINE: 'D8E0D8',
  CODE_BG: '152019',
  CODE_TX: 'CFE0D2',
  CODE_DIM: '7E9484',
  CODE_ACC: '9BD8AC',
  CODE_NUM: 'E8C88F',
  WHITE: 'FFFFFF',
};
const F = { head: 'Arial', body: 'Arial', mono: 'Consolas' };
const W = 13.33, H = 7.5, M = 0.5;

const mk = (system) => {
  const p = new pptxgen();
  p.layout = 'LAYOUT_WIDE';
  p.author = 'StoreMap';
  p.company = 'StoreMap';
  p.subject = system;
  return p;
};

const footer = (s, system, page) => {
  s.addText(`StoreMap  ·  ${system}`, { x: M, y: H - 0.34, w: 6, h: 0.24, fontSize: 9, fontFace: F.body, color: C.FAINT, margin: 0 });
  s.addText(String(page).padStart(2, '0'), { x: W - M - 0.6, y: H - 0.34, w: 0.6, h: 0.24, fontSize: 9, fontFace: F.body, color: C.FAINT, align: 'right', margin: 0 });
};

const header = (s, { kicker, title, system, page }) => {
  s.background = { color: C.BG };
  s.addShape('rect', { x: M, y: 0.46, w: 0.12, h: 0.12, fill: { color: C.PRIMARY } });
  s.addText(kicker.toUpperCase(), { x: M + 0.2, y: 0.38, w: 9, h: 0.28, fontSize: 10.5, fontFace: F.head, color: C.PRIMARY, bold: true, charSpacing: 2, margin: 0 });
  s.addText(title, { x: M, y: 0.66, w: W - 2 * M, h: 0.62, fontSize: 27, fontFace: F.head, color: C.INK, bold: true, margin: 0 });
  footer(s, system, page);
};

const cover = (p, { kicker, title, subtitle, stats = [], system }) => {
  const s = p.addSlide();
  s.background = { color: C.BG_DARK };
  // motif: row of small squares (the brand grid glyph)
  for (let i = 0; i < 3; i++) s.addShape('rect', { x: M + i * 0.22, y: 1.02, w: 0.12, h: 0.12, fill: { color: C.PRIMARY } });
  s.addText(kicker.toUpperCase(), { x: M + 0.74, y: 0.94, w: 10, h: 0.3, fontSize: 12, fontFace: F.head, color: C.CODE_ACC, bold: true, charSpacing: 3, margin: 0 });
  s.addText(title, { x: M, y: 1.9, w: W - 2 * M, h: 1.9, fontSize: 54, fontFace: F.head, color: C.WHITE, bold: true, margin: 0 });
  s.addText(subtitle, { x: M, y: 3.95, w: 8.6, h: 1.15, fontSize: 15.5, fontFace: F.body, color: 'B9C8BC', margin: 0 });
  const n = stats.length, bw = (W - 2 * M) / n;
  stats.forEach((st, i) => {
    const x = M + i * bw;
    s.addText(st.n, { x, y: 5.45, w: bw - 0.3, h: 0.85, fontSize: 44, fontFace: F.head, color: C.CODE_ACC, bold: true, margin: 0 });
    s.addText(st.label, { x, y: 6.3, w: bw - 0.3, h: 0.55, fontSize: 11.5, fontFace: F.body, color: '9DB0A2', margin: 0 });
  });
  s.addText(`StoreMap system series  ·  ${system}`, { x: M, y: H - 0.42, w: 8, h: 0.26, fontSize: 9.5, fontFace: F.body, color: '6E8174', margin: 0 });
  return s;
};

const closing = (p, { title, points, system }) => {
  const s = p.addSlide();
  s.background = { color: C.BG_DARK };
  s.addText(title, { x: M, y: 0.75, w: W - 2 * M, h: 0.8, fontSize: 30, fontFace: F.head, color: C.WHITE, bold: true, margin: 0 });
  points.forEach((pt, i) => {
    const y = 1.95 + i * 1.05;
    s.addText(String(i + 1).padStart(2, '0'), { x: M, y, w: 0.75, h: 0.6, fontSize: 26, fontFace: F.head, color: C.CODE_ACC, bold: true, margin: 0 });
    s.addText([
      { text: pt.t, options: { fontSize: 15, fontFace: F.head, color: C.WHITE, bold: true, breakLine: true } },
      { text: pt.d, options: { fontSize: 12, fontFace: F.body, color: 'A9BCAF' } },
    ], { x: M + 0.85, y: y - 0.02, w: W - 2 * M - 0.9, h: 0.95, margin: 0 });
  });
  s.addText(`StoreMap system series  ·  ${system}`, { x: M, y: H - 0.42, w: 8, h: 0.26, fontSize: 9.5, fontFace: F.body, color: '6E8174', margin: 0 });
  return s;
};

const bu = () => ({ code: '25B8', indent: 10, color: C.FAINT });
const bullets = (s, items, { x, y, w, h, size = 12.5, gap = 7 }) => {
  s.addText(
    items.map((it, i) => ({
      text: typeof it === 'string' ? it : it.t,
      options: {
        bullet: bu(), breakLine: true,
        bold: typeof it === 'object' && it.bold,
        color: typeof it === 'object' && it.color ? it.color : C.INK,
      },
    })),
    { x, y, w, h, fontSize: size, fontFace: F.body, paraSpaceAfter: gap, margin: 0, valign: 'top' }
  );
};

const card = (p, s, { x, y, w, h, title, body, tint = false }) => {
  s.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: tint ? C.TINT : C.WHITE },
    line: { color: tint ? C.TINT : C.LINE, width: 1 },
    shadow: { type: 'outer', color: '1D2A20', blur: 5, offset: 1.5, angle: 90, opacity: 0.1 },
  });
  if (title) s.addText(title, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.32, fontSize: 12.5, fontFace: F.head, bold: true, color: C.PRIMARY_DK, margin: 0 });
  if (body) s.addText(body, { x: x + 0.18, y: y + (title ? 0.44 : 0.14), w: w - 0.36, h: h - (title ? 0.58 : 0.28), fontSize: 11, fontFace: F.body, color: C.INK, margin: 0, valign: 'top' });
};

const codeCard = (p, s, { x, y, w, h, file, code, size = 10.5 }) => {
  s.addShape('roundRect', { x, y, w, h, rectRadius: 0.06, fill: { color: C.CODE_BG } });
  if (file) {
    s.addText(file, { x: x + 0.22, y: y + 0.1, w: w - 0.44, h: 0.26, fontSize: 9.5, fontFace: F.mono, color: C.CODE_DIM, margin: 0 });
    s.addShape('line', { x: x + 0.22, y: y + 0.38, w: w - 0.44, h: 0, line: { color: '27362C', width: 0.75 } });
  }
  const lines = code.split('\n').map((ln, i, arr) => ({
    text: ln.length ? ln : ' ',
    options: { breakLine: i < arr.length - 1 },
  }));
  s.addText(lines, {
    x: x + 0.22, y: y + (file ? 0.44 : 0.14), w: w - 0.44, h: h - (file ? 0.56 : 0.28),
    fontSize: size, fontFace: F.mono, color: C.CODE_TX, margin: 0, valign: 'top', lineSpacingMultiple: 1.04,
  });
};

const flow = (p, s, { x, y, w, bh = 0.95, steps, gap = 0.34, size = 11 }) => {
  const n = steps.length;
  const bw = (w - (n - 1) * gap) / n;
  steps.forEach((st, i) => {
    const bx = x + i * (bw + gap);
    s.addShape('roundRect', { x: bx, y, w: bw, h: bh, rectRadius: 0.05, fill: { color: st.fill || C.TINT }, line: { color: st.line || C.LINE, width: 1 } });
    s.addText([
      { text: st.t, options: { bold: true, fontSize: size, fontFace: F.head, color: C.PRIMARY_DK, breakLine: Boolean(st.d) } },
      ...(st.d ? [{ text: st.d, options: { fontSize: size - 2, fontFace: F.body, color: C.MUTED } }] : []),
    ], { x: bx + 0.1, y: y + 0.08, w: bw - 0.2, h: bh - 0.16, margin: 0, valign: 'middle', align: 'center' });
    if (i < n - 1) {
      s.addShape('line', { x: bx + bw + 0.05, y: y + bh / 2, w: gap - 0.1, h: 0, line: { color: C.MUTED, width: 1.5, endArrowType: 'triangle' } });
    }
  });
};

const stats = (s, list, { y = 1.55, x = M, w = W - 2 * M } = {}) => {
  const n = list.length;
  const bw = w / n;
  list.forEach((st, i) => {
    s.addText(st.n, { x: x + i * bw, y, w: bw - 0.25, h: 0.75, fontSize: 40, fontFace: F.head, color: C.PRIMARY, bold: true, margin: 0 });
    s.addText(st.l, { x: x + i * bw, y: y + 0.72, w: bw - 0.25, h: 0.5, fontSize: 11, fontFace: F.body, color: C.MUTED, margin: 0 });
  });
};

const chip = (p, s, { x, y, w, label, text }) => {
  s.addShape('roundRect', { x, y, w, h: 0.72, rectRadius: 0.05, fill: { color: C.ACCENT_TINT } });
  s.addShape('rect', { x: x + 0.16, y: y + 0.16, w: 0.1, h: 0.1, fill: { color: C.ACCENT } });
  s.addText([
    { text: label.toUpperCase() + '   ', options: { bold: true, fontSize: 9.5, fontFace: F.head, color: C.ACCENT, charSpacing: 1.5 } },
    { text, options: { fontSize: 10.5, fontFace: F.body, color: C.INK } },
  ], { x: x + 0.34, y: y + 0.06, w: w - 0.5, h: 0.6, margin: 0, valign: 'middle' });
};

const table = (p, s, { x, y, w, rows, colW, size = 10.5, head = true }) => {
  const data = rows.map((r, ri) =>
    r.map((c) => ({
      text: c,
      options: ri === 0 && head
        ? { bold: true, color: C.WHITE, fill: { color: C.PRIMARY_DK }, fontSize: size, fontFace: F.head }
        : { color: C.INK, fill: { color: ri % 2 ? C.WHITE : C.TINT2 }, fontSize: size, fontFace: F.body },
    }))
  );
  s.addTable(data, { x, y, w, colW, border: { pt: 0.5, color: C.LINE }, margin: 0.06, valign: 'middle' });
};

export { C, F, W, H, M, mk, header, cover, closing, bullets, card, codeCard, flow, stats, chip, table, footer };
export default { C, F, W, H, M, mk, header, cover, closing, bullets, card, codeCard, flow, stats, chip, table, footer };
