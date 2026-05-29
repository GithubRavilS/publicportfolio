/** Интерактивный график истории портфеля */

const chartState = new WeakMap();

function fmtUsdShort(v) {
  return (
    "$" +
    Number(v || 0).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: v >= 1000 ? 0 : 2,
    })
  );
}

function layout(series, w, h) {
  const vals = series.map((p) => p.v);
  const min = Math.min(...vals) * 0.92;
  const max = Math.max(...vals) * 1.06;
  const pad = { l: 12, r: 16, t: 20, b: 36 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (i / Math.max(series.length - 1, 1)) * iw;
  const yAt = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  return { series, min, max, pad, iw, ih, w, h, xAt, yAt };
}

function formatDateLabel(d, locale) {
  if (!d) return "";
  try {
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d.slice(0, 10);
  }
}

function drawChart(ctx, L, hoverIdx) {
  const { series, min, max, pad, iw, ih, w, h, xAt, yAt } = L;

  ctx.clearRect(0, 0, w, h);

  // сетка
  ctx.strokeStyle = "rgba(120, 140, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ih / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + iw, y);
    ctx.stroke();
  }

  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, "rgba(34, 211, 238, 0.32)");
  grad.addColorStop(1, "rgba(34, 211, 238, 0)");

  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + iw, pad.t + ih);
  ctx.lineTo(pad.l, pad.t + ih);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // подписи дат по краям
  ctx.fillStyle = "#6b7a9e";
  ctx.font = "600 10px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(series[0]?.d?.slice(0, 10) || "", pad.l, h - 10);
  ctx.textAlign = "right";
  ctx.fillText(series[series.length - 1]?.d?.slice(0, 10) || "", w - pad.r, h - 10);

  if (hoverIdx == null || hoverIdx < 0) return;

  const pt = series[hoverIdx];
  const hx = xAt(hoverIdx);
  const hy = yAt(pt.v);

  // вертикальная линия
  ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(hx, pad.t);
  ctx.lineTo(hx, pad.t + ih);
  ctx.stroke();
  ctx.setLineDash([]);

  // точка на линии
  ctx.beginPath();
  ctx.arc(hx, hy, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#22d3ee";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // метка даты внизу
  ctx.fillStyle = "rgba(8, 10, 24, 0.92)";
  const dateLbl = formatDateLabel(pt.d, chartState.get(ctx.canvas)?.locale || "ru");
  ctx.font = "700 11px Inter, sans-serif";
  const tw = ctx.measureText(dateLbl).width + 14;
  let tx = hx - tw / 2;
  tx = Math.max(pad.l, Math.min(tx, w - pad.r - tw));
  const ty = h - pad.b + 6;
  roundRect(ctx, tx, ty, tw, 20, 8);
  ctx.fill();
  ctx.fillStyle = "#e8ecff";
  ctx.textAlign = "center";
  ctx.fillText(dateLbl, tx + tw / 2, ty + 14);

  // метка цены у точки
  const priceLbl = fmtUsdShort(pt.v);
  ctx.font = "800 12px Inter, sans-serif";
  const pw = ctx.measureText(priceLbl).width + 14;
  let px = hx + 12;
  if (px + pw > w - pad.r) px = hx - pw - 12;
  let py = hy - 28;
  py = Math.max(pad.t + 4, py);
  roundRect(ctx, px, py, pw, 24, 10);
  ctx.fillStyle = "rgba(8, 10, 24, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(74, 222, 128, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#4ade80";
  ctx.textAlign = "center";
  ctx.fillText(priceLbl, px + pw / 2, py + 16);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function indexFromX(L, clientX, rect) {
  const x = clientX - rect.left - L.pad.l;
  const i = Math.round((x / L.iw) * (L.series.length - 1));
  return Math.max(0, Math.min(L.series.length - 1, i));
}

export function setupHistoryChart(canvas, series, locale) {
  if (!canvas || !series?.length) return () => {};

  const existing = chartState.get(canvas);
  if (existing?.cleanup) existing.cleanup();

  const ctx = canvas.getContext("2d");
  const state = { hover: null, locale: locale || "ru" };
  chartState.set(canvas, state);

  const paint = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 220;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    const L = layout(series, w, h);
    state.L = L;
    drawChart(ctx, L, state.hover);
  };

  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!state.L) return;
    state.hover = indexFromX(state.L, e.clientX, rect);
    paint();
  };

  const onLeave = () => {
    state.hover = null;
    paint();
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) onMove(e.touches[0]);
    },
    { passive: true },
  );
  canvas.addEventListener("touchend", onLeave);

  const onResize = () => paint();
  window.addEventListener("resize", onResize);

  paint();

  const cleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("resize", onResize);
    chartState.delete(canvas);
  };
  state.cleanup = cleanup;
  return cleanup;
}

/** @deprecated use setupHistoryChart */
export function renderHistoryChart(canvas, series, lang) {
  setupHistoryChart(canvas, series, lang);
}
