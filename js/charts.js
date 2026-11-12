'use strict';
/* グラフ。色は科目ごとに固定（--c-xx）、文字は文字色のまま。値は棒の先か表で必ず読めるようにする。 */

const Charts = (() => {
  const tipEl = () => document.getElementById('tip');

  /** 吹き出し。中身は DOM で組む（文字列を innerHTML に入れない）。 */
  function showTip(title, rows, total, x, y) {
    const t = tipEl();
    t.replaceChildren();
    const h = document.createElement('div'); h.className = 'tip-h'; h.textContent = title; t.append(h);
    if (total != null) {
      const v = document.createElement('div'); v.className = 'tip-total'; v.textContent = total; t.append(v);
    }
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'tip-row';
      const k = document.createElement('i'); k.className = 'tip-key'; k.style.background = `var(--c-${r.id})`;
      const val = document.createElement('b'); val.textContent = r.value;
      const name = document.createElement('span'); name.textContent = r.name;
      row.append(k, val, name); t.append(row);
    }
    t.hidden = false;
    const rc = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + rc.width > innerWidth - 8) left = x - rc.width - 14;
    if (top + rc.height > innerHeight - 8) top = y - rc.height - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { const t = tipEl(); if (t) t.hidden = true; }

  function niceStep(max, target = 4) {
    const raw = max / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /** 上だけ角丸の長方形（根元は四角） */
  function topRound(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h, w / 2));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /**
   * 積み上げ縦棒。cols: [{label, title, values:{id:分}, total}]
   * opts: {subjects:[{id,name}], goal:分|0, aria}
   */
  function stacked(el, cols, opts) {
    const W = Math.max(260, Math.floor(el.clientWidth));
    const H = opts.height || 220;
    const ml = 34, mr = 6, mt = 14, mb = 24;
    const pw = W - ml - mr, ph = H - mt - mb;
    const maxMin = Math.max(opts.goal || 0, 60, ...cols.map(c => c.total));
    const step = niceStep(maxMin / 60);
    const top = Math.ceil(maxMin / 60 / step - 1e-9) * step;
    const y = h => mt + ph - (h / top) * ph;
    const band = pw / cols.length;
    const bw = Math.min(24, Math.max(3, band * 0.62));
    const gap = 2;

    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${opts.aria}">`;
    s += `<rect class="hl" x="0" y="${mt}" width="${band}" height="${ph}" rx="4" opacity="0"/>`;
    for (let v = 0; v <= top + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      s += `<line class="${v === 0 ? 'axis' : 'gl'}" x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${ml - 6}" y="${yy + 4}" text-anchor="end">${+v.toFixed(1)}h</text>`;
    }
    cols.forEach((c, i) => {
      const x = ml + band * i + (band - bw) / 2;
      const segs = opts.subjects.filter(sb => (c.values[sb.id] || 0) > 0);
      let acc = 0;
      segs.forEach((sb, j) => {
        const v = c.values[sb.id];
        const y0 = y(acc / 60), y1 = y((acc + v) / 60);
        acc += v;
        const bottom = j > 0 ? y0 - gap : y0;
        const hgt = bottom - y1;
        if (hgt <= 0.4) return;
        const d = j === segs.length - 1 ? topRound(x, y1, bw, hgt, 4) : `M${x},${y1}h${bw}v${hgt}h${-bw}Z`;
        s += `<path d="${d}" style="fill:var(--c-${sb.id})"/>`;
      });
    });
    if (opts.goal) {
      const gy = Math.round(y(opts.goal / 60)) + 0.5;
      s += `<line class="goal" x1="${ml}" x2="${W - mr}" y1="${gy}" y2="${gy}"/>`;
      s += `<text class="goal-t" x="${W - mr}" y="${gy - 5}" text-anchor="end">目標 ${fmtH(opts.goal)}</text>`;
    }
    const every = Math.max(1, Math.ceil(cols.length / Math.max(1, Math.floor(pw / 46))));
    cols.forEach((c, i) => {
      if ((cols.length - 1 - i) % every) return;
      s += `<text class="xl" x="${ml + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${c.label}</text>`;
    });
    s += `</svg>`;
    el.innerHTML = s;

    const svg = el.querySelector('svg');
    const hl = svg.querySelector('.hl');
    const at = e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      const i = Math.floor((px - ml) / band);
      return i >= 0 && i < cols.length ? i : -1;
    };
    const show = (e) => {
      const i = at(e);
      if (i < 0) { hl.setAttribute('opacity', 0); hideTip(); return; }
      const c = cols[i];
      hl.setAttribute('x', ml + band * i); hl.setAttribute('opacity', 1);
      const rows = opts.subjects.filter(sb => c.values[sb.id] > 0).reverse()
        .map(sb => ({ id: sb.id, name: sb.name, value: fmtDur(c.values[sb.id]) }));
      showTip(c.title, rows, c.total ? `合計 ${fmtDur(c.total)}` : '記録なし', e.clientX, e.clientY);
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { hl.setAttribute('opacity', 0); hideTip(); });
  }

  /** 横棒（科目別の時間）。rows: [{id,name,min}] 値と割合を棒の先に出す。 */
  function hbars(rows) {
    const total = rows.reduce((a, r) => a + r.min, 0);
    const max = Math.max(1, ...rows.map(r => r.min));
    return `<div class="hbars">${rows.map(r => {
      const pct = total ? Math.round(r.min / total * 100) : 0;
      return `<div class="hb-row">
        <span class="hb-name"><i class="sw" style="background:var(--c-${r.id})"></i>${r.name}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${(r.min / max * 100).toFixed(2)}%;background:var(--c-${r.id})"></span></span>
        <span class="hb-val"><b>${fmtH(r.min)}</b><small>${pct}%</small></span>
      </div>`;
    }).join('')}</div>`;
  }

  /** 細い割合バー（全体＝100%）。凡例は下に並ぶ行が兼ねる。 */
  function segbar(rows, label) {
    const total = rows.reduce((a, r) => a + r.min, 0);
    if (!total) return `<div class="segbar empty" aria-hidden="true"></div>`;
    const parts = rows.filter(r => r.min > 0);
    const name = parts.map(r => `${r.name}${Math.round(r.min / total * 100)}%`).join('、');
    return `<div class="segbar" role="img" aria-label="${label}：${name}">${parts.map(r =>
      `<span style="flex:${r.min} 1 0;background:var(--c-${r.id})" title="${r.name} ${fmtDur(r.min)}（${Math.round(r.min / total * 100)}%）"></span>`).join('')}</div>`;
  }

  /** 予定と実績を並べた横棒。rows: [{id,name,plan,act}] */
  function pairBars(rows) {
    const max = Math.max(1, ...rows.map(r => Math.max(r.plan, r.act)));
    return `<div class="pbars"><div class="pb-row pb-head" aria-hidden="true"><span></span><span></span><span class="pb-val"><span>予定</span><span>実績</span></span></div>${rows.map(r => `
      <div class="pb-row">
        <span class="hb-name"><i class="sw" style="background:var(--c-${r.id})"></i>${r.name}</span>
        <span class="pb-tracks">
          <span class="hb-track thin"><span class="hb-fill plan" style="width:${(r.plan / max * 100).toFixed(2)}%;--c:var(--c-${r.id})"></span></span>
          <span class="hb-track thin"><span class="hb-fill" style="width:${(r.act / max * 100).toFixed(2)}%;background:var(--c-${r.id})"></span></span>
        </span>
        <span class="pb-val"><span>${fmtH(r.plan)}</span><b>${fmtH(r.act)}</b></span>
      </div>`).join('')}</div>`;
  }

  return { stacked, hbars, segbar, pairBars, hideTip };
})();
