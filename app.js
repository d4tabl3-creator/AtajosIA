(function () {
  "use strict";

  var PAGE = 12;
  var PRIORITY = [
    "Comandos nativos de ChatGPT (escritorio)",
    "Comandos nativos de Claude Code",
    "Códigos de Gemini no verificados",
    "No verificado o ambiguo",
  ];
  var LEVEL_LABEL = { native: "Nativo", community: "Atajo comunitario", unverified: "No verificado" };
  var WHY = {
    native:
      "Funciona solo si esa aplicación tiene el comando en su menú. Elegirlo ejecuta una acción del programa. No vuelve al modelo más listo.",
    community:
      "Funciona en cualquier chatbot porque es una instrucción escrita como si fuera un comando. No hay un interruptor oculto detrás de la barra.",
    unverified:
      "Circula en listas de internet sin una página del fabricante que lo confirme. Si no pasa nada, ese es el resultado esperado.",
  };
  var NOT_PROMISE = {
    native: "No promete mejor razonamiento ni un modo secreto. Si tu app o tu plan no lo incluyen, no hace nada.",
    community: "No promete exactitud. Si pides hechos, pide también fuentes o que marque lo que no pudo comprobar.",
    unverified: "No promete ningún efecto. No lo uses para una decisión importante.",
  };
  var INTENT_WORDS = {
    explicar: "explicar aprender enseñar",
    verificar: "verificar comprobar fuente verdad",
    escribir: "escribir mejorar texto redactar",
    planificar: "planificar plan organizar decidir",
    imagen: "imagen diseño foto visual crear",
    programar: "programar código depurar sistema",
    investigar: "investigar analizar datos",
    negociar: "negociar ventas marketing negocio",
  };
  var INTENTS = [
    ["", "Todo"], ["explicar", "Explicar"], ["verificar", "Verificar"], ["escribir", "Escribir"],
    ["planificar", "Planificar"], ["imagen", "Imagen"], ["programar", "Programar"],
    ["investigar", "Investigar"], ["negociar", "Negociar"],
  ];
  var LEVELS = [["", "Todos"], ["native", "Nativo"], ["community", "Comunitario"], ["unverified", "No verificado"]];

  var state = { items: null, details: null, q: "", level: "", intent: "", cat: "", shown: PAGE, theme: "auto", copied: "" };
  var openKeys = {};
  var topics = {};
  var $ = function (id) { return document.getElementById(id); };

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function lev(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    var m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    var prev = [];
    for (var k = 0; k <= n; k++) prev.push(k);
    for (var i = 1; i <= m; i++) {
      var cur = [i], rowMin = i;
      for (var j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > 2) return 9;
      prev = cur;
    }
    return prev[n];
  }
  function blob(item, d) {
    var extra = item.n.map(function (id) { return INTENT_WORDS[id] || id; }).join(" ");
    return norm([item.c, item.g, item.d, d && d.e, d && d.t, d && d.x, extra].filter(Boolean).join(" "));
  }
  function textMatch(item, query, hay) {
    var nq = norm(query).trim();
    if (!nq) return true;
    if (hay.indexOf(nq) !== -1) return true;
    var words = nq.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every(function (w) { return hay.indexOf(w) !== -1; })) return true;
    if (words.length === 1 && words[0].length >= 4) {
      var code = norm(item.c).replace(/^[@/$]+/, "");
      var dist = words[0].length >= 7 ? 2 : 1;
      if (lev(words[0], code) <= dist) return true;
    }
    return false;
  }
  function readyPrompt(item, d) {
    if (d && d.x) return d.x;
    return [item.c, "Interpreta esta etiqueta como la siguiente instrucción: " + item.d, "Aplica esa instrucción a esta tarea: [TEMA]."].join("\n");
  }
  function withTopic(prompt, topic) {
    var tema = String(topic || "").trim() || "[TEMA]";
    return prompt.split("[TEMA]").join(tema);
  }

  function applyTheme(t) {
    var root = document.documentElement;
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    $("theme").textContent = t === "dark" ? "Oscuro" : t === "light" ? "Claro" : "Auto";
    $("theme").setAttribute("aria-label", t === "dark" ? "Tema oscuro" : t === "light" ? "Tema claro" : "Tema automático");
  }

  function chips(el, list, key) {
    el.innerHTML = list.map(function (p) {
      return '<button type="button" class="chip" data-v="' + esc(p[0]) + '" aria-pressed="' + (state[key] === p[0]) + '">' + esc(p[1]) + "</button>";
    }).join("");
  }

  function filtered() {
    if (!state.items) return [];
    return state.items.filter(function (item) {
      if (state.level && item.l !== state.level) return false;
      if (state.intent && item.n.indexOf(state.intent) === -1) return false;
      if (state.cat && item.g !== state.cat) return false;
      return textMatch(item, state.q, blob(item, state.details && state.details[item.i]));
    });
  }

  function copyLabel(key, label) { return state.copied === key ? "Copiado" : label; }

  function card(item, dupes) {
    var d = state.details && state.details[item.i];
    var l = item.l;
    var prompt = readyPrompt(item, d);
    var id = item.i;
    var h = '<article class="card ' + l + '" data-i="' + id + '">';
    h += '<div class="row"><h2>' + esc(item.c) + '</h2><span class="badge ' + l + '">' + esc(LEVEL_LABEL[l]) + "</span></div>";
    h += '<p class="cat mt2">' + esc(item.g) + "</p>";
    h += '<p class="mt2">' + esc(item.d) + "</p>";
    if (d) h += '<p class="mt2 s muted">' + esc(d.e) + "</p>";
    if ((dupes[item.c] || 0) > 1) h += '<p class="mt2 s warn">Este código tiene más de una ficha. No significa lo mismo en todos los entornos.</p>';
    if (d) h += '<p class="mt2 s muted">' + esc(d.t) + "</p>";
    h += '<div class="actions">';
    h += '<button type="button" class="btn" data-copy="code">' + copyLabel(id + ":code", "Copiar código") + "</button>";
    h += '<button type="button" class="btn primary" data-copy="prompt">' + copyLabel(id + ":prompt", "Copiar instrucción") + "</button>";
    h += "</div>";
    h += "<details" + (openKeys[id] ? " open" : "") + "><summary>Por qué funciona y qué no promete</summary>";
    h += '<p class="mt2 s"><b>Por qué funciona. </b>' + esc(WHY[l]) + "</p>";
    h += '<p class="mt2 s"><b>Qué no promete. </b>' + esc(NOT_PROMISE[l]) + "</p>";
    h += "<pre>" + esc(prompt) + "</pre>";
    h += '<label class="topic">Probar con tu tema<input data-topic value="' + esc(topics[id] || "") + '" placeholder="Escribe el tema" aria-label="' + esc("Tema para " + item.c) + '"></label>';
    h += '<button type="button" class="btn full" data-copy="topic">' + copyLabel(id + ":topic", "Copiar con mi tema") + "</button>";
    h += "</details></article>";
    return h;
  }

  function render() {
    chips($("intents"), INTENTS, "intent");
    chips($("levels"), LEVELS, "level");
    var items = state.items || [];
    if (items.length) {
      var uniq = {}, cats = {};
      items.forEach(function (x) { uniq[x.c] = 1; cats[x.g] = 1; });
      $("counts").innerHTML = "<b>" + items.length + "</b> registros · <b>" + Object.keys(uniq).length + "</b> códigos · <b>" + Object.keys(cats).length + "</b> categorías";
    }
    var list = filtered();
    var visible = list.slice(0, state.shown);
    $("status").textContent = state.items ? visible.length + " de " + list.length : $("error").innerHTML ? "" : "Cargando fichas…";
    var dupes = {};
    items.forEach(function (x) { dupes[x.c] = (dupes[x.c] || 0) + 1; });
    $("cards").innerHTML = visible.map(function (x) { return card(x, dupes); }).join("");
    $("empty").innerHTML = state.items && list.length === 0
      ? '<div class="box"><p><b>No encontré ese código.</b></p><p class="mt2 s muted">Prueba con «explicar» o «verificar».</p></div>'
      : "";
    $("more").hidden = !(state.shown < list.length);
  }

  function fillCategories() {
    var names = {};
    state.items.forEach(function (x) { names[x.g] = 1; });
    var list = Object.keys(names).sort(function (a, b) {
      var ia = PRIORITY.indexOf(a), ib = PRIORITY.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b, "es");
    });
    $("cat").innerHTML = '<option value="">Todas las categorías</option>' +
      list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    $("cat").value = list.indexOf(state.cat) !== -1 ? state.cat : "";
    state.cat = $("cat").value;
  }

  function persist() {
    store("atajos.q", state.q); store("atajos.level", state.level);
    store("atajos.intent", state.intent); store("atajos.cat", state.cat);
  }

  function copy(text, key) {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    var done = function () {
      state.copied = key;
      render();
      setTimeout(function () { if (state.copied === key) { state.copied = ""; render(); } }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copia este texto:", text); done(); });
    } else {
      window.prompt("Copia este texto:", text);
      done();
    }
  }

  function findItem(i) {
    for (var k = 0; k < state.items.length; k++) if (state.items[k].i === i) return state.items[k];
    return null;
  }

  // Eventos
  $("q").addEventListener("input", function (e) { state.q = e.target.value; state.shown = PAGE; persist(); render(); });
  $("cat").addEventListener("change", function (e) { state.cat = e.target.value; state.shown = PAGE; persist(); render(); });
  $("clear").addEventListener("click", function () {
    state.q = state.level = state.intent = state.cat = ""; state.shown = PAGE;
    $("q").value = ""; $("cat").value = ""; persist(); render();
  });
  $("more").addEventListener("click", function () { state.shown += PAGE; render(); });
  $("theme").addEventListener("click", function () {
    state.theme = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
    applyTheme(state.theme); store("atajos.theme", state.theme);
  });
  $("intents").addEventListener("click", function (e) {
    var b = e.target.closest("[data-v]"); if (!b) return;
    state.intent = b.getAttribute("data-v"); state.shown = PAGE; persist(); render();
  });
  $("levels").addEventListener("click", function (e) {
    var b = e.target.closest("[data-v]"); if (!b) return;
    state.level = b.getAttribute("data-v"); state.shown = PAGE; persist(); render();
  });
  $("cards").addEventListener("toggle", function (e) {
    var art = e.target.closest && e.target.closest("[data-i]");
    if (art) openKeys[art.getAttribute("data-i")] = e.target.open;
  }, true);
  $("cards").addEventListener("input", function (e) {
    if (!e.target.hasAttribute("data-topic")) return;
    var art = e.target.closest("[data-i]");
    topics[art.getAttribute("data-i")] = e.target.value;
  });
  $("cards").addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    var art = b.closest("[data-i]");
    var i = Number(art.getAttribute("data-i"));
    var item = findItem(i); if (!item) return;
    var kind = b.getAttribute("data-copy");
    var prompt = readyPrompt(item, state.details && state.details[i]);
    if (kind === "code") copy(item.c, i + ":code");
    else if (kind === "prompt") copy(prompt, i + ":prompt");
    else copy(withTopic(prompt, topics[i]), i + ":topic");
  });

  // Inicio
  state.q = load("atajos.q"); state.level = load("atajos.level");
  state.intent = load("atajos.intent"); state.cat = load("atajos.cat");
  state.theme = load("atajos.theme") || "auto";
  $("q").value = state.q;
  applyTheme(state.theme);
  render();

  fetch("catalog/index.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      state.items = data;
      fillCategories();
      render();
      return fetch("catalog/details.json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) { state.details = d; render(); } })
        .catch(function () {});
    })
    .catch(function () {
      $("error").innerHTML = '<div class="box"><p><b>No pude cargar el catálogo. Vuelve a intentar.</b></p><button type="button" class="btn primary mt3" onclick="location.reload()">Reintentar</button></div>';
      $("status").textContent = "";
    });
})();
