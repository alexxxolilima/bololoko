import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const r = {
  logo: document.getElementById("brandLogo"),
  search: document.getElementById("searchInput"),
  nav: document.getElementById("categoryNav"),
  hi: document.getElementById("highlightsTrack"),
  hiTime: document.querySelector(".highlights-time"),
  list: document.getElementById("menuList"),
  overlay: document.getElementById("modalOverlay"),
  modal: document.getElementById("modalContent"),
  toast: document.getElementById("toast")
};

const HIGHLIGHT_REFRESH_MS = 60 * 1000;
const MOBILE_MAX = 739;
const DEFAULT_SETTINGS = {
  fontMain: "Barlow Condensed",
  fontDisplay: "Teko",
  baseScale: 1,
  titleScale: 1,
  highlightThumbH: 112,
  itemThumbSize: 60,
  accent: "#ffd13f",
  accent2: "#ff2f2f",
  bg: "#2d1308",
  surface: "#3a180a",
  text: "#fff8ef",
  textMuted: "#f7d5b5"
};
const DEFAULT_PDF = {
  title: "BOLOLOKO",
  subtitle: "Cardapio de bolos de copo",
  orientation: "portrait",
  pageSize: "A4",
  align: "left",
  font: "Arial",
  colorText: "#2a1207",
  colorAccent: "#1f5eff",
  colorBg: "#ffffff",
  logoPath: "./logo.png",
  showLogo: true,
  showImages: true,
  layoutMode: "cards",
  density: "normal",
  showDesc: true,
  showPrice: true
};

const S = {
  menu: { categories: [], settings: { ...DEFAULT_SETTINGS } },
  items: new Map(),
  img: new Map(),
  tag: "todos",
  q: "",
  db: null,
  auth: null,
  unsub: null,
  admin: false,
  draft: null,
  taps: 0,
  tapTimer: null,
  hiOffset: 0,
  hiUpdatedAt: 0,
  admImageData: "",
  admEditImageData: "",
  admTab: "tema",
  admEditId: ""
};

const APP_ID = typeof __app_id !== "undefined" ? __app_id : "default-app";
const DOC = ["artifacts", APP_ID, "public", "data", "menu_store", "main"];
const CK_MENU = "bololoko_menu_cache_v2";
const CK_ADM = "bololoko_admin_session_v1";
const CK_PDF = "bololoko_pdf_cfg_v1";
const CK_PDF_DB = "bololoko_pdf_db_v1";
const PDF_DB_FILE = "./data/pdf_store.json";
const ADM_TTL = 20 * 60 * 1000;
const PAGE_MODE = String(window.__page_mode || "").trim().toLowerCase();
let JSPDF_PROMISE = null;

function t(msg) { r.toast.textContent = msg; r.toast.classList.add("show"); setTimeout(() => r.toast.classList.remove("show"), 1800); }
function h(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function n(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
function brl(v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function idFromName(name, fallback = "item") { return `${n(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback}_${Date.now().toString(36)}`; }
function priceNum(v) {
  const raw = String(v || "").trim().replace(/\s+/g, "").replace(",", ".");
  const clean = raw.replace(/[^0-9.]/g, "");
  if (!clean) return 0;
  const n1 = Number(clean);
  return Number.isFinite(n1) ? n1 : 0;
}

function priceMask(v) {
  const n1 = priceNum(v);
  return n1.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normPdfCfg(raw) {
  const p = raw || {};
  const pick = (v, d) => String(v || d).trim() || d;
  return {
    title: pick(p.title, DEFAULT_PDF.title),
    subtitle: pick(p.subtitle, DEFAULT_PDF.subtitle),
    orientation: pick(p.orientation, DEFAULT_PDF.orientation) === "landscape" ? "landscape" : "portrait",
    pageSize: ["A4", "A5", "Letter"].includes(pick(p.pageSize, DEFAULT_PDF.pageSize)) ? pick(p.pageSize, DEFAULT_PDF.pageSize) : "A4",
    align: ["left", "center"].includes(pick(p.align, DEFAULT_PDF.align)) ? pick(p.align, DEFAULT_PDF.align) : "left",
    font: ["Arial", "Georgia", "Times New Roman", "Verdana", "Montserrat"].includes(pick(p.font, DEFAULT_PDF.font)) ? pick(p.font, DEFAULT_PDF.font) : "Arial",
    colorText: pick(p.colorText, DEFAULT_PDF.colorText),
    colorAccent: pick(p.colorAccent, DEFAULT_PDF.colorAccent),
    colorBg: pick(p.colorBg, DEFAULT_PDF.colorBg),
    logoPath: pick(p.logoPath, DEFAULT_PDF.logoPath),
    showLogo: p.showLogo !== false,
    showImages: p.showImages !== false,
    layoutMode: ["cards", "lista"].includes(pick(p.layoutMode, DEFAULT_PDF.layoutMode)) ? pick(p.layoutMode, DEFAULT_PDF.layoutMode) : "cards",
    density: ["compacta", "normal", "espacada"].includes(pick(p.density, DEFAULT_PDF.density)) ? pick(p.density, DEFAULT_PDF.density) : "normal",
    showDesc: p.showDesc !== false,
    showPrice: p.showPrice !== false
  };
}

function normSettings(raw) {
  const s = raw || {};
  const num = (x, min = 0.8, max = 1.4, d = 1) => {
    const v = Number(x);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
  };
  return {
    fontMain: String(s.fontMain || DEFAULT_SETTINGS.fontMain).trim() || DEFAULT_SETTINGS.fontMain,
    fontDisplay: String(s.fontDisplay || DEFAULT_SETTINGS.fontDisplay).trim() || DEFAULT_SETTINGS.fontDisplay,
    baseScale: num(s.baseScale, 0.72, 1.45, 1),
    titleScale: num(s.titleScale, 0.72, 1.7, 1),
    highlightThumbH: num(s.highlightThumbH, 84, 180, 112),
    itemThumbSize: num(s.itemThumbSize, 48, 120, 60),
    accent: String(s.accent || DEFAULT_SETTINGS.accent).trim() || DEFAULT_SETTINGS.accent,
    accent2: String(s.accent2 || DEFAULT_SETTINGS.accent2).trim() || DEFAULT_SETTINGS.accent2,
    bg: String(s.bg || DEFAULT_SETTINGS.bg).trim() || DEFAULT_SETTINGS.bg,
    surface: String(s.surface || DEFAULT_SETTINGS.surface).trim() || DEFAULT_SETTINGS.surface,
    text: String(s.text || DEFAULT_SETTINGS.text).trim() || DEFAULT_SETTINGS.text,
    textMuted: String(s.textMuted || DEFAULT_SETTINGS.textMuted).trim() || DEFAULT_SETTINGS.textMuted,
    pdf: normPdfCfg(s.pdf)
  };
}

function applyTheme(settings) {
  const s = normSettings(settings);
  const root = document.documentElement.style;
  root.setProperty("--font-main", `"${s.fontMain}", "Segoe UI", sans-serif`);
  root.setProperty("--font-display", `"${s.fontDisplay}", "Impact", sans-serif`);
  root.setProperty("--base-scale", String(s.baseScale));
  root.setProperty("--title-scale", String(s.titleScale));
  root.setProperty("--accent", s.accent);
  root.setProperty("--accent-2", s.accent2);
  root.setProperty("--bg", s.bg);
  root.setProperty("--surface", s.surface);
  root.setProperty("--text", s.text);
  root.setProperty("--text-muted", s.textMuted);
  root.setProperty("--highlight-thumb-h", `${Number(s.highlightThumbH) || 112}px`);
  root.setProperty("--item-thumb-size", `${Number(s.itemThumbSize) || 60}px`);
}

function norm(raw) {
  const cats = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    settings: normSettings(raw?.settings),
    categories: cats.map((c, ci) => ({
      id: c?.id || `cat_${ci}_${Date.now().toString(36)}`,
      name: String(c?.name || `Secao ${ci + 1}`).trim(),
      items: (Array.isArray(c?.items) ? c.items : []).map((i, ii) => ({
        id: i?.id || `item_${ci}_${ii}`,
        name: String(i?.name || "Item").trim(),
        desc: String(i?.desc || "").trim(),
        image: String(i?.image || "").trim(),
        imageSize: Number.isFinite(Number(i?.imageSize)) ? Number(i.imageSize) : 100,
        imageZoom: Number.isFinite(Number(i?.imageZoom)) ? Number(i.imageZoom) : 1,
        price: Number.isFinite(Number(i?.price)) ? Number(i.price) : 0,
        available: i?.available !== false
      }))
    }))
  };
}

function payload(menu) {
  return {
    settings: normSettings(menu?.settings),
    categories: (menu.categories || []).map((c) => ({
      id: c.id,
      name: c.name,
      items: (c.items || []).map((i) => ({ id: i.id, name: i.name, desc: i.desc || "", image: i.image || "", imageSize: Number(i.imageSize) || 100, imageZoom: Number(i.imageZoom) || 1, price: Number(i.price) || 0, available: i.available !== false }))
    })),
    updatedAt: Date.now()
  };
}

function idx() {
  S.items.clear();
  S.img.clear();
  S.menu.categories.forEach((c) => c.items.forEach((i) => {
    i._k = n(`${i.name} ${i.desc} ${c.name}`);
    S.items.set(i.id, i);
  }));
}

function vis(i) { return S.admin ? i._k.includes(S.q) : i.available !== false && i._k.includes(S.q); }
function filtCats() { return S.menu.categories.filter((c) => S.tag === "todos" || c.id === S.tag).map((c) => ({ ...c, items: c.items.filter(vis) })).filter((c) => c.items.length); }
function allItems() { return S.menu.categories.filter((c) => S.tag === "todos" || c.id === S.tag).flatMap((c) => c.items).filter(vis); }

function setImg(el, item, onFail) {
  const list = [item.image, `./images/${item.id}.jpg`, `./images/${item.id}.png`].filter(Boolean);
  let p = 0;
  const go = () => {
    if (p >= list.length) { el.style.display = "none"; if (onFail) onFail(); return; }
    el.src = list[p++];
    el.onload = () => { el.style.display = "block"; };
    el.onerror = go;
  };
  go();
}

function applyItemImageStyle(img, item, kind = "item") {
  if (!img || !item) return;
  const rawSize = Math.min(160, Math.max(70, Number(item.imageSize) || 100));
  const rawZoom = Math.min(2.8, Math.max(0.45, Number(item.imageZoom) || 1));
  if (kind === "highlight") {
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.transform = "none";
    img.style.transformOrigin = "center center";
    return;
  }
  const size = rawSize;
  const zoom = rawZoom;
  img.style.width = `${size}%`;
  img.style.height = `${size}%`;
  img.style.transform = `scale(${zoom})`;
  img.style.transformOrigin = "center center";
}

function renderNav() {
  r.nav.innerHTML = "";
  [{ id: "todos", label: "Todos" }, ...S.menu.categories.map((c) => ({ id: c.id, label: c.name }))].forEach((x) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip ui-btn ${S.tag === x.id ? "active" : ""}`;
    b.textContent = x.label;
    b.onclick = () => { S.tag = S.tag === x.id ? "todos" : x.id; render(); };
    r.nav.appendChild(b);
  });
}

function hiLimit() {
  return window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches ? 2 : 4;
}

function hiClock(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderHighlights() {
  const arr = allItems();
  if (!arr.length) {
    r.hi.innerHTML = '<div class="empty-state">Sem sabores para destacar agora.</div>';
    if (r.hiTime) r.hiTime.textContent = "Sem destaques ativos";
    return;
  }

  const limit = Math.min(hiLimit(), arr.length);
  const start = arr.length ? S.hiOffset % arr.length : 0;
  const rot = arr.slice(start).concat(arr.slice(0, start)).slice(0, limit);
  r.hi.innerHTML = "";
  rot.forEach((i) => {
    const c = document.createElement("button");
    c.className = "highlight-card ui-btn";
    c.dataset.id = i.id;
    c.innerHTML = `<div class="highlight-thumb"><img alt="${h(i.name)}"></div><div class="highlight-content"><div class="highlight-name">${h(i.name)}</div><span class="highlight-price">${brl(i.price)}</span>${i.available === false ? '<span class="item-status item-status-off">Inativo</span>' : ""}</div>`;
    const img = c.querySelector("img");
    setImg(img, i, () => c.classList.add("no-image"));
    applyItemImageStyle(img, i, "highlight");
    r.hi.appendChild(c);
  });

  if (r.hiTime) r.hiTime.textContent = `${hiClock(S.hiUpdatedAt || Date.now())}`;
}

function renderMenu() {
  const cats = filtCats();
  if (!cats.length) { r.list.innerHTML = '<div class="empty-state">Nenhum sabor encontrado com esses filtros.</div>'; return; }
  r.list.innerHTML = "";
  cats.forEach((c) => {
    const s = document.createElement("section");
    s.className = "category-section";
    s.innerHTML = `<header class="cat-header"><h3 class="cat-title">${h(c.name)}</h3><span class="cat-count">${c.items.length} sabores</span></header><div class="items-list"></div>`;
    const wrap = s.querySelector(".items-list");
    c.items.forEach((i) => {
      const a = document.createElement("article");
      a.className = `item-card ${i.available === false ? "is-unavailable" : ""}`;
      a.dataset.id = i.id;
      a.tabIndex = 0;
      a.setAttribute("role", "button");
      a.innerHTML = `<div class="item-thumb"><img alt="${h(i.name)}"></div><div class="item-content"><h4 class="item-name">${h(i.name)}</h4>${i.desc ? `<p class="item-desc">${h(i.desc)}</p>` : ""}<div class="item-bottom"><span class="item-price">${brl(i.price)}</span>${i.available === false ? '<span class="item-status item-status-off">Inativo</span>' : '<span class="item-cta">Ver detalhes</span>'}</div></div>`;
      const img = a.querySelector("img");
      setImg(img, i);
      applyItemImageStyle(img, i, "item");
      wrap.appendChild(a);
    });
    r.list.appendChild(s);
  });
}

function openItem(i) {
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Detalhes do produto</h3><button class="modal-close ui-btn" type="button" aria-label="Fechar" onclick="closeModal()">Fechar</button></div><div class="modal-body" id="mBody"><img id="mImg" class="modal-image" alt="Imagem do produto"><div class="modal-info"><h2 class="modal-name">${h(i.name)}</h2><p class="modal-desc">${h(i.desc || "Sem descricao adicional.")}</p><span class="modal-price">${brl(i.price)}</span></div></div>`;
  const m = document.getElementById("mImg");
  setImg(m, i, () => document.getElementById("mBody")?.classList.add("no-image"));
  applyItemImageStyle(m, i, "modal");
  r.overlay.classList.add("active");
  r.overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function render() { applyTheme(S.menu.settings); renderNav(); renderHighlights(); renderMenu(); }

function printMenuPdf() {
  const baseMenu = S.admin && S.draft && Array.isArray(S.draft.categories) ? norm(S.draft) : S.menu;
  const pdf = normPdfCfg(baseMenu?.settings?.pdf);
  const cats = (baseMenu.categories || []).map((c) => ({
    name: c.name,
    items: (c.items || []).filter((i) => i.available !== false)
  })).filter((c) => c.items.length > 0);

  if (!cats.length) {
    t("Não há itens ativos para imprimir");
    return;
  }

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${h(pdf.title)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: ${pdf.pageSize} ${pdf.orientation}; margin: 10mm; }
    body { margin: 0; padding: 16px; font-family: ${h(pdf.font)}, sans-serif; color: ${h(pdf.colorText)}; background: ${h(pdf.colorBg)}; }
    .head { margin-bottom: 16px; }
    h1 { margin: 0; font-size: 28px; color: ${h(pdf.colorAccent)}; text-align: ${h(pdf.align)}; }
    .sub { margin-top: 4px; font-size: 13px; color: ${h(pdf.colorText)}; text-align: ${h(pdf.align)}; opacity: 0.85; }
    .cat { margin-top: 18px; page-break-inside: avoid; }
    .cat h2 { margin: 0 0 8px; font-size: 22px; color: ${h(pdf.colorAccent)}; border-bottom: 1px solid #e0c7b8; padding-bottom: 6px; }
    .item { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px dashed #ead9cf; }
    .name { font-weight: 700; }
    .desc { margin-top: 4px; color: ${h(pdf.colorText)}; font-size: 13px; opacity: 0.88; }
    .price { font-weight: 800; white-space: nowrap; }
  </style>
</head>
<body>
  <div class="head">
    <h1>${h(pdf.title)}</h1>
    <div class="sub">${h(pdf.subtitle)}</div>
  </div>
  ${cats.map((c) => `<section class="cat"><h2>${h(c.name)}</h2>${c.items.map((i) => `<article class="item"><div><div class="name">${h(i.name)}</div>${pdf.showDesc && i.desc ? `<div class="desc">${h(i.desc)}</div>` : ""}</div>${pdf.showPrice ? `<div class="price">${h(brl(i.price))}</div>` : ""}</article>`).join("")}</section>`).join("")}
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => iframe.remove(), 1500);
      }
    }, 180);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  t("Abrindo impressao do cardapio");
}

function hexToRgb(hex, fallback = [255, 255, 255]) {
  const raw = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function slugName(v) {
  return String(v || "cardapio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "cardapio";
}

function getPdfFontFamily(name) {
  const n1 = String(name || "").toLowerCase();
  if (n1.includes("times") || n1.includes("georgia")) return "times";
  if (n1.includes("courier")) return "courier";
  return "helvetica";
}

async function loadJsPdf() {
  if (!JSPDF_PROMISE) {
    JSPDF_PROMISE = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  }
  return JSPDF_PROMISE;
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => resolve("");
    fr.readAsDataURL(blob);
  });
}

async function imageToDataUrl(path) {
  const src = String(path || "").trim();
  if (!src) return "";
  if (/^data:image\//i.test(src)) return src;
  try {
    const res = await fetch(src, { cache: "force-cache" });
    if (!res.ok) return "";
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return "";
  }
}

function dataUrlType(dataUrl = "") {
  const m = /^data:image\/(png|jpeg|jpg|webp);/i.exec(String(dataUrl));
  if (!m) return "JPEG";
  return m[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

async function resolveItemImage(item) {
  const list = [item?.image, `./images/${item?.id}.jpg`, `./images/${item?.id}.png`, `./images/${item?.id}.jpeg`, `./images/${item?.id}.webp`].filter(Boolean);
  for (const p of list) {
    const data = await imageToDataUrl(p);
    if (data) return data;
  }
  return "";
}

async function exportMenuPdf() {
  const baseMenu = S.admin && S.draft && Array.isArray(S.draft.categories) ? norm(S.draft) : S.menu;
  const pdf = normPdfCfg(baseMenu?.settings?.pdf);
  const cats = (baseMenu.categories || []).map((c) => ({
    name: c.name,
    items: (c.items || []).filter((i) => i.available !== false)
  })).filter((c) => c.items.length > 0);

  if (!cats.length) {
    t("Não há itens ativos para exportar");
    return;
  }

  const mod = await loadJsPdf();
  const { jsPDF } = mod;
  const doc = new jsPDF({
    orientation: pdf.orientation === "landscape" ? "l" : "p",
    unit: "mm",
    format: String(pdf.pageSize || "A4")
  });

  const [bgR, bgG, bgB] = hexToRgb(pdf.colorBg, [255, 255, 255]);
  const [txR, txG, txB] = hexToRgb(pdf.colorText, [42, 18, 7]);
  const [acR, acG, acB] = hexToRgb(pdf.colorAccent, [31, 94, 255]);
  const densityMap = {
    compacta: { sectionGap: 3, itemGap: 2.5, lineGap: 3.8, cardH: 18 },
    normal: { sectionGap: 5, itemGap: 3.8, lineGap: 4.6, cardH: 22 },
    espacada: { sectionGap: 7, itemGap: 5, lineGap: 5.3, cardH: 26 }
  };
  const dz = densityMap[pdf.density] || densityMap.normal;
  const margin = 12;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  const align = pdf.align === "center" ? "center" : "left";
  const xBase = align === "center" ? pageW / 2 : margin;
  const font = getPdfFontFamily(pdf.font);

  const paintPageBg = () => {
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(0, 0, pageW, pageH, "F");
  };

  paintPageBg();
  const logoData = pdf.showLogo ? await imageToDataUrl(pdf.logoPath || "./logo.png") : "";
  const hasLogo = Boolean(logoData);
  let titleY = margin + 2;
  if (hasLogo) {
    const logoW = 18;
    const logoH = 18;
    const logoX = align === "center" ? (pageW / 2) - (logoW / 2) : margin;
    doc.addImage(logoData, dataUrlType(logoData), logoX, margin, logoW, logoH);
    titleY = margin + logoH + 4;
  }

  doc.setFont(font, "bold");
  doc.setTextColor(acR, acG, acB);
  doc.setFontSize(24);
  doc.text(pdf.title, xBase, titleY, { align });

  doc.setFont(font, "normal");
  doc.setTextColor(txR, txG, txB);
  doc.setFontSize(12);
  doc.text(pdf.subtitle, xBase, titleY + 7, { align });

  let y = titleY + 16;

  const ensureSpace = (need = 10) => {
    if (y + need <= pageH - margin) return;
    doc.addPage();
    paintPageBg();
    y = margin;
  };

  for (let ci = 0; ci < cats.length; ci += 1) {
    const cat = cats[ci];
    ensureSpace(12);
    doc.setFont(font, "bold");
    doc.setTextColor(acR, acG, acB);
    doc.setFontSize(16);
    doc.text(cat.name, xBase, y, { align });
    y += 2;
    doc.setDrawColor(acR, acG, acB);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 6 + dz.sectionGap;

    for (const item of cat.items) {
      const cardNeed = pdf.layoutMode === "cards" ? dz.cardH + 8 : 12;
      ensureSpace(cardNeed);

      if (pdf.layoutMode === "cards") {
        doc.setDrawColor(230, 216, 206);
        doc.setFillColor(255, 255, 255);
        doc.setLineWidth(0.2);
        doc.roundedRect(margin, y - 4, maxW, dz.cardH, 2, 2, "S");
      }

      const showItemImage = pdf.showImages && pdf.layoutMode === "cards";
      let textStartX = margin;
      if (showItemImage) {
        const imData = await resolveItemImage(item);
        if (imData) {
          const imgW = 16;
          const imgH = dz.cardH - 6;
          doc.addImage(imData, dataUrlType(imData), margin + 2, y - 2.5, imgW, imgH);
          textStartX = margin + imgW + 5;
        }
      }

      doc.setFont(font, "bold");
      doc.setTextColor(txR, txG, txB);
      doc.setFontSize(12);
      const itemName = String(item.name || "");
      doc.text(itemName, align === "center" ? xBase : textStartX, y, { align: align === "center" ? "center" : "left" });

      if (pdf.showPrice) {
        doc.setFont(font, "bold");
        doc.setTextColor(acR, acG, acB);
        doc.setFontSize(11);
        if (align === "center") {
          y += 5;
          doc.text(brl(item.price), xBase, y, { align: "center" });
        } else {
          doc.text(brl(item.price), pageW - margin - (pdf.layoutMode === "cards" ? 2 : 0), y, { align: "right" });
        }
      }

      y += 5;
      if (pdf.showDesc && item.desc) {
        doc.setFont(font, "normal");
        doc.setTextColor(txR, txG, txB);
        doc.setFontSize(10);
        const descW = align === "center" ? maxW : (maxW - (textStartX - margin));
        const lines = doc.splitTextToSize(String(item.desc), descW);
        lines.forEach((ln) => {
          ensureSpace(dz.lineGap + 1.2);
          doc.text(String(ln), align === "center" ? xBase : textStartX, y, { align: align === "center" ? "center" : "left" });
          y += dz.lineGap;
        });
      }
      if (pdf.layoutMode === "lista") {
        doc.setDrawColor(210, 196, 188);
        doc.setLineWidth(0.12);
        doc.line(margin, y, pageW - margin, y);
      }
      y += dz.itemGap;
    }

    if (ci < cats.length - 1) y += dz.sectionGap;
  }

  doc.save(`${slugName(pdf.title)}_cardapio.pdf`);
  t("PDF gerado com sucesso");
}

function tickHighlights() {
  const count = allItems().length;
  if (!count) return;
  S.hiOffset = (S.hiOffset + 1) % count;
  S.hiUpdatedAt = Date.now();
  renderHighlights();
}

function cacheSave(menu) { try { localStorage.setItem(CK_MENU, JSON.stringify(payload(menu))); } catch {} }
function cacheLoad() { try { const j = JSON.parse(localStorage.getItem(CK_MENU) || "null"); return Array.isArray(j?.categories) ? norm(j) : null; } catch { return null; } }
function pdfDbLoad() {
  const base = { current: normPdfCfg(null), history: [], errors: [] };
  try {
    const db = JSON.parse(localStorage.getItem(CK_PDF_DB) || "null");
    if (!db || typeof db !== "object") return base;
    const history = Array.isArray(db.history) ? db.history.slice(-30) : [];
    const errors = Array.isArray(db.errors) ? db.errors.slice(-30) : [];
    return { current: normPdfCfg(db.current), history, errors };
  } catch {
    return base;
  }
}

async function pdfDbInitFromFile() {
  try {
    if (localStorage.getItem(CK_PDF_DB)) return;
    const res = await fetch(`${PDF_DB_FILE}?v=1`, { cache: "no-store" });
    if (!res.ok) return;
    const raw = await res.json();
    const seed = {
      current: normPdfCfg(raw?.current),
      history: Array.isArray(raw?.history) ? raw.history.slice(-30) : [],
      errors: []
    };
    pdfDbWrite(seed);
  } catch {}
}

function pdfDbWrite(db) {
  try {
    localStorage.setItem(CK_PDF_DB, JSON.stringify(db));
    localStorage.setItem(CK_PDF, JSON.stringify(normPdfCfg(db.current)));
  } catch {}
}

function pdfDbUpsert(cfg, source = "manual") {
  const db = pdfDbLoad();
  db.current = normPdfCfg(cfg);
  db.history.push({ at: Date.now(), source, cfg: db.current });
  db.history = db.history.slice(-30);
  pdfDbWrite(db);
}

function pdfDbLogError(context, err) {
  const db = pdfDbLoad();
  db.errors.push({
    at: Date.now(),
    context: String(context || "unknown"),
    message: String(err?.message || err || "erro")
  });
  db.errors = db.errors.slice(-30);
  pdfDbWrite(db);
}

function pdfCfgLoad() {
  return pdfDbLoad().current;
}

async function fbInit() {
  if (S.db) return true;
  let cfg = null;
  try { if (typeof __firebase_config !== "undefined" && __firebase_config) cfg = JSON.parse(__firebase_config); } catch {}
  if (!cfg) return false;
  try {
    const app = initializeApp(cfg);
    S.db = getFirestore(app);
    S.auth = getAuth(app);
    return true;
  } catch { return false; }
}

async function fbAuth() {
  if (!S.auth) return false;
  try {
    if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) await signInWithCustomToken(S.auth, __initial_auth_token);
    else await signInAnonymously(S.auth);
    return true;
  } catch { return false; }
}

async function fbLoad() {
  if (!(await fbInit()) || !(await fbAuth())) return null;
  try {
    const s = await getDoc(doc(S.db, ...DOC));
    return s.exists() && Array.isArray(s.data()?.categories) ? norm(s.data()) : null;
  } catch { return null; }
}
async function fbSave(menu) {
  if (!(await fbInit()) || !(await fbAuth())) return false;
  try { await setDoc(doc(S.db, ...DOC), payload(menu), { merge: true }); return true; } catch (err) { pdfDbLogError("fbSave", err); return false; }
}

function fbWatch() {
  if (!S.db) return;
  if (S.unsub) S.unsub();
  S.unsub = onSnapshot(doc(S.db, ...DOC), (snap) => {
    if (!snap.exists() || !Array.isArray(snap.data()?.categories)) return;
    S.menu = norm(snap.data());
    idx();
    render();
    cacheSave(S.menu);
  });
}

async function loadData() {
  const fm = await fbLoad();
  if (fm?.categories?.length) { S.menu = fm; cacheSave(fm); fbWatch(); t("Cardapio sincronizado do banco"); return; }
  const cm = cacheLoad();
  if (cm?.categories?.length) { S.menu = cm; return; }
  for (const p of ["./menu_bolo.json", "./menu_final_brisa.json", "./menu.json"]) {
    try {
      const res = await fetch(`${p}?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) continue;
      const json = norm(await res.json());
      if (json.categories.length) cacheSave(json);
      S.menu = json;
      return;
    } catch {}
  }
  S.menu = { categories: [] };
}

function applyPdfCfgOnMenu() {
  if (!S.menu || !S.menu.settings) return;
  const p = pdfDbLoad().current;
  S.menu.settings.pdf = normPdfCfg({ ...S.menu.settings.pdf, ...p });
}

function admCfg() {
  const u = String(typeof window.__admin_user === "string" ? window.__admin_user : "admin").trim() || "admin";
  const h1 = String(typeof window.__admin_hash === "string" ? window.__admin_hash : "").trim().toLowerCase();
  const h2 = String(localStorage.getItem("bololoko_admin_hash") || "").trim().toLowerCase();
  return { user: u, hash: h1 || h2 };
}

async function sha(txt) {
  if (!crypto?.subtle) return "";
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(txt || "")));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function cteq(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}

function admSet() { S.admin = true; sessionStorage.setItem(CK_ADM, JSON.stringify({ exp: Date.now() + ADM_TTL })); }
function admClear() { S.admin = false; S.draft = null; sessionStorage.removeItem(CK_ADM); render(); }
function admRestore() {
  try {
    const j = JSON.parse(sessionStorage.getItem(CK_ADM) || "null");
    S.admin = Boolean(j && Number.isFinite(j.exp) && j.exp > Date.now());
    if (!S.admin) sessionStorage.removeItem(CK_ADM);
  } catch { S.admin = false; }
}

function openAdmLogin() {
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Acesso Administrativo</h3><button class="modal-close ui-btn adm-top-btn" type="button" aria-label="Fechar" onclick="closeModal()">Fechar</button></div><div class="modal-body admin-body no-image"><section class="admin-section auth-panel"><h4>Autenticação</h4><div class="auth-stack"><label class="adm-auth-row"><span>Usuário:</span><input id="admUser" type="text" autocomplete="username" placeholder="Digite o usuário"></label><label class="adm-auth-row"><span>Senha:</span><input id="admPass" type="password" autocomplete="current-password" placeholder="Digite a senha"></label></div><button id="admLoginBtn" class="ui-btn ui-btn-primary adm-center-btn" type="button"><span class="adm-btn-icon" aria-hidden="true">OK</span><span>Entrar</span></button></section></div>`;
  admOpen(false);
}

function draftCats() { return Array.isArray(S.draft?.categories) ? S.draft.categories : []; }
function draftFind(id) { for (const c of draftCats()) { const i = (c.items || []).find((x) => x.id === id); if (i) return { c, i }; } return null; }
function draftSettings() {
  S.draft.settings = normSettings(S.draft?.settings);
  return S.draft.settings;
}

function draftAllItems() {
  return draftCats().flatMap((c) => (c.items || []).map((i) => ({ catId: c.id, catName: c.name, item: i })));
}

function themePreset(sc) {
  const v = Number(sc);
  if (v <= 0.8) return "muito_pequeno";
  if (v <= 0.92) return "pequeno";
  if (v <= 1.08) return "normal";
  if (v <= 1.24) return "grande";
  if (v <= 1.36) return "muito_grande";
  return "extra_grande";
}

function sidebarTab(id, label) {
  const active = S.admTab === id ? "is-active" : "";
  const ico = id === "tema" ? "TH" : (id === "produtos" ? "PR" : "ED");
  return `<button class="adm-tab ui-btn ${active}" data-tab="${id}" type="button"><span class="adm-tab-icon" aria-hidden="true">${ico}</span><span>${label}</span></button>`;
}

function themeTabHtml(st) {
  return `<section class="admin-section"><h4>Tema da tela</h4><div class="admin-grid"><label class="admin-field"><span>Tamanho dos titulos</span><select id="admTitlePreset"><option value="muito_pequeno" ${themePreset(st.titleScale) === "muito_pequeno" ? "selected" : ""}>Muito pequeno</option><option value="pequeno" ${themePreset(st.titleScale) === "pequeno" ? "selected" : ""}>Pequeno</option><option value="normal" ${themePreset(st.titleScale) === "normal" ? "selected" : ""}>Normal</option><option value="grande" ${themePreset(st.titleScale) === "grande" ? "selected" : ""}>Grande</option><option value="muito_grande" ${themePreset(st.titleScale) === "muito_grande" ? "selected" : ""}>Muito grande</option><option value="extra_grande" ${themePreset(st.titleScale) === "extra_grande" ? "selected" : ""}>Extra grande</option></select></label><label class="admin-field"><span>Tamanho dos textos</span><select id="admTextPreset"><option value="muito_pequeno" ${themePreset(st.baseScale) === "muito_pequeno" ? "selected" : ""}>Muito pequeno</option><option value="pequeno" ${themePreset(st.baseScale) === "pequeno" ? "selected" : ""}>Pequeno</option><option value="normal" ${themePreset(st.baseScale) === "normal" ? "selected" : ""}>Normal</option><option value="grande" ${themePreset(st.baseScale) === "grande" ? "selected" : ""}>Grande</option><option value="muito_grande" ${themePreset(st.baseScale) === "muito_grande" ? "selected" : ""}>Muito grande</option><option value="extra_grande" ${themePreset(st.baseScale) === "extra_grande" ? "selected" : ""}>Extra grande</option></select></label><label class="admin-field"><span>Fonte principal</span><select id="admFontMain"><option value="Barlow Condensed" ${st.fontMain === "Barlow Condensed" ? "selected" : ""}>Barlow Condensed</option><option value="Montserrat" ${st.fontMain === "Montserrat" ? "selected" : ""}>Montserrat</option><option value="Poppins" ${st.fontMain === "Poppins" ? "selected" : ""}>Poppins</option><option value="Rajdhani" ${st.fontMain === "Rajdhani" ? "selected" : ""}>Rajdhani</option><option value="Exo 2" ${st.fontMain === "Exo 2" ? "selected" : ""}>Exo 2</option><option value="Saira Condensed" ${st.fontMain === "Saira Condensed" ? "selected" : ""}>Saira Condensed</option><option value="Kanit" ${st.fontMain === "Kanit" ? "selected" : ""}>Kanit</option><option value="Rubik" ${st.fontMain === "Rubik" ? "selected" : ""}>Rubik</option><option value="Roboto Condensed" ${st.fontMain === "Roboto Condensed" ? "selected" : ""}>Roboto Condensed</option><option value="Archivo Narrow" ${st.fontMain === "Archivo Narrow" ? "selected" : ""}>Archivo Narrow</option></select></label><label class="admin-field"><span>Fonte titulos</span><select id="admFontDisplay"><option value="Teko" ${st.fontDisplay === "Teko" ? "selected" : ""}>Teko</option><option value="Bebas Neue" ${st.fontDisplay === "Bebas Neue" ? "selected" : ""}>Bebas Neue</option><option value="Oswald" ${st.fontDisplay === "Oswald" ? "selected" : ""}>Oswald</option><option value="Anton" ${st.fontDisplay === "Anton" ? "selected" : ""}>Anton</option><option value="Bungee" ${st.fontDisplay === "Bungee" ? "selected" : ""}>Bungee</option><option value="Fjalla One" ${st.fontDisplay === "Fjalla One" ? "selected" : ""}>Fjalla One</option><option value="Rajdhani" ${st.fontDisplay === "Rajdhani" ? "selected" : ""}>Rajdhani</option><option value="Saira Condensed" ${st.fontDisplay === "Saira Condensed" ? "selected" : ""}>Saira Condensed</option><option value="Kanit" ${st.fontDisplay === "Kanit" ? "selected" : ""}>Kanit</option><option value="Exo 2" ${st.fontDisplay === "Exo 2" ? "selected" : ""}>Exo 2</option></select></label><label class="admin-field color-field"><span>Cor fundo</span><input id="admBg" type="color" value="${h(st.bg)}"></label><label class="admin-field color-field"><span>Cor superficie</span><input id="admSurface" type="color" value="${h(st.surface)}"></label><label class="admin-field color-field"><span>Cor destaque 1</span><input id="admAccent" type="color" value="${h(st.accent)}"></label><label class="admin-field color-field"><span>Cor destaque 2</span><input id="admAccent2" type="color" value="${h(st.accent2)}"></label><label class="admin-field color-field"><span>Cor do texto</span><input id="admText" type="color" value="${h(st.text)}"></label><label class="admin-field color-field"><span>Cor texto secundario</span><input id="admTextMuted" type="color" value="${h(st.textMuted)}"></label><label class="admin-field"><span>Tamanho da imagem destaque</span><input id="admHiThumb" type="range" min="84" max="180" step="2" value="${Number(st.highlightThumbH)}"><small id="admHiThumbVal">${Number(st.highlightThumbH)}px</small></label><label class="admin-field"><span>Tamanho da imagem produto</span><input id="admItemThumb" type="range" min="48" max="120" step="2" value="${Number(st.itemThumbSize)}"><small id="admItemThumbVal">${Number(st.itemThumbSize)}px</small></label></div><div id="admThemePreview" class="adm-theme-preview"></div></section>`;
}

function productsTabHtml(cats) {
  const opts = cats.map((c) => `<option value="${h(c.id)}">${h(c.name)}</option>`).join("");
  return `<section class="admin-section"><h4>Categorias e produtos</h4><div class="admin-grid"><label class="admin-field"><span>Nova categoria</span><input id="admNewCatName" type="text" maxlength="60" placeholder="Ex.: Promocoes"></label><button id="admAddCatBtn" class="ui-btn ui-btn-primary adm-add-cat-btn" type="button">Adicionar categoria</button></div></section><section class="admin-section"><h4>Adicionar produto</h4><div class="admin-grid"><label class="admin-field"><span>Categoria</span><select id="admCat">${opts}</select></label><label class="admin-field"><span>Nome</span><input id="admName" type="text" maxlength="90" placeholder="Ex.: Morangoloko"></label><label class="admin-field"><span>Preco</span><input id="admPrice" type="text" inputmode="decimal" placeholder="10,00"></label><label class="admin-field admin-field-full"><span>Descricao</span><input id="admDesc" type="text" maxlength="220" placeholder="Detalhes do produto"></label><label class="admin-field"><span>Tamanho da imagem (%)</span><input id="admImageSize" type="range" min="70" max="160" step="2" value="100"><small id="admImageSizeVal">100%</small></label><label class="admin-field"><span>Zoom da imagem</span><input id="admImageZoom" type="range" min="0.45" max="2.8" step="0.05" value="1"><small id="admImageZoomVal">1.00x</small></label><div id="admDropZone" class="admin-dropzone admin-field-full" role="button" tabindex="0">Arraste a imagem aqui</div></div><button id="admAddBtn" class="ui-btn ui-btn-primary adm-center-btn" type="button">Adicionar produto</button></section>`;
}

function editTabHtml() {
  const items = draftAllItems();
  if (!items.length) return '<section class="admin-section"><h4>Editar produtos</h4><div class="empty-state">Nenhum produto cadastrado.</div></section>';
  if (!S.admEditId || !items.find((x) => x.item.id === S.admEditId)) S.admEditId = items[0].item.id;
  const f = draftFind(S.admEditId);
  if (!f) return '<section class="admin-section"><h4>Editar produtos</h4><div class="empty-state">Produto não encontrado.</div></section>';
  const catOpts = draftCats().map((c) => `<option value="${h(c.id)}" ${c.id === f.c.id ? "selected" : ""}>${h(c.name)}</option>`).join("");
  const itemOpts = items.map((x) => `<option value="${h(x.item.id)}" ${x.item.id === f.i.id ? "selected" : ""}>${h(x.item.name)} (${h(x.catName)})</option>`).join("");
  const psrc = h(f.i.image || "");
  const isz = Math.min(160, Math.max(70, Number(f.i.imageSize) || 100));
  const izm = Math.min(2.8, Math.max(0.45, Number(f.i.imageZoom) || 1));
  return `<section class="admin-section"><h4>Editar produtos</h4><div class="admin-grid"><label class="admin-field admin-field-full"><span>Selecione o produto</span><select id="admEditSelect">${itemOpts}</select></label><label class="admin-field"><span>Nome</span><input id="admEditName" type="text" maxlength="90" value="${h(f.i.name)}"></label><label class="admin-field"><span>Preco</span><input id="admEditPrice" type="text" inputmode="decimal" value="${Number(f.i.price || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"></label><label class="admin-field admin-field-full"><span>Descricao</span><input id="admEditDesc" type="text" maxlength="220" value="${h(f.i.desc || "")}"></label><label class="admin-field"><span>Categoria</span><select id="admEditCat">${catOpts}</select></label><label class="admin-field"><span>Status</span><select id="admEditAvail"><option value="1" ${f.i.available !== false ? "selected" : ""}>Ativo</option><option value="0" ${f.i.available === false ? "selected" : ""}>Inativo (oculto do cliente)</option></select></label><label class="admin-field"><span>Tamanho da imagem (%)</span><input id="admEditImageSize" type="range" min="70" max="160" step="2" value="${Math.round(isz)}"><small id="admEditImageSizeVal">${Math.round(isz)}%</small></label><label class="admin-field"><span>Zoom da imagem</span><input id="admEditImageZoom" type="range" min="0.45" max="2.8" step="0.05" value="${izm.toFixed(2)}"><small id="admEditImageZoomVal">${izm.toFixed(2)}x</small></label><div id="admEditDropZone" class="admin-dropzone admin-field-full" role="button" tabindex="0">Arraste nova imagem aqui</div><div id="admEditCardPreview" class="adm-mini-card admin-field-full"><strong>${h(f.i.name)}</strong><p>${h(f.i.desc || "Sem descricao")}</p><span>${brl(f.i.price)}</span></div></div><div class="admin-actions"><button id="admApplyEditBtn" class="ui-btn ui-btn-primary adm-center-btn" type="button">Aplicar edicao</button><button class="ui-btn ui-btn-danger adm-center-btn adm-del-btn" data-id="${h(f.i.id)}" type="button">Remover produto</button></div></section>`;
}

function renderThemePreview(settings) {
  const box = document.getElementById("admThemePreview");
  if (!box) return;
  const s = normSettings(settings);
  box.innerHTML = `<div class="adm-theme-canvas" style="--pv-bg:${s.bg};--pv-surface:${s.surface};--pv-text:${s.text};--pv-muted:${s.textMuted};--pv-a:${s.accent};--pv-b:${s.accent2};font-family:'${s.fontMain}',sans-serif;"><div class="adm-theme-top" style="font-family:'${s.fontDisplay}',sans-serif;transform:scale(${s.titleScale});transform-origin:left center;">BOLOLOKO</div><div class="adm-theme-line">Cardapio digital em tempo real</div><div class="adm-theme-cards"><article class="adm-theme-card"><h5 style="font-family:'${s.fontDisplay}',sans-serif;transform:scale(${s.titleScale});transform-origin:left center;">Destaque</h5><p style="font-size:calc(0.92rem * ${s.baseScale});">Mini previsao da tela principal.</p><span>R$ 10,00</span></article><article class="adm-theme-card"><h5 style="font-family:'${s.fontDisplay}',sans-serif;transform:scale(${s.titleScale});transform-origin:left center;">Produto</h5><p style="font-size:calc(0.92rem * ${s.baseScale});">Texto, cores e fontes aplicados.</p><span>Ver detalhes</span></article></div></div>`;
}

function openPdfConfig() {
  const p = normPdfCfg((S.draft?.settings || S.menu.settings || {}).pdf);
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Configurar PDF</h3><div class="adm-header-actions"><button id="admPdfPrintBtn" class="ui-btn ui-btn-primary adm-top-btn" type="button">Gerar PDF</button><button id="admPdfSaveBtn" class="ui-btn ui-btn-primary adm-top-btn" type="button">Salvar</button><button class="modal-close ui-btn adm-top-btn" type="button" aria-label="Fechar" onclick="closeModal()">Fechar</button></div></div><div class="modal-body admin-body no-image"><section class="admin-section"><h4>Layout e conteúdo</h4><div class="admin-grid"><label class="admin-field"><span>Título</span><input id="pdfTitle" type="text" maxlength="70" value="${h(p.title)}"></label><label class="admin-field"><span>Subtítulo</span><input id="pdfSubtitle" type="text" maxlength="120" value="${h(p.subtitle)}"></label><label class="admin-field"><span>Orientação</span><select id="pdfOrientation"><option value="portrait" ${p.orientation === "portrait" ? "selected" : ""}>Vertical</option><option value="landscape" ${p.orientation === "landscape" ? "selected" : ""}>Horizontal</option></select></label><label class="admin-field"><span>Tamanho da página</span><select id="pdfPageSize"><option value="A4" ${p.pageSize === "A4" ? "selected" : ""}>A4</option><option value="A5" ${p.pageSize === "A5" ? "selected" : ""}>A5</option><option value="Letter" ${p.pageSize === "Letter" ? "selected" : ""}>Letter</option></select></label><label class="admin-field"><span>Alinhamento</span><select id="pdfAlign"><option value="left" ${p.align === "left" ? "selected" : ""}>Esquerda</option><option value="center" ${p.align === "center" ? "selected" : ""}>Centralizado</option></select></label><label class="admin-field"><span>Fonte</span><select id="pdfFont"><option value="Arial" ${p.font === "Arial" ? "selected" : ""}>Arial</option><option value="Georgia" ${p.font === "Georgia" ? "selected" : ""}>Georgia</option><option value="Times New Roman" ${p.font === "Times New Roman" ? "selected" : ""}>Times New Roman</option><option value="Verdana" ${p.font === "Verdana" ? "selected" : ""}>Verdana</option><option value="Montserrat" ${p.font === "Montserrat" ? "selected" : ""}>Montserrat</option></select></label><label class="admin-field"><span>Caminho da logo</span><input id="pdfLogoPath" type="text" value="${h(p.logoPath)}" placeholder="./logo.png"></label><label class="admin-field"><span>Estilo dos produtos</span><select id="pdfLayoutMode"><option value="cards" ${p.layoutMode === "cards" ? "selected" : ""}>Cards com imagem</option><option value="lista" ${p.layoutMode === "lista" ? "selected" : ""}>Lista clássica</option></select></label><label class="admin-field"><span>Densidade</span><select id="pdfDensity"><option value="compacta" ${p.density === "compacta" ? "selected" : ""}>Compacta</option><option value="normal" ${p.density === "normal" ? "selected" : ""}>Normal</option><option value="espacada" ${p.density === "espacada" ? "selected" : ""}>Espaçada</option></select></label><label class="admin-field"><span>Logo</span><select id="pdfShowLogo"><option value="1" ${p.showLogo ? "selected" : ""}>Mostrar</option><option value="0" ${!p.showLogo ? "selected" : ""}>Ocultar</option></select></label><label class="admin-field"><span>Imagens dos produtos</span><select id="pdfShowImages"><option value="1" ${p.showImages ? "selected" : ""}>Mostrar</option><option value="0" ${!p.showImages ? "selected" : ""}>Ocultar</option></select></label><label class="admin-field color-field"><span>Cor do texto</span><input id="pdfTextColor" type="color" value="${h(p.colorText)}"></label><label class="admin-field color-field"><span>Cor de destaque</span><input id="pdfAccentColor" type="color" value="${h(p.colorAccent)}"></label><label class="admin-field color-field"><span>Cor de fundo</span><input id="pdfBgColor" type="color" value="${h(p.colorBg)}"></label><label class="admin-field admin-field-full"><span>Descrição</span><select id="pdfShowDesc"><option value="1" ${p.showDesc ? "selected" : ""}>Mostrar</option><option value="0" ${!p.showDesc ? "selected" : ""}>Ocultar</option></select></label><label class="admin-field admin-field-full"><span>Preço</span><select id="pdfShowPrice"><option value="1" ${p.showPrice ? "selected" : ""}>Mostrar</option><option value="0" ${!p.showPrice ? "selected" : ""}>Ocultar</option></select></label></div></section></div>`;
  admOpen(true);
}

function pdfCfgFromInputs() {
  return normPdfCfg({
    title: document.getElementById("pdfTitle")?.value,
    subtitle: document.getElementById("pdfSubtitle")?.value,
    orientation: document.getElementById("pdfOrientation")?.value,
    pageSize: document.getElementById("pdfPageSize")?.value,
    align: document.getElementById("pdfAlign")?.value,
    font: document.getElementById("pdfFont")?.value,
    logoPath: document.getElementById("pdfLogoPath")?.value,
    layoutMode: document.getElementById("pdfLayoutMode")?.value,
    density: document.getElementById("pdfDensity")?.value,
    showLogo: String(document.getElementById("pdfShowLogo")?.value || "1") === "1",
    showImages: String(document.getElementById("pdfShowImages")?.value || "1") === "1",
    colorText: document.getElementById("pdfTextColor")?.value,
    colorAccent: document.getElementById("pdfAccentColor")?.value,
    colorBg: document.getElementById("pdfBgColor")?.value,
    showDesc: String(document.getElementById("pdfShowDesc")?.value || "1") === "1",
    showPrice: String(document.getElementById("pdfShowPrice")?.value || "1") === "1"
  });
}

function admOpen(full = false) {
  r.overlay.classList.add("active");
  r.overlay.classList.toggle("admin-overlay", Boolean(full));
  r.overlay.setAttribute("aria-hidden", "false");
  if (full) r.modal.classList.add("admin-full");
  document.body.style.overflow = "hidden";
}

function openAdmPanel() {
  S.draft = clone(payload(S.menu));
  S.admImageData = "";
  S.admEditImageData = "";
  S.admTab = "tema";
  S.admEditId = draftAllItems()[0]?.item?.id || "";
  drawAdmPanel();
  admOpen(true);
}

function drawAdmPanel() {
  const cats = draftCats();
  const st = draftSettings();
  const content = S.admTab === "tema" ? themeTabHtml(st) : (S.admTab === "produtos" ? productsTabHtml(cats) : editTabHtml());
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Painel ADM</h3><div class="adm-header-actions"><button id="admPdfCfgBtn" class="ui-btn ui-btn-primary adm-top-btn" type="button"><span class="adm-btn-icon" aria-hidden="true">CFG</span><span>PDF</span></button><button id="admSaveTopBtn" class="ui-btn ui-btn-primary adm-top-btn" type="button"><span class="adm-btn-icon" aria-hidden="true">OK</span><span>Salvar</span></button><button class="modal-close ui-btn adm-top-btn" type="button" aria-label="Fechar" onclick="closeModal()">Fechar</button></div></div><div class="modal-body admin-body no-image"><div class="adm-shell"><aside class="adm-side">${sidebarTab("tema", "Tema da tela")}${sidebarTab("produtos", "Produtos")}${sidebarTab("editar", "Editar")}</aside><section class="adm-content">${content}</section></div></div>`;
  if (S.admTab === "tema") renderThemePreview(st);
  if (S.admTab === "editar") {
    updateEditMiniPreview();
  }
}

function openAdm() {
  const cfg = admCfg();
  if (!cfg.hash) { t("ADM indisponivel: configure __admin_hash"); return; }
  if (S.admin) openAdmPanel(); else openAdmLogin();
}

async function readImageFile(file) {
  if (!file || !/^image\//.test(file.type)) return "";
  if (file.size > 2.5 * 1024 * 1024) {
    t("Imagem muito grande. Use ate 2.5MB");
    return "";
  }
  return await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : "");
    fr.onerror = () => resolve("");
    fr.readAsDataURL(file);
  });
}

function updateEditMiniPreview() {
  const card = document.getElementById("admEditCardPreview");
  if (!card) return;
  const name = String(document.getElementById("admEditName")?.value || "Produto");
  const desc = String(document.getElementById("admEditDesc")?.value || "Sem descrição");
  const price = priceNum(document.getElementById("admEditPrice")?.value || 0);
  const on = String(document.getElementById("admEditAvail")?.value || "1") === "1";
  const size = Math.round(Number(document.getElementById("admEditImageSize")?.value || 100));
  const zoom = Number(document.getElementById("admEditImageZoom")?.value || 1).toFixed(2);
  card.innerHTML = `<strong>${h(name)}</strong><p>${h(desc)}</p><span>${brl(price)}</span><small>${on ? "Ativo" : "Inativo (oculto do cliente)"}</small><small>Imagem: ${size}% · Zoom: ${zoom}x</small>`;
}

function admThemeFromInputs() {
  const base = draftSettings();
  const pScale = (v) => {
    if (v === "muito_pequeno") return 0.78;
    if (v === "pequeno") return 0.9;
    if (v === "grande") return 1.12;
    if (v === "muito_grande") return 1.24;
    if (v === "extra_grande") return 1.38;
    return 1;
  };
  const pick = (id, fallback) => {
    const el = document.getElementById(id);
    return String(el ? el.value : fallback);
  };
  return normSettings({
    fontMain: pick("admFontMain", base.fontMain),
    fontDisplay: pick("admFontDisplay", base.fontDisplay),
    baseScale: pScale(pick("admTextPreset", themePreset(base.baseScale))),
    titleScale: pScale(pick("admTitlePreset", themePreset(base.titleScale))),
    highlightThumbH: Number(document.getElementById("admHiThumb")?.value || base.highlightThumbH),
    itemThumbSize: Number(document.getElementById("admItemThumb")?.value || base.itemThumbSize),
    accent: pick("admAccent", base.accent),
    accent2: pick("admAccent2", base.accent2),
    bg: pick("admBg", base.bg),
    surface: pick("admSurface", base.surface),
    text: pick("admText", base.text),
    textMuted: pick("admTextMuted", base.textMuted),
    pdf: normPdfCfg(base.pdf)
  });
}

window.closeModal = function () {
  r.overlay.classList.remove("active");
  r.overlay.classList.remove("admin-overlay");
  r.overlay.setAttribute("aria-hidden", "true");
  r.modal.classList.remove("admin-full");
  r.modal.innerHTML = "";
  S.admImageData = "";
  applyTheme(S.menu.settings);
  document.body.style.overflow = "";
};
r.overlay.addEventListener("click", (e) => { if (e.target === r.overlay) window.closeModal(); });
r.search.addEventListener("input", () => { S.q = n(r.search.value); render(); });
r.list.addEventListener("click", (e) => { const c = e.target.closest(".item-card"); if (c) openItem(S.items.get(c.dataset.id)); });
r.list.addEventListener("keydown", (e) => { const c = e.target.closest(".item-card"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(S.items.get(c.dataset.id)); } });
r.hi.addEventListener("click", (e) => { const c = e.target.closest(".highlight-card"); if (c) openItem(S.items.get(c.dataset.id)); });
window.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); openAdm(); } });
if (r.logo) r.logo.addEventListener("click", () => { S.taps += 1; clearTimeout(S.tapTimer); S.tapTimer = setTimeout(() => (S.taps = 0), 2400); if (S.taps >= 5) { S.taps = 0; openAdm(); } });

r.modal.addEventListener("click", async (e) => {
  const tab = e.target.closest(".adm-tab");
  if (tab) {
    S.admTab = String(tab.dataset.tab || "tema");
    drawAdmPanel();
    applyTheme(S.draft?.settings || S.menu.settings);
    return;
  }

  if (e.target.closest("#admLoginBtn")) {
    const cfg = admCfg();
    const user = String(document.getElementById("admUser")?.value || "").trim();
    const pass = String(document.getElementById("admPass")?.value || "");
    const dg = await sha(pass);
    if (!user || !pass) return t("Informe usuário e senha");
    if (!dg) return t("Navegador sem suporte de segurança");
    if (!cteq(user, cfg.user) || !cteq(dg, cfg.hash)) return t("Credenciais inválidas");
    admSet();
    window.closeModal();
    if (PAGE_MODE === "pdf") openPdfConfig();
    else openAdmPanel();
    return t("Sessão ADM ativa por 20 minutos");
  }

  if (e.target.closest("#admAddCatBtn")) {
    const name = String(document.getElementById("admNewCatName")?.value || "").trim();
    if (!name) return t("Digite o nome da categoria");
    const id = idFromName(name, "cat");
    draftCats().push({ id, name, items: [] });
    drawAdmPanel();
    applyTheme(S.draft.settings);
    return t("Categoria adicionada no rascunho");
  }

  if (e.target.closest("#admPdfCfgBtn")) {
    openPdfConfig();
    return;
  }

  if (e.target.closest("#admPdfSaveBtn")) {
    S.draft = S.draft && Array.isArray(S.draft.categories) ? S.draft : clone(payload(S.menu));
    S.draft.settings = normSettings(S.draft.settings);
    const cfg = pdfCfgFromInputs();
    S.draft.settings.pdf = cfg;
    pdfDbUpsert(cfg, "adm-save");
    S.menu = norm(S.draft);
    cacheSave(S.menu);
    const ok = await fbSave(S.menu);
    render();
    window.closeModal();
    openAdmPanel();
    return t(ok ? "Configuração de PDF salva" : "PDF salvo no cache local");
  }

  if (e.target.closest("#admPdfPrintBtn")) {
    S.draft = S.draft && Array.isArray(S.draft.categories) ? S.draft : clone(payload(S.menu));
    S.draft.settings = normSettings(S.draft.settings);
    const cfg = pdfCfgFromInputs();
    S.draft.settings.pdf = cfg;
    pdfDbUpsert(cfg, "adm-print");
    try {
      await exportMenuPdf();
    } catch (err) {
      pdfDbLogError("pdfPrint", err);
      try {
        printMenuPdf();
      } catch {}
      t("Falha na exportação de PDF. Abrindo impressão padrão.");
    }
    return;
  }

  const delCat = e.target.closest(".admDelCat");
  if (delCat) {
    const id = String(delCat.dataset.id || "");
    S.draft.categories = draftCats().filter((x) => x.id !== id);
    if (S.tag === id) S.tag = "todos";
    drawAdmPanel();
    applyTheme(S.draft.settings);
    return t("Categoria removida no rascunho");
  }

  if (e.target.closest("#admAddBtn")) {
    const cat = String(document.getElementById("admCat")?.value || "");
    const name = String(document.getElementById("admName")?.value || "").trim();
    const price = priceNum(document.getElementById("admPrice")?.value || 0);
    const desc = String(document.getElementById("admDesc")?.value || "").trim();
    const image = S.admImageData;
    const imageSize = Math.round(Number(document.getElementById("admImageSize")?.value || 100));
    const imageZoom = Number(document.getElementById("admImageZoom")?.value || 1);
    if (!cat || !name || !Number.isFinite(price) || price < 0) return t("Preencha categoria, nome e preço válidos");
    const c = draftCats().find((x) => x.id === cat);
    if (!c) return t("Categoria não encontrada");
    c.items = Array.isArray(c.items) ? c.items : [];
    c.items.push({ id: idFromName(name), name, desc, image, imageSize, imageZoom, price, available: true });
    S.admImageData = "";
    drawAdmPanel();
    applyTheme(S.draft.settings);
    return t("Produto adicionado no rascunho");
  }

  if (e.target.closest("#admApplyEditBtn")) {
    const f = draftFind(S.admEditId);
    if (!f) return t("Produto não encontrado");
    const toCat = String(document.getElementById("admEditCat")?.value || f.c.id);
    const name = String(document.getElementById("admEditName")?.value || "").trim();
    const desc = String(document.getElementById("admEditDesc")?.value || "").trim();
    const price = priceNum(document.getElementById("admEditPrice")?.value || 0);
    const active = String(document.getElementById("admEditAvail")?.value || "1") === "1";
    const imageSize = Math.round(Number(document.getElementById("admEditImageSize")?.value || 100));
    const imageZoom = Number(document.getElementById("admEditImageZoom")?.value || 1);
    if (!name || !Number.isFinite(price) || price < 0) return t("Nome e preço inválidos");
    const target = draftCats().find((c) => c.id === toCat);
    if (!target) return t("Categoria de destino não encontrada");
    f.i.name = name;
    f.i.desc = desc;
    f.i.price = price;
    f.i.available = active;
    f.i.imageSize = imageSize;
    f.i.imageZoom = imageZoom;
    if (S.admEditImageData) f.i.image = S.admEditImageData;
    if (f.c.id !== toCat) {
      f.c.items = (f.c.items || []).filter((x) => x.id !== f.i.id);
      target.items = Array.isArray(target.items) ? target.items : [];
      target.items.push(f.i);
    }
    S.admEditImageData = "";
    drawAdmPanel();
    applyTheme(S.draft.settings);
    return t("Edição aplicada no rascunho");
  }

  const del = e.target.closest(".admDel");
  if (del) {
    const f = draftFind(del.dataset.id || "");
    if (!f) return;
    f.c.items = (f.c.items || []).filter((x) => x.id !== del.dataset.id);
    if (S.admEditId === del.dataset.id) S.admEditId = draftAllItems()[0]?.item?.id || "";
    drawAdmPanel();
    return t("Produto removido do rascunho");
  }

  if (e.target.closest("#admSaveTopBtn")) {
    S.draft.settings = admThemeFromInputs();
    S.menu = norm(S.draft || { categories: [] });
    idx();
    render();
    cacheSave(S.menu);
    const ok = await fbSave(S.menu);
    window.closeModal();
    return t(ok ? "Alterações salvas no banco e cache local" : "Sem banco. Alterações salvas no cache local");
  }

});

r.modal.addEventListener("input", (e) => {
  const p = e.target.closest(".admPrice");
  if (p) {
    const f = draftFind(p.dataset.id || "");
    if (!f) return;
    const v = Number(p.value || 0);
    f.i.price = Number.isFinite(v) && v >= 0 ? v : 0;
    return;
  }
  const a = e.target.closest(".admAvail");
  if (a) {
    const f = draftFind(a.dataset.id || "");
    if (f) f.i.available = Boolean(a.checked);
    return;
  }

  const tField = e.target.closest("#admFontMain, #admFontDisplay, #admTitlePreset, #admTextPreset, #admBg, #admSurface, #admAccent, #admAccent2, #admText, #admTextMuted, #admHiThumb, #admItemThumb");
  if (tField) {
    S.draft.settings = admThemeFromInputs();
    applyTheme(S.draft.settings);
    renderThemePreview(S.draft.settings);
    const hiVal = document.getElementById("admHiThumbVal");
    const itemVal = document.getElementById("admItemThumbVal");
    if (hiVal) hiVal.textContent = `${Math.round(Number(document.getElementById("admHiThumb")?.value || S.draft.settings.highlightThumbH))}px`;
    if (itemVal) itemVal.textContent = `${Math.round(Number(document.getElementById("admItemThumb")?.value || S.draft.settings.itemThumbSize))}px`;
  }

  if (e.target.closest("#admImageSize, #admImageZoom")) {
    const sv = document.getElementById("admImageSizeVal");
    const zv = document.getElementById("admImageZoomVal");
    if (sv) sv.textContent = `${Math.round(Number(document.getElementById("admImageSize")?.value || 100))}%`;
    if (zv) zv.textContent = `${Number(document.getElementById("admImageZoom")?.value || 1).toFixed(2)}x`;
  }

  if (e.target.closest("#admEditName, #admEditDesc, #admEditPrice, #admEditAvail, #admEditImageSize, #admEditImageZoom")) {
    const sv = document.getElementById("admEditImageSizeVal");
    const zv = document.getElementById("admEditImageZoomVal");
    if (sv) sv.textContent = `${Math.round(Number(document.getElementById("admEditImageSize")?.value || 100))}%`;
    if (zv) zv.textContent = `${Number(document.getElementById("admEditImageZoom")?.value || 1).toFixed(2)}x`;
    updateEditMiniPreview();
  }
});

r.modal.addEventListener("change", async (e) => {
  const sel = e.target.closest("#admEditSelect");
  if (sel) {
    S.admEditId = String(sel.value || "");
    drawAdmPanel();
    applyTheme(S.draft.settings);
  }
});

r.modal.addEventListener("focusout", (e) => {
  const p = e.target.closest("#admPrice, #admEditPrice");
  if (!p) return;
  p.value = priceMask(p.value);
});

r.modal.addEventListener("focusin", (e) => {
  const p = e.target.closest("#admPrice, #admEditPrice");
  if (!p) return;
  p.value = String(p.value || "").replace(/\./g, "").replace(",", ".");
});

r.modal.addEventListener("dragover", (e) => {
  if (!e.target.closest("#admDropZone, #admEditDropZone")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

r.modal.addEventListener("drop", async (e) => {
  const z = e.target.closest("#admDropZone");
  if (z) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    const src = await readImageFile(file);
    if (!src) return;
    S.admImageData = src;
    t("Imagem arrastada com sucesso");
    return;
  }

  const ze = e.target.closest("#admEditDropZone");
  if (ze) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    const src = await readImageFile(file);
    if (!src) return;
    S.admEditImageData = src;
    t("Imagem de edição carregada");
  }
});

setInterval(() => {
  if (!S.admin) return;
  try {
    const j = JSON.parse(sessionStorage.getItem(CK_ADM) || "null");
    if (!j || !Number.isFinite(j.exp) || j.exp <= Date.now()) { admClear(); t("Sessão ADM expirada"); }
  } catch { admClear(); }
}, 10000);

window.addEventListener("error", (ev) => {
  console.error("Erro visual:", ev?.error || ev?.message || ev);
});
window.addEventListener("unhandledrejection", (ev) => {
  console.error("Erro async:", ev?.reason || ev);
});
window.addEventListener("resize", (() => {
  let tm = 0;
  return () => {
    clearTimeout(tm);
    tm = setTimeout(() => renderHighlights(), 120);
  };
})());

(async function boot() {
  admRestore();
  await pdfDbInitFromFile();
  await loadData();
  applyPdfCfgOnMenu();
  if (!S.menu.categories.length) {
    r.hi.innerHTML = '<div class="empty-state">Não foi possível carregar o cardápio.</div>';
    r.list.innerHTML = '<div class="empty-state">Sem dados no Firebase, cache e JSON local.</div>';
    return t("Falha ao carregar cardápio");
  }
  idx();
  S.hiUpdatedAt = Date.now();
  render();
  if (PAGE_MODE === "auth") openAdmLogin();
  if (PAGE_MODE === "adm") openAdm();
  if (PAGE_MODE === "pdf") {
    if (S.admin) openPdfConfig();
    else openAdmLogin();
  }
  setInterval(tickHighlights, HIGHLIGHT_REFRESH_MS);
})();
