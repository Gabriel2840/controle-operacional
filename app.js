// =============================================================
//  Controle Operacional — Aura 360 (PWA offline-first)
//  Telas: Tanques (%), Bolas (bags/diâmetro), Floculante,
//         GLP (%), Histórico, Gráfico, Cadastros.
//  Base: Supabase (Postgres + Auth + Realtime). A camada offline
//  é feita aqui (cache local + fila de envios no navegador):
//  registra sem internet e sincroniza ao reconectar. Login obrigatório.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

// ---------- Init ----------
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// COL.x devolve o NOME da tabela (as telas chamam add(COL.x, ...) e _del('tabela', id)).
const COL = {
  tanques: "cad_tanques", diametros: "cad_diametros", floculantes: "cad_floculantes",
  regTanques: "reg_tanques", regBolas: "reg_bolas", regFloc: "reg_floculante", regGLP: "reg_glp",
};
const TABELA_KEY = {
  cad_tanques: "tanques", cad_diametros: "diametros", cad_floculantes: "floculantes",
  reg_tanques: "regTanques", reg_bolas: "regBolas", reg_floculante: "regFloc", reg_glp: "regGLP",
};
const TABELAS = Object.keys(TABELA_KEY);

// ---------- Estado ----------
const state = {
  tanques: [], diametros: [], floculantes: [],
  regTanques: [], regBolas: [], regFloc: [], regGLP: [],
};
let currentEmail = "—";
let realtimeChan = null;
const meusInserts = new Set(); // ids criados neste aparelho (p/ não notificar a si mesmo)

// ---------- Cache local + fila de envios (offline) ----------
// Supabase não tem offline embutido; guardamos no localStorage um CACHE por
// tabela (ler offline / abrir rápido) e uma OUTBOX (gravações feitas sem rede).
const LS_CACHE = (t) => `co_cache_${t}`;
const LS_OUTBOX = "co_outbox";
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("ls", e); } };
const cacheGet = (t) => jget(LS_CACHE(t), []);
const cacheSet = (t, rows) => jset(LS_CACHE(t), rows);
const outboxGet = () => jget(LS_OUTBOX, []);
const outboxSet = (q) => jset(LS_OUTBOX, q);
const outboxAdd = (op) => { const q = outboxGet(); q.push(op); outboxSet(q); };

function loadStateFromCache() {
  for (const t of TABELAS) {
    state[TABELA_KEY[t]] = cacheGet(t).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
}

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const screen = () => $("screen");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => { const d = new Date(); const o = d.getTimezoneOffset(); return new Date(d - o * 60000).toISOString().slice(0, 10); };
const brDate = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

function toast(msg, ms = 2600) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

// Aviso quando chega registro gravado por OUTRO aparelho.
const TIPO_NOME = { regTanques: "Tanques", regBolas: "Bolas", regFloc: "Floculante", regGLP: "GLP" };
function notifyNovo(tipo, n) {
  toast(`🔔 ${n} registro${n > 1 ? "s" : ""} de ${tipo} recebido${n > 1 ? "s" : ""} de outro aparelho`, 4200);
}

// ---------- Status de conexão ----------
function setStatus(kind, text) { const b = $("status"); b.className = "status-bar " + kind; $("status-text").textContent = text; }
function refreshStatus() {
  const pend = outboxGet().length;
  if (!navigator.onLine) return setStatus("offline", `Sem conexão — salvando no aparelho${pend ? ` (${pend} na fila)` : ""}; envia ao reconectar.`);
  if (pend) return setStatus("pending", `Conectado — enviando ${pend} pendência${pend > 1 ? "s" : ""}…`);
  setStatus("online", "Conectado e sincronizado.");
}
window.addEventListener("online", () => { refreshStatus(); sincronizar(); });
window.addEventListener("offline", refreshStatus);

// ---------- Auth (Supabase) ----------
$("login-btn").addEventListener("click", doLogin);
$("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("logout-btn").addEventListener("click", async () => { await supa.auth.signOut(); });

async function doLogin() {
  const email = $("login-email").value.trim(), pass = $("login-pass").value;
  $("login-error").textContent = ""; $("login-btn").disabled = true;
  if (!navigator.onLine) {
    $("login-error").textContent = "Sem conexão para o primeiro login. Conecte-se uma vez para entrar.";
    $("login-btn").disabled = false; return;
  }
  const { error } = await supa.auth.signInWithPassword({ email, password: pass });
  if (error) {
    $("login-error").textContent = /invalid login|credentials/i.test(error.message)
      ? "E-mail ou senha incorretos." : ("Erro: " + error.message);
  }
  $("login-btn").disabled = false;
}

supa.auth.onAuthStateChange((_evt, session) => {
  if (session?.user) {
    currentEmail = session.user.email || "—";
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    loadStateFromCache();
    if (!location.hash) location.hash = "#/";
    render(); refreshStatus();
    iniciar(); // sincroniza + assina tempo real
  } else {
    currentEmail = "—";
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    if (realtimeChan) { supa.removeChannel(realtimeChan); realtimeChan = null; }
  }
});

// ---------- Sincronização + tempo real ----------
const reRenderSeLeitura = () => {
  const r = route();
  if (["/", "/historico", "/grafico", "/cadastros"].includes(r)) render();
};

async function puxarTabela(t) {
  const { data, error } = await supa.from(t).select("*").order("ts", { ascending: false });
  if (error) { console.warn("fetch", t, error.message); return; }
  cacheSet(t, data || []);
  state[TABELA_KEY[t]] = data || [];
}

async function flushOutbox() {
  const q = outboxGet();
  if (!q.length || !navigator.onLine) return;
  const restantes = [];
  for (const op of q) {
    try {
      if (op.op === "insert") {
        const { error } = await supa.from(op.tabela).insert(op.row);
        if (error && error.code !== "23505") throw error; // 23505 = já existe (ok)
      } else if (op.op === "delete") {
        const { error } = await supa.from(op.tabela).delete().eq("id", op.id);
        if (error) throw error;
      }
    } catch (e) { console.warn("flush", e?.message || e); restantes.push(op); }
  }
  outboxSet(restantes);
}

async function sincronizar() {
  if (!navigator.onLine) { refreshStatus(); return; }
  await flushOutbox();
  for (const t of TABELAS) await puxarTabela(t);
  refreshStatus();
  reRenderSeLeitura();
}

function assinarTempoReal() {
  if (realtimeChan) return;
  realtimeChan = supa.channel("co-realtime");
  for (const t of TABELAS) {
    realtimeChan.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      const key = TABELA_KEY[t];
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const row = payload.new;
        state[key] = [row, ...state[key].filter((x) => x.id !== row.id)]
          .sort((a, b) => (b.ts || 0) - (a.ts || 0));
        cacheSet(t, state[key]);
        if (payload.eventType === "INSERT" && TIPO_NOME[key] && !meusInserts.has(row.id)) {
          notifyNovo(TIPO_NOME[key], 1);
        }
      } else if (payload.eventType === "DELETE") {
        state[key] = state[key].filter((x) => x.id !== payload.old.id);
        cacheSet(t, state[key]);
      }
      reRenderSeLeitura();
    });
  }
  realtimeChan.subscribe();
}

async function iniciar() {
  await sincronizar();
  assinarTempoReal();
}

// ---------- Gravação (otimista + fila offline) ----------
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}

function add(tabela, obj) {
  const row = { ...obj, id: uuid(), ts: Date.now(), por: currentEmail };
  const key = TABELA_KEY[tabela];
  state[key] = [row, ...state[key]];          // aparece na hora (otimista)
  cacheSet(tabela, state[key]);
  meusInserts.add(row.id);
  if (navigator.onLine) {
    supa.from(tabela).insert(row).then(({ error }) => {
      if (error && error.code !== "23505") { console.warn("insert", error.message); outboxAdd({ op: "insert", tabela, row }); }
      refreshStatus();
    });
  } else {
    outboxAdd({ op: "insert", tabela, row });
  }
  reRenderSeLeitura(); refreshStatus();
}

function del(tabela, id) {
  const key = TABELA_KEY[tabela];
  state[key] = state[key].filter((x) => x.id !== id);
  cacheSet(tabela, state[key]);
  if (navigator.onLine) {
    supa.from(tabela).delete().eq("id", id).then(({ error }) => {
      if (error) { console.warn("delete", error.message); outboxAdd({ op: "delete", tabela, id }); }
      refreshStatus();
    });
  } else {
    outboxAdd({ op: "delete", tabela, id });
  }
  reRenderSeLeitura(); refreshStatus();
}
window._del = (tabela, id, msg) => { if (confirm(msg || "Excluir este registro?")) del(tabela, id); };

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
    <p class="hint">Adicione uma linha por diâmetro: diâmetro, quantidade de bags e o peso da bag (kg).</p>
    <datalist id="dl-diam">${sugest}</datalist>
    <div id="b-lines"></div>
    <button class="btn btn-ghost btn-sm" id="b-add">+ Adicionar linha</button>
    <button class="btn btn-navy btn-block" id="b-save">💾 Salvar contagem</button>
  </div>` + recent("regBolas", "reg_bolas", "Bolas");

  const lines = $("b-lines");
  const addLine = (diam = "", qtd = "", peso = "") => {
    const div = document.createElement("div");
    div.className = "add-line";
    div.innerHTML = `
      <div><label>Diâmetro das bolas</label><input list="dl-diam" class="b-diam" placeholder='ex.: 5"' value="${esc(diam)}"></div>
      <div><label>Quantidade de bags</label><input type="number" min="0" step="1" class="b-qtd" placeholder="0" value="${esc(qtd)}"></div>
      <div><label>Peso da bag (kg)</label><input type="number" min="0" step="0.01" class="b-peso" placeholder="0" value="${esc(peso)}"></div>
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
      peso: num(d.querySelector(".b-peso").value),
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
    <table style="margin-top:12px"><tr><th>Floculante</th><th>Consumo do dia</th><th>Unidade</th><th>Sacos disponíveis</th></tr>
      ${state.floculantes.map((f, i) => `<tr>
        <td><b>${esc(f.nome)}</b>${f.pesoSaco ? `<br><small class="muted">${f.pesoSaco} kg/saco</small>` : ""}</td>
        <td style="max-width:170px"><input type="number" min="0" step="0.01" id="f-q-${i}" placeholder="0">
          <div class="hint" id="f-eq-${i}"></div></td>
        <td style="max-width:110px"><select id="f-u-${i}">
          ${["KG", "UND"].map(u => `<option value="${u}"${f.unidade === u ? " selected" : ""}>${u}</option>`).join("")}
        </select></td>
        <td style="max-width:170px"><input type="number" min="0" step="0.01" id="f-d-${i}" placeholder="0">
          <div class="hint" id="f-eqd-${i}"></div></td></tr>`).join("")}
    </table>
    <button class="btn btn-navy btn-block" id="f-save">💾 Salvar consumo</button>
  </div>` + recent("regFloc", "reg_floculante", "Floculante");

  // Conversão automática kg ↔ sacos (quando o floculante tem peso por saco).
  state.floculantes.forEach((f, i) => {
    const ps = num(f.pesoSaco);
    const upd = () => {
      const q = num($(`f-q-${i}`).value), u = $(`f-u-${i}`).value, d = num($(`f-d-${i}`).value);
      $(`f-eq-${i}`).textContent = (ps > 0 && q > 0)
        ? (u === "KG" ? `≈ ${(q / ps).toFixed(1)} sacos` : `≈ ${(q * ps).toFixed(1)} kg`) : "";
      $(`f-eqd-${i}`).textContent = (ps > 0 && d > 0) ? `≈ ${(d * ps).toFixed(1)} kg` : "";
    };
    $(`f-q-${i}`).addEventListener("input", upd);
    $(`f-u-${i}`).addEventListener("change", upd);
    $(`f-d-${i}`).addEventListener("input", upd);
  });

  $("f-save").onclick = () => {
    const data = $("f-data").value || todayISO();
    const itens = state.floculantes.map((f, i) => {
      const q = $(`f-q-${i}`).value, d = $(`f-d-${i}`).value;
      return { nome: f.nome, unidade: $(`f-u-${i}`).value, qtd: num(q), disp: num(d), pesoSaco: num(f.pesoSaco), vazio: q === "" && d === "" };
    }).filter(x => !x.vazio).map(({ nome, unidade, qtd, disp, pesoSaco }) => ({ nome, unidade, qtd, disp, pesoSaco }));
    if (!itens.length) return toast("Preencha ao menos um consumo ou disponibilidade.");
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
        : key === "regBolas" ? `${esc(it.diametro)}: ${it.qtdBags} bags${it.peso ? ` × ${it.peso}kg` : ""}`
          : `${esc(it.nome)}: ${it.qtd} ${esc(it.unidade)}${it.disp != null ? ` · ${it.disp} sacos disp.` : ""}`).join(" · ");
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
      : r._t === "Bolas" ? `${esc(it.diametro)}: ${it.qtdBags} bags${it.peso ? ` × ${it.peso}kg` : ""}`
        : `${esc(it.nome)} ${it.qtd}${esc(it.unidade)}${it.disp != null ? ` (${it.disp} sacos)` : ""}`).join(" · ");

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
      <select id="gsel" style="max-width:240px">
        <option value="tanques">Tanques (%)</option>
        <option value="glp">GLP (%)</option>
        <option value="floc">Floculante (consumo)</option>
        <option value="flocdisp">Floculante (sacos disponíveis)</option>
        <option value="bolas">Bolas (bags por diâmetro)</option>
        <option value="bolaskg">Bolas (kg por dia)</option>
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
  } else if (tipo === "flocdisp") {
    yTitle = "sacos disponíveis";
    const regs = [...state.regFloc].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    const nomes = [...new Set(regs.flatMap(r => (r.itens || []).map(i => i.nome)))];
    datasets = nomes.map((nm, i) => ({
      label: nm, borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length],
      tension: .3, borderWidth: 2, spanGaps: true,
      data: regs.map(r => { const it = (r.itens || []).find(x => x.nome === nm); return it && it.disp != null ? it.disp : null; }),
    }));
  } else if (tipo === "bolas") {
    yTitle = "bags";
    const regs = [...state.regBolas].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    const diams = [...new Set(regs.flatMap(r => (r.itens || []).map(i => i.diametro)))];
    datasets = diams.map((dm, i) => ({
      label: dm, borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length],
      tension: .3, borderWidth: 2, spanGaps: true,
      data: regs.map(r => {
        const its = (r.itens || []).filter(x => x.diametro === dm);
        return its.length ? its.reduce((s, x) => s + (x.qtdBags || 0), 0) : null;
      }),
    }));
  } else if (tipo === "bolaskg") {
    yTitle = "kg";
    const regs = [...state.regBolas].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    labels = regs.map(r => brDate(r.data));
    datasets = [{
      label: "Peso total (kg/dia)", borderColor: cores[0], backgroundColor: cores[0],
      tension: .3, borderWidth: 2,
      data: regs.map(r => (r.itens || []).reduce((s, x) => s + (x.qtdBags || 0) * (x.peso || 0), 0)),
    }];
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
      elements: { point: { radius: 4, hoverRadius: 7 }, line: { borderWidth: 2 } },
      scales: { y: { beginAtZero: true, title: { display: true, text: yTitle }, ...((tipo === "tanques" || tipo === "glp") ? { max: 100 } : {}) } },
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
      ${state.diametros.map(d => `<tr><td><b>${esc(d.valor)}</b></td><td>${esc(d.descricao || "")}</td>
        <td><button class="btn danger btn-sm" onclick="_del('cad_diametros','${d.id}','Excluir diâmetro ${esc(d.valor)}?')">🗑</button></td></tr>`).join("")
        || '<tr><td colspan="3" class="muted center">Nenhum diâmetro.</td></tr>'}
    </table>
  </div>

  <div class="card"><h2>Cadastrar Floculante</h2>
    <div class="row">
      <div><label>Nome</label><input id="c-fnome" placeholder="Ex: Magnafloc 10"></div>
      <div><label>Unidade padrão</label>
        <select id="c-funi">${["KG", "UND"].map(u => `<option value="${u}">${u}</option>`).join("")}</select></div>
    </div>
    <div class="row">
      <div><label>Peso por saco (kg) — opcional</label><input type="number" min="0" step="0.01" id="c-fpeso" placeholder="Ex: 25"></div>
      <div></div>
    </div>
    <button class="btn btn-teal" id="c-fadd">Adicionar Floculante</button>
    <p class="hint">O peso por saco permite o app converter automaticamente kg ↔ sacos na hora do registro.</p>
    <table style="margin-top:12px"><tr><th>Nome</th><th>Unidade</th><th>Peso/saco</th><th></th></tr>
      ${state.floculantes.map(f => `<tr><td><b>${esc(f.nome)}</b></td><td>${esc(f.unidade)}</td>
        <td>${f.pesoSaco ? esc(f.pesoSaco) + " kg" : "—"}</td>
        <td><button class="btn danger btn-sm" onclick="_del('cad_floculantes','${f.id}','Excluir floculante ${esc(f.nome)}?')">🗑</button></td></tr>`).join("")
        || '<tr><td colspan="4" class="muted center">Nenhum floculante.</td></tr>'}
    </table>
  </div>`;

  $("c-tadd").onclick = () => {
    const codigo = $("c-tcod").value.trim(), reagente = $("c-treag").value.trim();
    if (!codigo) return toast("Informe o código do tanque.");
    add(COL.tanques, { codigo, reagente }); toast("Tanque adicionado ✓");
  };
  $("c-dadd").onclick = () => {
    const valor = $("c-diam").value.trim(), descricao = $("c-ddesc").value.trim();
    if (!valor) return toast("Informe o diâmetro.");
    add(COL.diametros, { valor, descricao }); toast("Diâmetro adicionado ✓");
  };
  $("c-fadd").onclick = () => {
    const nome = $("c-fnome").value.trim(), unidade = $("c-funi").value, pesoSaco = num($("c-fpeso").value);
    if (!nome) return toast("Informe o nome do floculante.");
    add(COL.floculantes, { nome, unidade, pesoSaco }); toast("Floculante adicionado ✓");
  };
}

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
