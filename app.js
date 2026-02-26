import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const r = {
  logo: document.getElementById("brandLogo"),
  search: document.getElementById("searchInput"),
  nav: document.getElementById("categoryNav"),
  hi: document.getElementById("highlightsTrack"),
  list: document.getElementById("menuList"),
  overlay: document.getElementById("modalOverlay"),
  modal: document.getElementById("modalContent"),
  toast: document.getElementById("toast")
};

const senha = "bololo@12";
const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(senha));
const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
console.log(hash);

const S = {
  menu: { categories: [] },
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
  tapTimer: null
};

const APP_ID = typeof __app_id !== "undefined" ? __app_id : "default-app";
const DOC = ["artifacts", APP_ID, "public", "data", "menu_store", "main"];
const CK_MENU = "bololoko_menu_cache_v2";
const CK_ADM = "bololoko_admin_session_v1";
const ADM_TTL = 20 * 60 * 1000;

function t(msg) { r.toast.textContent = msg; r.toast.classList.add("show"); setTimeout(() => r.toast.classList.remove("show"), 1800); }
function h(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function n(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
function brl(v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function norm(raw) {
  const cats = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    categories: cats.map((c, ci) => ({
      id: c?.id || `cat_${ci}_${Date.now().toString(36)}`,
      name: String(c?.name || `Secao ${ci + 1}`).trim(),
      items: (Array.isArray(c?.items) ? c.items : []).map((i, ii) => ({
        id: i?.id || `item_${ci}_${ii}`,
        name: String(i?.name || "Item").trim(),
        desc: String(i?.desc || "").trim(),
        image: String(i?.image || "").trim(),
        price: Number.isFinite(Number(i?.price)) ? Number(i.price) : 0,
        available: i?.available !== false
      }))
    }))
  };
}

function payload(menu) {
  return {
    categories: (menu.categories || []).map((c) => ({
      id: c.id,
      name: c.name,
      items: (c.items || []).map((i) => ({ id: i.id, name: i.name, desc: i.desc || "", image: i.image || "", price: Number(i.price) || 0, available: i.available !== false }))
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

function renderHighlights() {
  const arr = allItems();
  if (!arr.length) { r.hi.innerHTML = '<div class="empty-state">Sem sabores para destacar agora.</div>'; return; }
  r.hi.innerHTML = "";
  arr.slice(0, 8).forEach((i) => {
    const c = document.createElement("button");
    c.className = "highlight-card ui-btn";
    c.dataset.id = i.id;
    c.innerHTML = `<div class="highlight-thumb"><img alt="${h(i.name)}"></div><div class="highlight-content"><div class="highlight-name">${h(i.name)}</div><span class="highlight-price">${brl(i.price)}</span>${i.available === false ? '<span class="item-status item-status-off">Inativo</span>' : ""}</div>`;
    setImg(c.querySelector("img"), i, () => c.classList.add("no-image"));
    r.hi.appendChild(c);
  });
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
      setImg(a.querySelector("img"), i);
      wrap.appendChild(a);
    });
    r.list.appendChild(s);
  });
}

function openItem(i) {
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Detalhes do produto</h3><button class="modal-close ui-btn" type="button" aria-label="Fechar" onclick="closeModal()">x</button></div><div class="modal-body" id="mBody"><img id="mImg" class="modal-image" alt="Imagem do produto"><div class="modal-info"><h2 class="modal-name">${h(i.name)}</h2><p class="modal-desc">${h(i.desc || "Sem descricao adicional.")}</p><span class="modal-price">${brl(i.price)}</span></div></div>`;
  setImg(document.getElementById("mImg"), i, () => document.getElementById("mBody")?.classList.add("no-image"));
  r.overlay.classList.add("active");
  r.overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function render() { renderNav(); renderHighlights(); renderMenu(); }

function cacheSave(menu) { try { localStorage.setItem(CK_MENU, JSON.stringify(payload(menu))); } catch {} }
function cacheLoad() { try { const j = JSON.parse(localStorage.getItem(CK_MENU) || "null"); return Array.isArray(j?.categories) ? norm(j) : null; } catch { return null; } }

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
  try { await setDoc(doc(S.db, ...DOC), payload(menu), { merge: true }); return true; } catch { return false; }
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
  if (cm?.categories?.length) { S.menu = cm; t("Cardapio carregado do cache local"); return; }
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
  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Acesso administrativo</h3><button class="modal-close ui-btn" type="button" aria-label="Fechar" onclick="closeModal()">x</button></div><div class="modal-body admin-body no-image"><section class="admin-section"><h4>Autenticacao</h4><div class="admin-grid"><label class="admin-field"><span>Usuario</span><input id="admUser" type="text" autocomplete="username" placeholder="admin"></label><label class="admin-field"><span>Senha</span><input id="admPass" type="password" autocomplete="current-password" placeholder="Senha"></label></div><button id="admLoginBtn" class="ui-btn ui-btn-primary" type="button">Entrar</button></section></div>`;
  r.overlay.classList.add("active");
  r.overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function draftCats() { return Array.isArray(S.draft?.categories) ? S.draft.categories : []; }
function draftFind(id) { for (const c of draftCats()) { const i = (c.items || []).find((x) => x.id === id); if (i) return { c, i }; } return null; }

function openAdmPanel() { S.draft = clone(payload(S.menu)); drawAdmPanel(); r.overlay.classList.add("active"); r.overlay.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }

function drawAdmPanel() {
  const cats = draftCats();
  const opts = cats.map((c) => `<option value="${h(c.id)}">${h(c.name)}</option>`).join("");
  const rows = cats.map((c) => `<section class="admin-section"><h4>${h(c.name)}</h4>${(c.items || []).map((i) => `<div class="admin-row"><div class="admin-row-main"><strong>${h(i.name)}</strong><small>${h(i.id)}</small></div><label class="admin-field admin-inline"><span>R$</span><input class="admPrice" data-id="${h(i.id)}" type="number" min="0" step="0.01" value="${Number(i.price || 0).toFixed(2)}"></label><label class="admin-check"><input class="admAvail" data-id="${h(i.id)}" type="checkbox" ${i.available !== false ? "checked" : ""}>Ativo</label><button class="ui-btn ui-btn-danger admDel" data-id="${h(i.id)}" type="button">Remover</button></div>`).join("") || '<div class="empty-state">Sem itens nessa categoria.</div>'}</section>`).join("");

  r.modal.innerHTML = `<div class="modal-header"><h3 id="modalTitle" class="modal-title">Painel ADM seguro</h3><button class="modal-close ui-btn" type="button" aria-label="Fechar" onclick="closeModal()">x</button></div><div class="modal-body admin-body no-image"><section class="admin-section"><h4>JSON completo</h4><label class="admin-field admin-field-full"><span>Editor JSON</span><textarea id="admJson" rows="12" style="width:100%;border-radius:10px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;padding:10px;resize:vertical;">${h(JSON.stringify(S.draft, null, 2))}</textarea></label><button id="admApplyJson" class="ui-btn ui-btn-primary" type="button">Aplicar JSON</button></section><section class="admin-section"><h4>Adicionar produto</h4><div class="admin-grid"><label class="admin-field"><span>Categoria</span><select id="admCat">${opts}</select></label><label class="admin-field"><span>Nome</span><input id="admName" type="text" maxlength="90" placeholder="Ex.: Morangoloko"></label><label class="admin-field"><span>Preco</span><input id="admPrice" type="number" min="0" step="0.01" placeholder="10.00"></label><label class="admin-field admin-field-full"><span>Descricao</span><input id="admDesc" type="text" maxlength="220" placeholder="Detalhes do produto"></label><label class="admin-field admin-field-full"><span>Imagem (caminho)</span><input id="admImage" type="text" placeholder="images/novo_sabor.jpg"></label></div><button id="admAddBtn" class="ui-btn ui-btn-primary" type="button">Adicionar produto</button></section><section class="admin-section"><h4>Produtos cadastrados</h4>${rows}</section><section class="admin-section"><button id="admSaveBtn" class="ui-btn ui-btn-primary" type="button">Salvar alteracoes</button><button id="admLogoutBtn" class="ui-btn ui-btn-danger" type="button" style="margin-left:8px;">Encerrar sessao ADM</button></section></div>`;
}

function openAdm() {
  const cfg = admCfg();
  if (!cfg.hash) { t("ADM indisponivel: configure __admin_hash"); return; }
  if (S.admin) openAdmPanel(); else openAdmLogin();
}

window.closeModal = function () { r.overlay.classList.remove("active"); r.overlay.setAttribute("aria-hidden", "true"); r.modal.innerHTML = ""; document.body.style.overflow = ""; };
r.overlay.addEventListener("click", (e) => { if (e.target === r.overlay) window.closeModal(); });
r.search.addEventListener("input", () => { S.q = n(r.search.value); render(); });
r.list.addEventListener("click", (e) => { const c = e.target.closest(".item-card"); if (c) openItem(S.items.get(c.dataset.id)); });
r.list.addEventListener("keydown", (e) => { const c = e.target.closest(".item-card"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(S.items.get(c.dataset.id)); } });
r.hi.addEventListener("click", (e) => { const c = e.target.closest(".highlight-card"); if (c) openItem(S.items.get(c.dataset.id)); });
window.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); openAdm(); } });
if (r.logo) r.logo.addEventListener("click", () => { S.taps += 1; clearTimeout(S.tapTimer); S.tapTimer = setTimeout(() => (S.taps = 0), 2400); if (S.taps >= 5) { S.taps = 0; openAdm(); } });

r.modal.addEventListener("click", async (e) => {
  if (e.target.closest("#admLoginBtn")) {
    const cfg = admCfg();
    const user = String(document.getElementById("admUser")?.value || "").trim();
    const pass = String(document.getElementById("admPass")?.value || "");
    const dg = await sha(pass);
    if (!user || !pass) return t("Informe usuario e senha");
    if (!dg) return t("Navegador sem suporte de seguranca");
    if (!cteq(user, cfg.user) || !cteq(dg, cfg.hash)) return t("Credenciais invalidas");
    admSet();
    window.closeModal();
    openAdmPanel();
    return t("Sessao ADM ativa por 20 minutos");
  }

  if (e.target.closest("#admApplyJson")) {
    try { S.draft = payload(norm(JSON.parse(String(document.getElementById("admJson")?.value || "{}")))); drawAdmPanel(); t("JSON aplicado no rascunho"); } catch { t("JSON invalido"); }
    return;
  }

  if (e.target.closest("#admAddBtn")) {
    const cat = String(document.getElementById("admCat")?.value || "");
    const name = String(document.getElementById("admName")?.value || "").trim();
    const price = Number(document.getElementById("admPrice")?.value || 0);
    const desc = String(document.getElementById("admDesc")?.value || "").trim();
    const image = String(document.getElementById("admImage")?.value || "").trim();
    if (!cat || !name || !Number.isFinite(price) || price < 0) return t("Preencha categoria, nome e preco validos");
    const c = draftCats().find((x) => x.id === cat);
    if (!c) return t("Categoria nao encontrada");
    c.items = Array.isArray(c.items) ? c.items : [];
    c.items.push({ id: `${n(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${Date.now().toString(36)}`, name, desc, image, price, available: true });
    drawAdmPanel();
    return t("Produto adicionado no rascunho");
  }

  const del = e.target.closest(".admDel");
  if (del) {
    const f = draftFind(del.dataset.id || "");
    if (!f) return;
    f.c.items = (f.c.items || []).filter((x) => x.id !== del.dataset.id);
    drawAdmPanel();
    return t("Produto removido do rascunho");
  }

  if (e.target.closest("#admSaveBtn")) {
    S.menu = norm(S.draft || { categories: [] });
    idx();
    render();
    cacheSave(S.menu);
    const ok = await fbSave(S.menu);
    window.closeModal();
    return t(ok ? "Alteracoes salvas no banco e cache local" : "Sem banco. Alteracoes salvas no cache local");
  }

  if (e.target.closest("#admLogoutBtn")) { admClear(); window.closeModal(); t("Sessao ADM encerrada"); }
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
  }
});

setInterval(() => {
  if (!S.admin) return;
  try {
    const j = JSON.parse(sessionStorage.getItem(CK_ADM) || "null");
    if (!j || !Number.isFinite(j.exp) || j.exp <= Date.now()) { admClear(); t("Sessao ADM expirada"); }
  } catch { admClear(); }
}, 10000);

window.addEventListener("error", () => { try { render(); } catch {} t("Erro visual detectado"); });
window.addEventListener("unhandledrejection", () => t("Erro inesperado"));

(async function boot() {
  admRestore();
  await loadData();
  if (!S.menu.categories.length) {
    r.hi.innerHTML = '<div class="empty-state">Nao foi possivel carregar o cardapio.</div>';
    r.list.innerHTML = '<div class="empty-state">Sem dados no Firebase, cache e JSON local.</div>';
    return t("Falha ao carregar cardapio");
  }
  idx();
  render();
})();
