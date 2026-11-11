/*
  Окно ИИ-чата для сайта клиники «Мята».
  Подключение: перед </body> добавьте одну строку
    <script src="myata-chat.js" defer></script>
  Настройки (необязательно) задаются прямо в этой строке:
    data-endpoint  адрес функции (по умолчанию /.netlify/functions/chat)
    data-title     заголовок окна
    data-accent    главный цвет, например #2aa88a
    data-phone     телефон для запасных сообщений
*/
(function () {
  "use strict";
  if (window.__myataChatLoaded) return;
  window.__myataChatLoaded = true;

  var script =
    document.currentScript || document.querySelector("script[data-myata-chat]") || document.querySelector('script[src*="myata-chat"]');

  function attr(name, fallback) {
    var v = script && script.getAttribute(name);
    return v ? v : fallback;
  }

  var cfg = {
    endpoint: attr("data-endpoint", "/.netlify/functions/chat"),
    title: attr("data-title", "Клиника «Мята»"),
    subtitle: attr("data-subtitle", "Виртуальный администратор (ИИ)"),
    accent: attr("data-accent", "#2aa88a"),
    phone: attr("data-phone", ""),
    welcome: attr(
      "data-welcome",
      "Здравствуйте! Я виртуальный администратор клиники «Мята». Расскажу об услугах и ценах, графике работы и запишу вас на приём."
    ),
    // Текст о согласии показывается всегда, независимо от ИИ.
    consent: attr(
      "data-consent",
      "Оставляя телефон в чате, вы соглашаетесь на его передачу клинике для связи с вами."
    ),
    note: attr("data-note", "Это ИИ-помощник, он не врач и не заменяет консультацию."),
    maxChars: 500,
    maxUserMessages: 12,
    timeoutMs: 40000,
  };

  var css =
    ".mc-root{--mc-accent:" + cfg.accent + ";font-family:inherit;font-size:15px;line-height:1.4;color:#1d2b27}" +
    ".mc-root *{box-sizing:border-box}" +
    ".mc-btn{position:fixed;right:20px;bottom:84px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:14px 20px;border:0;border-radius:999px;background:var(--mc-accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22)}" +
    ".mc-btn:hover{filter:brightness(.95)}" +
    ".mc-btn:focus-visible,.mc-send:focus-visible,.mc-close:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}" +
    ".mc-input:focus-visible{outline:2px solid var(--mc-accent);outline-offset:1px}" +
    ".mc-panel{position:fixed;right:20px;bottom:84px;z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 104px);display:none;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}" +
    ".mc-panel.mc-open{display:flex}" +
    ".mc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;background:var(--mc-accent);color:#fff}" +
    ".mc-title{font-weight:700;font-size:16px}" +
    ".mc-sub{font-size:12px;opacity:.9}" +
    ".mc-close{border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:8px}" +
    ".mc-list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f4f8f7}" +
    ".mc-msg{max-width:85%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}" +
    ".mc-bot{align-self:flex-start;background:#fff;border:1px solid #dfe9e6;border-bottom-left-radius:4px}" +
    ".mc-user{align-self:flex-end;background:var(--mc-accent);color:#fff;border-bottom-right-radius:4px}" +
    ".mc-typing{display:inline-flex;gap:4px;align-items:center}" +
    ".mc-typing i{width:7px;height:7px;border-radius:50%;background:#9bb3ad;animation:mc-blink 1.2s infinite}" +
    ".mc-typing i:nth-child(2){animation-delay:.2s}.mc-typing i:nth-child(3){animation-delay:.4s}" +
    "@keyframes mc-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}" +
    ".mc-form{display:flex;gap:8px;padding:10px 12px 6px;background:#fff;border-top:1px solid #e3ecea}" +
    ".mc-input{flex:1;min-width:0;padding:11px 12px;border:1px solid #c9d9d5;border-radius:10px;font:inherit;color:#1c2b27;background:#fff;min-height:0;width:auto}" +
    ".mc-input::placeholder{color:#7a8c86;opacity:1}" +
    ".mc-send{padding:0 16px;border:0;border-radius:10px;background:var(--mc-accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}" +
    ".mc-send:disabled,.mc-input:disabled{opacity:.55;cursor:not-allowed}" +
    ".mc-foot{padding:2px 14px 10px;background:#fff;font-size:11.5px;color:#5d716c}" +
    ".mc-foot p{margin:3px 0}" +
    "@media (max-width:480px){.mc-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}.mc-btn{right:14px;bottom:84px}}" +
    "@media (prefers-reduced-motion:reduce){.mc-typing i{animation:none;opacity:.7}}";

  var style = document.createElement("style");
  style.setAttribute("data-myata-chat-style", "");
  style.textContent = css;
  document.head.appendChild(style);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var root = el("div", "mc-root");

  var openBtn = el("button", "mc-btn", "Задать вопрос");
  openBtn.type = "button";
  openBtn.setAttribute("aria-haspopup", "dialog");
  openBtn.setAttribute("aria-expanded", "false");

  var panel = el("div", "mc-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Чат с администратором клиники");

  var head = el("div", "mc-head");
  var headText = el("div");
  headText.appendChild(el("div", "mc-title", cfg.title));
  headText.appendChild(el("div", "mc-sub", cfg.subtitle));
  var closeBtn = el("button", "mc-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Закрыть чат");
  head.appendChild(headText);
  head.appendChild(closeBtn);

  var list = el("div", "mc-list");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");

  var form = el("form", "mc-form");
  var input = el("input", "mc-input");
  input.type = "text";
  input.maxLength = cfg.maxChars;
  input.placeholder = "Напишите вопрос…";
  input.setAttribute("aria-label", "Ваше сообщение");
  input.autocomplete = "off";
  var sendBtn = el("button", "mc-send", "Отправить");
  sendBtn.type = "submit";
  form.appendChild(input);
  form.appendChild(sendBtn);

  var foot = el("div", "mc-foot");
  foot.appendChild(el("p", "", cfg.consent));
  foot.appendChild(el("p", "", cfg.note));

  panel.appendChild(head);
  panel.appendChild(list);
  panel.appendChild(form);
  panel.appendChild(foot);
  root.appendChild(openBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  var history = []; // только сообщения посетителя и ответы ИИ (приветствие не отправляем)
  var userCount = 0;
  var leadSent = false;
  var busy = false;

  function scrollDown() {
    list.scrollTop = list.scrollHeight;
  }

  function addMsg(kind, text) {
    var m = el("div", "mc-msg " + (kind === "user" ? "mc-user" : "mc-bot"), text);
    list.appendChild(m);
    scrollDown();
    return m;
  }

  function addTyping() {
    var m = el("div", "mc-msg mc-bot");
    var dots = el("span", "mc-typing");
    dots.setAttribute("aria-label", "Печатает");
    dots.appendChild(el("i"));
    dots.appendChild(el("i"));
    dots.appendChild(el("i"));
    m.appendChild(dots);
    list.appendChild(m);
    scrollDown();
    return m;
  }

  function setBusy(v) {
    busy = v;
    input.disabled = v;
    sendBtn.disabled = v;
    if (!v) input.focus();
  }

  function phoneHint() {
    return cfg.phone ? " Позвоните нам: " + cfg.phone : "";
  }

  function saveState() {
    try {
      sessionStorage.setItem(
        "myataChat",
        JSON.stringify({ history: history, userCount: userCount, leadSent: leadSent })
      );
    } catch (e) {
      /* хранилище недоступно: ничего страшного */
    }
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem("myataChat");
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.history)) return false;
      history = s.history.slice(-40);
      userCount = Number(s.userCount) || 0;
      leadSent = s.leadSent === true;
      history.forEach(function (m) {
        if (m && typeof m.content === "string") addMsg(m.role === "user" ? "user" : "bot", m.content);
      });
      return history.length > 0;
    } catch (e) {
      return false;
    }
  }

  function send(text) {
    if (userCount >= cfg.maxUserMessages) {
      addMsg("bot", "Мы достигли лимита сообщений в этом чате." + phoneHint());
      return;
    }
    history.push({ role: "user", content: text });
    userCount += 1;
    addMsg("user", text);
    setBusy(true);
    var typing = addTyping();

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, cfg.timeoutMs) : null;

    fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-8), leadSent: leadSent }),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (data) { return { data: data || {} }; });
      })
      .then(function (r) {
        typing.remove();
        var reply = typeof r.data.reply === "string" && r.data.reply ? r.data.reply : "Не получилось получить ответ." + phoneHint();
        addMsg("bot", reply);
        if (!r.data.error) history.push({ role: "assistant", content: reply });
        if (r.data.leadSent === true) leadSent = true;
        saveState();
      })
      .catch(function () {
        typing.remove();
        addMsg("bot", "Нет связи с сервером. Попробуйте ещё раз." + phoneHint());
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        setBusy(false);
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var text = input.value.replace(/\s+/g, " ").trim();
    if (!text) return;
    input.value = "";
    send(text);
  });

  function openPanel() {
    panel.classList.add("mc-open");
    openBtn.style.display = "none";
    openBtn.setAttribute("aria-expanded", "true");
    setTimeout(function () { input.focus(); }, 0);
  }

  function closePanel() {
    panel.classList.remove("mc-open");
    openBtn.style.display = "";
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus();
  }

  openBtn.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("mc-open")) closePanel();
  });

  addMsg("bot", cfg.welcome);
  if (loadState()) scrollDown();
})();
