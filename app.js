import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const refs = {
  searchInput: document.getElementById("searchInput"),
  categoryNav: document.getElementById("categoryNav"),
  highlightsTrack: document.getElementById("highlightsTrack"),
  menuList: document.getElementById("menuList"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalContent: document.getElementById("modalContent"),
  toast: document.getElementById("toast")
};

const HIGHLIGHT_PAGE_SIZE = 8;
const HIGHLIGHT_ROTATE_MS = 60000;

const state = {
  menu: { categories: [] },
  search: "",
  tag: "todos",
  searchDebounce: null,
  imageCache: new Map(),
  itemsById: new Map(),
  highlightOffset: 0,
  highlightTimer: null
};

const appId = typeof __app_id !== "undefined" ? __app_id : "default-app";
const MENU_DOC_PATH = ["artifacts", appId, "public", "data", "menu_store", "main"];

let firebaseApp = null;
let firebaseDb = null;
let firebaseAuth = null;
let unsubscribeMenu = null;

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  window.setTimeout(() => refs.toast.classList.remove("show"), 1800);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function maybeFixEncoding(value) {
  if (typeof value !== "string") return value;
  if (!/[ÃÂâ�]/.test(value)) return value;
  try {
    return decodeURIComponent(escape(value));
  } catch (_e) {
    return value;
  }
}

function normalizeText(value) {
  const base = String(value || "").toLowerCase();
  if (typeof base.normalize === "function") {
    return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  return base.trim();
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function normalizeMenu(raw) {
  const root = raw && typeof raw === "object" ? raw : {};
  const categoriesIn = Array.isArray(root.categories) ? root.categories : [];

  return {
    categories: categoriesIn.map((cat, catIndex) => {
      const itemsIn = Array.isArray(cat && cat.items) ? cat.items : [];
      const name = maybeFixEncoding((cat && cat.name) || `Secao ${catIndex + 1}`).trim();
      const id = (cat && cat.id) || `cat_${catIndex}_${Date.now().toString(36)}`;

      return {
        id,
        name,
        items: itemsIn.map((item, itemIndex) => ({
          id: (item && item.id) || `item_${catIndex}_${itemIndex}`,
          name: maybeFixEncoding((item && item.name) || "Item").trim(),
          desc: maybeFixEncoding((item && item.desc) || "").trim(),
          image: String((item && item.image) || "").trim(),
          price: Number.isFinite(Number(item && item.price)) ? Number(item.price) : 0,
          available: item && item.available !== false,
          categoryName: name,
          categoryId: id
        }))
      };
    })
  };
}

function getItemImageCandidates(item) {
  const candidates = [];
  if (item.image) candidates.push(item.image);
  if (item.id) {
    candidates.push(`./images/${item.id}.jpg`);
    candidates.push(`./images/${item.id}.png`);
  }
  return candidates;
}

function setImageWithFallback(img, item, handlers = {}) {
  const onSuccess = typeof handlers.onSuccess === "function" ? handlers.onSuccess : () => {};
  const onFail = typeof handlers.onFail === "function" ? handlers.onFail : () => {};

  const cached = state.imageCache.get(item.id);
  if (cached === null) {
    img.style.display = "none";
    onFail();
    return;
  }
  if (typeof cached === "string") {
    img.src = cached;
    img.style.display = "block";
    onSuccess();
    return;
  }

  const candidates = getItemImageCandidates(item);
  if (!candidates.length) {
    img.style.display = "none";
    state.imageCache.set(item.id, null);
    onFail();
    return;
  }

  const tryAt = (idx) => {
    if (idx >= candidates.length) {
      img.style.display = "none";
      state.imageCache.set(item.id, null);
      onFail();
      return;
    }

    img.src = candidates[idx];
    img.onerror = () => tryAt(idx + 1);
    img.onload = () => {
      img.style.display = "block";
      state.imageCache.set(item.id, candidates[idx]);
      onSuccess();
    };
  };

  tryAt(0);
}

function getCategoryTags() {
  return [{ id: "todos", label: "Todos" }].concat(
    state.menu.categories.map((cat) => ({ id: cat.id, label: cat.name }))
  );
}

function categoryMatchesTag(category, tagId) {
  if (tagId === "todos") return true;
  return category.id === tagId;
}

function matchesSearch(item) {
  if (!state.search) return true;
  return item._searchKey.includes(state.search);
}

function isItemAvailable(item) {
  return item.available !== false;
}

function getVisibleItemsForCurrentFilter() {
  return state.menu.categories
    .filter((cat) => categoryMatchesTag(cat, state.tag))
    .flatMap((cat) => (Array.isArray(cat.items) ? cat.items : []))
    .filter((item) => matchesSearch(item) && isItemAvailable(item));
}

function getFilteredCategories() {
  const baseCategories = state.menu.categories.filter((cat) => categoryMatchesTag(cat, state.tag));

  return baseCategories
    .map((cat) => {
      const items = cat.items.filter((item) => matchesSearch(item) && isItemAvailable(item));
      return { ...cat, items };
    })
    .filter((cat) => cat.items.length > 0);
}

function renderCategoryNav() {
  refs.categoryNav.innerHTML = "";
  const frag = document.createDocumentFragment();

  getCategoryTags().forEach((tag) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${state.tag === tag.id ? "active" : ""}`;
    btn.textContent = tag.label;
    btn.addEventListener("click", () => {
      state.tag = state.tag === tag.id ? "todos" : tag.id;
      state.highlightOffset = 0;
      renderApp();
    });
    frag.appendChild(btn);
  });

  refs.categoryNav.appendChild(frag);
}

function getHighlightItems(pool) {
  if (!pool.length) return [];
  const start = state.highlightOffset % pool.length;
  const selected = [];

  for (let i = 0; i < Math.min(HIGHLIGHT_PAGE_SIZE, pool.length); i += 1) {
    selected.push(pool[(start + i) % pool.length]);
  }

  return selected;
}

function renderHighlights() {
  refs.highlightsTrack.innerHTML = "";

  const allItems = getVisibleItemsForCurrentFilter();
  if (!allItems.length) {
    refs.highlightsTrack.innerHTML = "<div class=\"empty-state\">Sem sabores para destacar agora.</div>";
    return;
  }

  const base = getHighlightItems(allItems);
  const frag = document.createDocumentFragment();

  base.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "highlight-card";
    card.dataset.itemId = item.id;

    const thumb = document.createElement("div");
    thumb.className = "highlight-thumb";
    const img = document.createElement("img");
    img.alt = item.name;
    img.loading = "lazy";
    img.decoding = "async";
    setImageWithFallback(img, item, {
      onSuccess: () => card.classList.remove("no-image"),
      onFail: () => card.classList.add("no-image")
    });
    thumb.appendChild(img);

    const content = document.createElement("div");
    content.className = "highlight-content";
    content.innerHTML = `
      <div class="highlight-name">${escapeHtml(item.name)}</div>
      <span class="highlight-price">${formatCurrency(item.price)}</span>
    `;

    card.appendChild(thumb);
    card.appendChild(content);
    frag.appendChild(card);
  });

  refs.highlightsTrack.appendChild(frag);
}

function renderMenu() {
  refs.menuList.innerHTML = "";
  const filteredCategories = getFilteredCategories();

  if (!filteredCategories.length) {
    refs.menuList.innerHTML = "<div class=\"empty-state\">Nenhum sabor encontrado com esses filtros.</div>";
    return;
  }

  const frag = document.createDocumentFragment();

  filteredCategories.forEach((cat) => {
    const section = document.createElement("section");
    section.className = "category-section";
    section.id = cat.id;

    section.innerHTML = `
      <header class="cat-header">
        <h3 class="cat-title">${escapeHtml(cat.name)}</h3>
        <span class="cat-count">${cat.items.length} sabores</span>
      </header>
    `;

    const list = document.createElement("div");
    list.className = "items-list";

    cat.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "item-card";
      card.dataset.itemId = item.id;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${item.name}, ${formatCurrency(item.price)}`);

      const thumb = document.createElement("div");
      thumb.className = "item-thumb";
      const img = document.createElement("img");
      img.alt = item.name;
      img.loading = "lazy";
      img.decoding = "async";
      setImageWithFallback(img, item);
      thumb.appendChild(img);

      const content = document.createElement("div");
      content.className = "item-content";
      content.innerHTML = `
        <h4 class="item-name">${escapeHtml(item.name)}</h4>
        ${item.desc ? `<p class="item-desc">${escapeHtml(item.desc)}</p>` : ""}
        <div class="item-bottom">
          <span class="item-price">${formatCurrency(item.price)}</span>
          <span class="item-cta">Ver detalhes</span>
        </div>
      `;

      card.appendChild(thumb);
      card.appendChild(content);
      list.appendChild(card);
    });

    section.appendChild(list);
    frag.appendChild(section);
  });

  refs.menuList.appendChild(frag);
}

function openItemModal(item) {
  refs.modalContent.innerHTML = `
    <div class="modal-header">
      <h3 id="modalTitle" class="modal-title">Detalhes do produto</h3>
      <button class="modal-close" type="button" aria-label="Fechar" onclick="closeModal()">x</button>
    </div>
    <div id="modalBody" class="modal-body">
      <img id="modalImg" class="modal-image" alt="Imagem do produto">
      <div class="modal-info">
        <h2 class="modal-name">${escapeHtml(item.name)}</h2>
        <p class="modal-desc">${escapeHtml(item.desc || "Sem descricao adicional.")}</p>
        <span class="modal-price">${formatCurrency(item.price)}</span>
      </div>
    </div>
  `;

  const modalImg = document.getElementById("modalImg");
  const modalBody = document.getElementById("modalBody");
  setImageWithFallback(modalImg, item, {
    onSuccess: () => modalBody.classList.remove("no-image"),
    onFail: () => modalBody.classList.add("no-image")
  });

  refs.modalOverlay.classList.add("active");
  refs.modalOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function openItemModalById(itemId) {
  if (!itemId) return;
  const item = state.itemsById.get(itemId);
  if (!item) return;
  openItemModal(item);
}

function startHighlightsRotation() {
  if (state.highlightTimer) {
    window.clearInterval(state.highlightTimer);
    state.highlightTimer = null;
  }

  state.highlightTimer = window.setInterval(() => {
    const pool = getVisibleItemsForCurrentFilter();
    if (pool.length <= HIGHLIGHT_PAGE_SIZE) return;
    state.highlightOffset = (state.highlightOffset + HIGHLIGHT_PAGE_SIZE) % pool.length;
    renderHighlights();
  }, HIGHLIGHT_ROTATE_MS);
}

window.closeModal = function closeModal() {
  refs.modalOverlay.classList.remove("active");
  refs.modalOverlay.setAttribute("aria-hidden", "true");
  refs.modalContent.innerHTML = "";
  document.body.style.overflow = "";
};

refs.modalOverlay.addEventListener("click", (event) => {
  if (event.target === refs.modalOverlay) window.closeModal();
});

refs.menuList.addEventListener("click", (event) => {
  const card = event.target.closest(".item-card");
  if (!card) return;
  openItemModalById(card.dataset.itemId);
});

refs.menuList.addEventListener("keydown", (event) => {
  const card = event.target.closest(".item-card");
  if (!card) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openItemModalById(card.dataset.itemId);
});

refs.highlightsTrack.addEventListener("click", (event) => {
  const card = event.target.closest(".highlight-card");
  if (!card) return;
  openItemModalById(card.dataset.itemId);
});

function buildItemIndexes() {
  state.itemsById.clear();
  state.imageCache.clear();
  state.menu.categories.forEach((cat) => {
    cat.items.forEach((item) => {
      item._searchKey = normalizeText(`${item.name} ${item.desc} ${cat.name}`);
      state.itemsById.set(item.id, item);
    });
  });
}

function renderApp() {
  renderCategoryNav();
  try {
    renderHighlights();
  } catch (_e) {
    refs.highlightsTrack.innerHTML = "<div class=\"empty-state\">Destaques indisponiveis.</div>";
  }
  renderMenu();
}

refs.searchInput.addEventListener("input", () => {
  clearTimeout(state.searchDebounce);
  state.searchDebounce = window.setTimeout(() => {
    state.search = normalizeText(refs.searchInput.value);
    state.highlightOffset = 0;
    renderMenu();
    renderHighlights();
  }, 120);
});

async function initFirebaseIfAvailable() {
  if (firebaseApp && firebaseDb) return true;

  let firebaseConfig = null;
  try {
    if (typeof __firebase_config !== "undefined" && __firebase_config) {
      firebaseConfig = JSON.parse(__firebase_config);
    }
  } catch (_e) {
    firebaseConfig = null;
  }

  if (!firebaseConfig) return false;

  try {
    firebaseApp = initializeApp(firebaseConfig);
    firebaseDb = getFirestore(firebaseApp);
    firebaseAuth = getAuth(firebaseApp);
    return true;
  } catch (_e) {
    firebaseApp = null;
    firebaseDb = null;
    firebaseAuth = null;
    return false;
  }
}

async function ensureFirebaseAuth() {
  if (!firebaseAuth) return false;

  try {
    if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
      await signInWithCustomToken(firebaseAuth, __initial_auth_token);
    } else {
      await signInAnonymously(firebaseAuth);
    }
    return true;
  } catch (_e) {
    return false;
  }
}

async function loadMenuFromFirebase() {
  const hasFirebase = await initFirebaseIfAvailable();
  if (!hasFirebase || !firebaseDb) return null;

  const authOk = await ensureFirebaseAuth();
  if (!authOk) return null;

  try {
    const ref = doc(firebaseDb, ...MENU_DOC_PATH);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const cloudData = snap.data();
    if (!cloudData || !Array.isArray(cloudData.categories)) return null;
    return normalizeMenu(cloudData);
  } catch (_e) {
    return null;
  }
}

function startRealtimeMenuSync() {
  if (!firebaseDb) return;
  if (unsubscribeMenu) unsubscribeMenu();

  const ref = doc(firebaseDb, ...MENU_DOC_PATH);
  unsubscribeMenu = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const cloudData = snap.data();
    if (!cloudData || !Array.isArray(cloudData.categories)) return;

    state.menu = normalizeMenu(cloudData);
    state.highlightOffset = 0;
    buildItemIndexes();
    renderApp();
  });
}

async function loadMenuData() {
  const firebaseMenu = await loadMenuFromFirebase();
  if (firebaseMenu && firebaseMenu.categories && firebaseMenu.categories.length) {
    startRealtimeMenuSync();
    showToast("Cardapio sincronizado do banco");
    return firebaseMenu;
  }

  const candidates = ["./menu_bolo.json", "./menu_final_brisa.json", "./menu.json"];

  for (const path of candidates) {
    try {
      const response = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) continue;
      const json = await response.json();
      return normalizeMenu(json);
    } catch (_e) {
      // try next file
    }
  }

  return { categories: [] };
}

(async function bootstrap() {
  state.menu = await loadMenuData();

  if (!state.menu.categories.length) {
    refs.highlightsTrack.innerHTML = "<div class=\"empty-state\">Nao foi possivel carregar o cardapio.</div>";
    refs.menuList.innerHTML = "<div class=\"empty-state\">Sem dados no Firebase e sem JSON local disponivel.</div>";
    showToast("Falha ao carregar cardapio");
    return;
  }

  buildItemIndexes();
  renderApp();
  startHighlightsRotation();
})();
