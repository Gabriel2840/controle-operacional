// =============================================================
//  Controle Operacional — Aura 360 (PWA offline-first)
//  Telas: Tanques (%), Bolas (bags/diâmetro), Floculante,
//         GLP (%), Histórico, Gráfico, Cadastros.
//  Firestore com cache offline: registra sem internet e
//  sincroniza sozinho ao reconectar. Login obrigatório.
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- Init ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Coleções
const COL = {
  tanques:     collection(db, "cad_tanques"),
  diametros:   collection(db, "cad_diametros"),
  floculantes: collection(db, "cad_floculantes"),
  regTanques:  collection(db, "reg_tanques"),
  regBolas:    collection(db, "reg_bolas"),
  regFloc:     collection(db, "reg_floculante"),
  regGLP:      collection(db, "reg_glp"),
};

// ---------- Estado ----------
const state = {
  tanques: [], diametros: [], floculantes: [],
  regTanques: [], regBolas: [], regFloc: [], regGLP: [],
};
let lastMeta = null;
const subs = [];

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const screen = () => $("screen");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => { const d = new Date(); const o = d.getTimezoneOffset(); return new Date(d - o * 60000).toISOString().slice(0, 10); };
const brDate = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- Status de conexão ----------
function setStatus(kind, text) { const b = $("status"); b.className = "status-bar " + kind; $("status-text").textContent = text; }
function refreshStatus() {
  if (!navigator.onLine) return setStatus("offline", "Sem conexão — salvando no aparelho; envia ao reconectar.");
  if (lastMeta && lastMeta.hasPendingWrites) return setStatus("pending", "Conectado — enviando pendências…");
  setStatus("online", "Conectado e sincronizado.");
}
window.addEventListener("online", refreshStatus);
window.addEventListener("offline", refreshStatus);

// ---------- Auth ----------
$("login-btn").addEventListener("click", doLogin);
$("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("logout-btn").addEventListener("click", () => signOut(auth));

async function doLogin() {
  const email = $("login-email").value.trim(), pass = $("login-pass").value;
  $("login-error").textContent = ""; $("login-btn").disabled = true;
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (err) {
    const m = {
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/network-request-failed": "Sem conexão para o primeiro login. Conecte-se uma vez para entrar.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um momento.",
    };
    $("login-error").textContent = m[err.code] || ("Erro: " + err.code);
  } finally { $("login-btn").disabled = false; }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    startSubs(); refreshStatus(); if (!location.hash) location.hash = "#/"; render();
  } else {
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    while (subs.length) (subs.pop())();
  }
});

// ---------- Assinaturas em tempo real ----------
function listen(col, key, ordered = true) {
  const q = ordered ? query(col, orderBy("ts", "desc")) : col;
  return onSnapshot(q, (snap) => {
    state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lastMeta = snap.metadata; refreshStatus();
    const r = route();
    // Re-renderiza telas de leitura sem atrapalhar formulários abertos.
    if (["/", "/historico", "/grafico", "/cadastros"].includes(r)) render();
  }, (err) => { console.error(key, err); setStatus("pending", "Erro ao ler dados: " + err.code); });
}
function startSubs() {
  if (subs.length) return;
  subs.push(listen(COL.tanques, "tanques"));
  subs.push(listen(COL.diametros, "diametros"));
  subs.push(listen(COL.floculantes, "floculantes"));
  subs.push(listen(COL.regTanques, "regTanques"));
  subs.push(listen(COL.regBolas, "regBolas"));
  subs.push(listen(COL.regFloc, "regFloc"));
  subs.push(listen(COL.regGLP, "regGLP"));
}

// ---------- Persistência (não-bloqueante p/ funcionar offline) ----------
function add(col, obj) {
  addDoc(col, { ...obj, ts: Date.now(), por: auth.currentUser?.email || "—" })
    .catch((e) => console.error("save", e));
}
function del(colName, id) { deleteDoc(doc(db, colName, id)).catch((e) => console.error("del", e)); }
window._del = (colName, id, msg) => { if (confirm(msg || "Excluir este registro?")) del(colName, id); };

// ---------- Navegação ----------
function route() { return (location.hash || "#/").slice(1) || "/"; }
window.go = (r) => { location.hash = "#" + r; };
window.addEventListener("hashchange", render);

function render() {
  if ($("app").classList.contains("hidden")) return;
  const r = route();
  const v = {
    "/": viewMenu, "/tanques": viewTanques, "/bolas": viewBolas,
    "/floculante": viewFloc, "/glp": viewGLP, "/historico": viewHist,
    "/grafico": viewGraf, "/cadastros": viewCad,
  }[r] || viewMenu;
  v();
}

function header(title, icon) {
  return r => `<div class="page-title">
    <span class="back" onclick="go('/')">← Menu</span>
    <span style="margin-left:6px">${icon} ${title}</span></div>`;
}

// ============================ MENU ============================
function viewMenu() {
  const cards = [
    ["🛢️", "Tanques", "Registrar % de reagente", "/tanques"],
    ["⚫", "Bolas", "Contagem de bags por diâmetro", "/bolas"],
    ["🧪", "Floculante", "Registrar quantidade consumida", "/floculante"],
    ["🔥", "GLP", "Avaliar % de gás GLP", "/glp"],
    ["📊", "Histórico", "Consultar registros anteriores", "/historico"],
    ["📈", "Gráfico", "Níveis ao longo dos dias", "/grafico"],
    ["⚙️", "Cadastros", "Gerenciar tanques e diâmetros", "/cadastros"],
  ];
  screen().innerHTML = `<div class="page-title">📋 Menu Principal</div>
    <div class="menu-grid">${cards.map(([i, t, d, r]) => `
      <div class="menu-card" onclick="go('${r}')">
        <div class="ic">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join("")}</div>`;
}

// ============================ TANQUES (%) ============================
function viewTanques() {
  const h = header("Tanques", "🛢️")();
  if (!state.tanques.length) {
    screen().innerHTML = h + `<div class="card"><p class="muted">Nenhum tanque cadastrado ainda.</p>
      <button class="btn btn-orange" onclick="go('/cadastros')">Cadastrar tanques</button></div>` + recent("regTanques", "reg_tanques", "Tanques");
    return;
  }
  screen().innerHTML = h + `<div class="card">
    <h2>Registrar níveis do dia</h2>
    <div style="max-width:240px"><label>Data</label><input type="date" id="t-data" value="${todayISO()}"></div>
    <table style="margin-top:12px"><tr><th>Tanque</th><th>Reagente</th><th>Nível (%)</th></tr>
      ${state.tanques.map((t, i) => `<tr>
        <td><b>${esc(t.codigo)}</b></td><td>${esc(t.reagente)}</td>
        <td style="max-width:120px"><input type="number" min="0" max="100" step="0.1"
          id="t-pct-${i}" placeholder="0–100"></td></tr>`).join("")}
    </table>
    <button class="btn btn-navy btn-block" id="t-save">💾 Salvar níveis</button>
  </div>` + recent("regTanques", "reg_tanques", "Tanques");

  $("t-save").onclick = () => {
    const data = $("t-data").value || todayISO();
    const preenchidos = state.tanques.map((t, i) => ({ codigo: t.codigo, reagente: t.reagente, pct: num($(`t-pct-${i}`).value), vazio: $(`t-pct-${i}`).value === "" }));
    const validos = preenchidos.filter(x => !x.vazio).map(({ codigo, reagente, pct }) => ({ codigo, reagente, pct }));
    if (!validos.length) return toast("Preencha ao menos um nível.");
    add(COL.regTanques, { data, itens: validos });
    toast("Níveis salvos ✓"); go("/");
  };
}

// ============================ BOLAS ============================
function viewBolas() {
  const h = header("Bolas", "⚫")();
  const sugest = state.diametros.map(d => `<option value="${esc(d.valor)}">`).join("");
  screen().innerHTML = h + `<div class="card">
    <h2>Contagem de bags por diâmetro</h2>
    <div style="max-width:240px"><label>Data</label><input type="date" id="b-data" value="${todayISO()}"></div>
    <p class="hint">Adicione uma linha por diâmetro. Digite o diâmetro e a quantidade de bags.</p>
    <datalist id="dl-diam">${sugest}</datalist>
    <div id="b-lines"></div>
    <button class="btn btn-ghost btn-sm" id="b-add">+ Adicionar linha</button>
    <button class="btn btn-navy btn-block" id="b-save">💾 Salvar contagem</button>
  </div>` + recent("regBolas", "reg_bolas", "Bolas");

  const lines = $("b-lines");
  const addLine = (diam = "", qtd = "") => {
    const div = document.createElement("div");
    div.className = "add-line";
    div.innerHTML = `
      <div><label>Diâmetro das bolas</label><input list="dl-diam" class="b-diam" placeholder='ex.: 5"' value="${esc(diam)}"></div>
      <div><label>Quantidade de bags</label><input type="number" min="0" step="1" class="b-qtd" placeholder="0" value="${esc(qtd)}"></div>
      <button class="btn danger btn-sm" title="remover">×</button>`;
    div.querySelector("button").onclick = () => div.remove();
    lines.appendChild(div);
  };
  addLine();
  $("b-add").onclick = () => addLine();

  $("b-save").onclick = () => {
    const data = $("b-data").value || todayISO();
    const itens = [...lines.querySelectorAll(".add-line")].map(d => ({
      diametro: d.querySelector(".b-diam").value.trim(),
      qtdBags: num(d.querySelector(".b-qtd").value),
    })).filter(x => x.diametro && x.qtdBags > 0);
    if (!itens.length) return toast("Adicione ao menos um diâmetro com quantidade.");
    add(COL.regBolas, { data, itens });
    toast("Contagem salva ✓"); go("/");
  };
}

// ============================ FLOCULANTE ============================
function viewFloc() {
  const h = header("Floculante", "🧪")();
  if (!state.floculantes.length) {
    screen().innerHTML = h + `<div class="card"><p class="muted">Nenhum floculante cadastrado.</p>
      <button class="btn btn-orange" onclick="go('/cadastros')">Cadastrar floculante</button></div>` + recent("regFloc", "reg_floculante", "Floculante");
    return;
  }
  screen().innerHTML = h + `<div class="card">
    <h2>Quantidade consumida no dia</h2>
    <div style="max-width:240px"><label>Data</label><input type="date" id="f-data" value="${todayISO()}"></div>
    <table style="margin-top:12px"><tr><th>Floculante</th><th>Unidade</th><th>Consumo</th></tr>
      ${state.floculantes.map((f, i) => `<tr>
        <td><b>${esc(f.nome)}</b></td><td>${esc(f.unidade)}</td>
        <td style="max-width:140px"><input type="number" min="0" step="0.01" id="f-q-${i}" placeholder="0"></td></tr>`).join("")}
    </table>
    <button class="btn btn-navy btn-block" id="f-save">💾 Salvar consumo</button>
  </div>` + recent("regFloc", "reg_floculante", "Floculante");

  $("f-save").onclick = () => {
    const data = $("f-data").value || todayISO();
    const itens = state.floculantes.map((f, i) => ({ nome: f.nome, unidade: f.unidade, qtd: num($(`f-q-${i}`).value), vazio: $(`f-q-${i}`).value === "" }))
      .filter(x => !x.vazio).map(({ nome, unidade, qtd }) => ({ nome, unidade, qtd }));
    if (!itens.length) return toast("Preencha ao menos um consumo.");
    add(COL.regFloc, { data, itens });
    toast("Consumo salvo ✓"); go("/");
  };
}

// ============================ GLP (%) ============================
function viewGLP() {
  const h = header("GLP", "🔥")();
  screen().innerHTML = h + `<div class="card">
    <h2>Avaliação diária de GLP</h2>
    <div class="row">
      <div><label>Data</label><input type="date" id="g-data" value="${todayISO()}"></div>
      <div><label>Percentual de gás (%)</label><input type="number" min="0" max="100" step="0.1" id="g-pct" placeholder="0–100"></div>
    </div>
    <button class="btn btn-navy btn-block" id="g-save">💾 Salvar GLP</button>
  </div>` + recent("regGLP", "reg_glp", "GLP");

  $("g-save").onclick = () => {
    const data = $("g-data").value || todayISO();
    const v = $("g-pct").value;
    if (v === "") return toast("Informe o percentual.");
    add(COL.regGLP, { data, pct: num(v) });
    toast("GLP salvo ✓"); go("/");
  };
}

// ---------- Lista "registros recentes" reutilizável ----------
function recent(key, colName, tipo) {
  const regs = state[key].slice(0, 8);
  if (!regs.length) return `<div class="card"><h2>Registros recentes</h2><p class="muted">Nenhum registro ainda.</p></div>`;
  const body = regs.map(r => {
    let resumo = "";
    if (key === "regGLP") resumo = `${r.pct}%`;
    else resumo = (r.itens || []).map(it =>
      key === "regTanques" ? `${esc(it.codigo)}: ${it.pct}%`
        : key === "regBolas" ? `${esc(it.diametro)}: ${it.qtdBags} bags`
          : `${esc(it.nome)}: ${it.qtd} ${esc(it.unidade)}`).join(" · ");
    const pend = r.ts && lastMeta ? "" : "";
    return `<tr><td>${brDate(r.data)}</td><td>${resumo}</td>
      <td class="muted">${esc(r.por)}</td>
      <td><button class="btn danger btn-sm" onclick="_del('${colName}','${r.id}','Excluir este registro de ${tipo}?')">🗑</button></td></tr>`;
  }).join("");
  return `<div class="card"><h2>Registros recentes — ${tipo}</h2>
    <table><tr><th>Data</th><th>Resumo</th><th>Por</th><th></th></tr>${body}</table></div>`;
}

// ============================ HISTÓRICO ============================
function viewHist() {
  const h = header("Histórico", "📊")();
  const all = [
    ...state.regTanques.map(r => ({ ...r, _t: "Tanques", _c: "reg_tanques" })),
    ...state.regBolas.map(r => ({ ...r, _t: "Bolas", _c: "reg_bolas" })),
    ...state.regFloc.map(r => ({ ...r, _t: "Floculante", _c: "reg_floculante" })),
    ...state.regGLP.map(r => ({ ...r, _t: "GLP", _c: "reg_glp" })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const resumo = (r) => r._t === "GLP" ? `${r.pct}%`
    : (r.itens || []).map(it => r._t === "Tanques" ? `${esc(it.codigo)} ${it.pct}%`
      : r._t === "Bolas" ? `${esc(it.diametro)}: ${it.qtdBags} bags`
        : `${esc(it.nome)} ${it.qtd}${esc(it.unidade)}`).join(" · ");

  screen().innerHTML = h + `<div class="card">
    <div class="row" style="grid-template-columns:1fr auto">
      <h2>Todos os registros (${all.length})</h2>
      <select id="hf" style="max-width:180px">
        <option value="">Todos os tipos</option>
        <option>Tanques</option><option>Bolas</option><option>Floculante</option><option>GLP</option>
      </select>
    </div>
    <table id="ht"><tr><th>Data</th><th>Tipo</th><th>Resumo</th><th>Por</th><th></th></tr>
      ${all.map(r => `<tr data-tipo="${r._t}"><td>${brDate(r.data)}</td>
        <td><span class="pill">${r._t}</span></td><td>${resumo(r)}</td>
        <td class="muted">${esc(r.por)}</td>
        <td><button class="btn danger btn-sm" onclick="_del('${r._c}','${r.id}','Excluir registro?')">🗑</button></td></tr>`).join("")
        || `<tr><td colspan="5" class="muted center">Nenhum registro.</td></tr>`}
    </table></div>`;

  $("hf").onchange = (e) => {
    const f = e.target.value;
    [...$("ht").querySelectorAll("tr[data-tipo]")].forEach(tr =>
      tr.style.display = (!f || tr.dataset.tipo === f) ? "" : "none");
  };
}

// ============================ GRÁFICO ============================
let chart = null;
function viewGraf() {
  const h = header("Gráfico", "📈")();
  screen().innerHTML = h + `<div class="card">
    <div class="row" style="grid-template-columns:1fr auto">
      <h2>Níveis ao longo dos dias</h2>
      <select id="gsel" style="max-width:220px">
        <option value="tanques">Tanques (%)</option>
        <option value="glp">GLP (%)</option>
        <option value="floc">Floculante (consumo)</option>
      </select>
    </div>
    <div style="height:380px;position:relative"><canvas id="gcanvas"></canvas></div>
  </div>`;
  const draw = () => drawChart($("gsel").value);
  $("gsel").onchange = draw;
  draw();
}

function drawChart(tipo) {
  const cores = ["#e8552d", "#2e9e8f", "#1a2b4a", "#f39c12", "#3498db", "#9b59b6", "#2ecc71", "#e91e63"];
  let labels = [], datasets = [], yTitle = "%";

  if (tipo === "glp") {
    const regs = [...state.regGLP].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    datasets = [{ label: "GLP (%)", data: regs.map(r => r.pct), borderColor: cores[0], backgroundColor: cores[0], tension: .3, borderWidth: 2 }];
  } else if (tipo === "tanques") {
    const regs = [...state.regTanques].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    const codigos = [...new Set(regs.flatMap(r => (r.itens || []).map(i => i.codigo)))];
    datasets = codigos.map((cod, i) => ({
      label: cod, borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length],
      tension: .3, borderWidth: 2, spanGaps: true,
      data: regs.map(r => { const it = (r.itens || []).find(x => x.codigo === cod); return it ? it.pct : null; }),
    }));
  } else {
    yTitle = "consumo";
    const regs = [...state.regFloc].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    const nomes = [...new Set(regs.flatMap(r => (r.itens || []).map(i => i.nome)))];
    datasets = nomes.map((nm, i) => ({
      label: nm, borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length],
      tension: .3, borderWidth: 2, spanGaps: true,
      data: regs.map(r => { const it = (r.itens || []).find(x => x.nome === nm); return it ? it.qtd : null; }),
    }));
  }

  const ctx = $("gcanvas");
  if (chart) chart.destroy();
  if (!labels.length) { ctx.parentElement.innerHTML = '<p class="muted center" style="padding-top:40px">Sem dados para este gráfico ainda.</p>'; return; }
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, title: { display: true, text: yTitle }, ...(tipo !== "floc" ? { max: 100 } : {}) } },
    },
  });
}

// ============================ CADASTROS ============================
function viewCad() {
  const h = header("Cadastros", "⚙️")();
  screen().innerHTML = h + `
  <div class="card"><h2>Cadastrar Tanque</h2>
    <div class="row">
      <div><label>Código</label><input id="c-tcod" placeholder="Ex: TQ001"></div>
      <div><label>Reagente</label><input id="c-treag" placeholder="Ex: NaOH"></div>
    </div>
    <button class="btn btn-navy" id="c-tadd">Adicionar Tanque</button>
    <table style="margin-top:12px"><tr><th>Código</th><th>Reagente</th><th></th></tr>
      ${state.tanques.map(t => `<tr><td><b>${esc(t.codigo)}</b></td><td>${esc(t.reagente)}</td>
        <td><button class="btn danger btn-sm" onclick="_del('cad_tanques','${t.id}','Excluir tanque ${esc(t.codigo)}?')">🗑</button></td></tr>`).join("")
        || '<tr><td colspan="3" class="muted center">Nenhum tanque.</td></tr>'}
    </table>
  </div>

  <div class="card"><h2>Cadastrar Diâmetro de Bola</h2>
    <div class="row">
      <div><label>Diâmetro</label><input id="c-diam" placeholder='Ex: 5"'></div>
      <div><label>Descrição (opcional)</label><input id="c-ddesc" placeholder="Ex: bola forjada"></div>
    </div>
    <button class="btn btn-orange" id="c-dadd">Adicionar Diâmetro</button>
    <p class="hint">Os diâmetros cadastrados viram sugestões na tela de Bolas.</p>
    <table style="margin-top:12px"><tr><th>Diâmetro</th><th>Descrição</th><th></th></tr>
      ${state.diametros.map(d => `<tr><td><b>${esc(d.valor)}</b></td><td>${esc(d.desc || "")}</td>
        <td><button class="btn danger btn-sm" onclick="_del('cad_diametros','${d.id}','Excluir diâmetro ${esc(d.valor)}?')">🗑</button></td></tr>`).join("")
        || '<tr><td colspan="3" class="muted center">Nenhum diâmetro.</td></tr>'}
    </table>
  </div>

  <div class="card"><h2>Cadastrar Floculante</h2>
    <div class="row">
      <div><label>Nome</label><input id="c-fnome" placeholder="Ex: Magnafloc 10"></div>
      <div><label>Unidade padrão</label><input id="c-funi" placeholder="Ex: kg"></div>
    </div>
    <button class="btn btn-teal" id="c-fadd">Adicionar Floculante</button>
    <table style="margin-top:12px"><tr><th>Nome</th><th>Unidade</th><th></th></tr>
      ${state.floculantes.map(f => `<tr><td><b>${esc(f.nome)}</b></td><td>${esc(f.unidade)}</td>
        <td><button class="btn danger btn-sm" onclick="_del('cad_floculantes','${f.id}','Excluir floculante ${esc(f.nome)}?')">🗑</button></td></tr>`).join("")
        || '<tr><td colspan="3" class="muted center">Nenhum floculante.</td></tr>'}
    </table>
  </div>`;

  $("c-tadd").onclick = () => {
    const codigo = $("c-tcod").value.trim(), reagente = $("c-treag").value.trim();
    if (!codigo) return toast("Informe o código do tanque.");
    add(COL.tanques, { codigo, reagente }); toast("Tanque adicionado ✓");
  };
  $("c-dadd").onclick = () => {
    const valor = $("c-diam").value.trim(), desc = $("c-ddesc").value.trim();
    if (!valor) return toast("Informe o diâmetro.");
    add(COL.diametros, { valor, desc }); toast("Diâmetro adicionado ✓");
  };
  $("c-fadd").onclick = () => {
    const nome = $("c-fnome").value.trim(), unidade = $("c-funi").value.trim();
    if (!nome) return toast("Informe o nome do floculante.");
    add(COL.floculantes, { nome, unidade }); toast("Floculante adicionado ✓");
  };
}

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
