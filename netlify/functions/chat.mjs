// Серверная функция ИИ-чата для сайта клиники «Мята».
// Адрес после публикации: /.netlify/functions/chat
//
// Что делает:
//   1. Принимает историю чата от окна на сайте.
//   2. Прячет ключ Groq (он лежит только в переменных окружения Netlify).
//   3. Ограничивает частоту и длину сообщений, чтобы не сжечь бесплатный лимит.
//   4. Вырезает служебную строку [ЗАЯВКА] из ответа и отправляет заявку в Telegram.
//
// Переменные окружения (задаются в Netlify, не в коде):
//   GROQ_API_KEY        обязательно: ключ Groq
//   TELEGRAM_BOT_TOKEN  токен Telegram-бота для заявок
//   TELEGRAM_CHAT_ID    номер чата, куда приходят заявки
//   CLINIC_PHONE        телефон клиники для запасных сообщений (необязательно)
//   CLINIC_NAME         название клиники для заявки (необязательно, по умолчанию «Мята»)
//   ALLOWED_ORIGIN      адреса сайтов через запятую, с которых разрешён чат (необязательно)

import { SYSTEM_PROMPT } from "./_lib/prompt.mjs";

const MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const LIMITS = {
  maxChars: 500, // длина одного сообщения посетителя
  maxHistory: 8, // сколько последних сообщений отправляем модели
  maxUserMessages: 12, // сообщений посетителя в одном чате
  perMinute: 8, // запросов в минуту с одного адреса
  maxBodyChars: 20000,
  groqTimeoutMs: 25000,
  telegramTimeoutMs: 10000,
};

// Счётчик частоты запросов хранится в памяти функции. Это «лёгкая» защита:
// при нескольких одновременных копиях функции счётчики не общие.
const hits = new Map();

function env(name) {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env) {
      const v = Netlify.env.get(name);
      if (v) return v;
    }
  } catch (_) {
    /* вне Netlify (тесты) берём из process.env */
  }
  return (typeof process !== "undefined" && process.env && process.env[name]) || "";
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function allowedOrigins() {
  return env("ALLOWED_ORIGIN")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(req) {
  const list = allowedOrigins();
  const origin = req.headers.get("origin");
  if (!list.length || !origin || !list.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > 60000) hits.delete(key);
    }
  }
  return recent.length > LIMITS.perMinute;
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string") continue;
    const content = m.content.replace(/\u0000/g, "").trim().slice(0, LIMITS.maxChars);
    if (content) out.push({ role: m.role, content });
  }
  return out;
}

function normalizePhone(s) {
  return String(s || "")
    .replace(/[‐-―−­]/g, "-") // «неразрывные» и длинные дефисы в обычный
    .replace(/[  ]/g, " ")
    .replace(/[.,;:!?)»”"'\s]+$/g, "")
    .replace(/[^0-9+\-() ]/g, "")
    .trim();
}

// Вырезает служебную строку [ЗАЯВКА] из ответа модели.
function extractLead(text) {
  const kept = [];
  let leadLine = null;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.search(/\[ЗАЯВКА\]/i);
    if (idx === -1) {
      kept.push(line);
      continue;
    }
    const before = line.slice(0, idx);
    if (before.trim()) kept.push(before.trimEnd());
    if (leadLine === null) leadLine = line.slice(idx + "[ЗАЯВКА]".length);
  }
  let lead = null;
  if (leadLine !== null) {
    const name = leadLine.match(/Имя:\s*([^;\n]*)/i);
    const phone = leadLine.match(/Телефон:\s*(.*)$/i);
    lead = { name: name ? name[1] : "", phone: phone ? phone[1] : "" };
  }
  return { clean: kept.join("\n").trim(), found: leadLine !== null, lead };
}

// Проверка заявки: телефон должен быть настоящим и должен встречаться в сообщениях посетителя,
// чтобы модель не могла «придумать» номер.
function validateLead(lead, userMessages) {
  if (!lead) return null;
  const name = String(lead.name || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 60);
  const phone = normalizePhone(lead.phone);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  const tail = digits.slice(-10);
  const fromVisitor = userMessages.some((m) => m.replace(/\D/g, "").includes(tail));
  if (!fromVisitor) return null;
  return { name: name || "не указано", phone };
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(lead) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("Telegram не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
    return false;
  }
  const clinic = env("CLINIC_NAME") || "Мята";
  const text =
    `Новая заявка с сайта «${clinic}»\n` +
    `Имя: ${lead.name}\n` +
    `Телефон: ${lead.phone}\n` +
    `Источник: ИИ-чат на сайте`;
  try {
    const res = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }), // без parse_mode: текст не обрабатывается как разметка
      },
      LIMITS.telegramTimeoutMs
    );
    if (!res.ok) console.error("Telegram ответил статусом", res.status);
    return res.ok;
  } catch (_) {
    console.error("Не удалось связаться с Telegram");
    return false;
  }
}

export default async (req, context) => {
  const cors = corsHeaders(req);
  const phone = env("CLINIC_PHONE") || "+7 (000) 000-00-00";
  const fail = (reply, status) => json({ reply, error: true }, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail("Метод не поддерживается.", 405);

  const list = allowedOrigins();
  const origin = req.headers.get("origin");
  if (list.length && origin && !list.includes(origin)) return fail("Доступ запрещён.", 403);

  const ip =
    (context && context.ip) ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  if (rateLimited(ip)) {
    return fail(`Вы отправляете сообщения слишком часто. Подождите минуту или позвоните нам: ${phone}`, 429);
  }

  let payload;
  try {
    const raw = await req.text();
    if (raw.length > LIMITS.maxBodyChars) return fail("Сообщение слишком длинное.", 413);
    payload = JSON.parse(raw);
  } catch (_) {
    return fail("Не удалось прочитать сообщение. Попробуйте ещё раз.", 400);
  }

  const all = cleanMessages(payload && payload.messages);
  if (!all || !all.length) return fail("Напишите, пожалуйста, ваш вопрос.", 400);

  const userCount = all.filter((m) => m.role === "user").length;
  if (userCount > LIMITS.maxUserMessages) {
    return fail(`Мы достигли лимита сообщений в этом чате. Позвоните нам: ${phone}`, 200);
  }

  let history = all.slice(-LIMITS.maxHistory);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") {
    return fail("Напишите, пожалуйста, ваш вопрос.", 400);
  }

  const apiKey = env("GROQ_API_KEY");
  if (!apiKey) {
    console.error("GROQ_API_KEY не задан");
    return fail(`Сейчас чат недоступен. Позвоните нам: ${phone}`, 500);
  }

  let reply = "";
  try {
    const res = await fetchWithTimeout(
      GROQ_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
          temperature: 0.3,
          max_completion_tokens: 800,
          reasoning_effort: "low",
          stream: false,
        }),
      },
      LIMITS.groqTimeoutMs
    );
    if (res.status === 429) {
      console.error("Groq: превышен лимит (429)");
      return fail(`Сейчас много обращений. Попробуйте через минуту или позвоните нам: ${phone}`, 200);
    }
    if (!res.ok) {
      console.error("Groq ответил статусом", res.status);
      return fail(`Сейчас чат недоступен. Позвоните нам: ${phone}`, 200);
    }
    const data = await res.json();
    reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  } catch (_) {
    console.error("Не удалось получить ответ от Groq");
    return fail(`Сейчас чат недоступен. Позвоните нам: ${phone}`, 200);
  }

  const { clean, found, lead } = extractLead(String(reply));
  let text = clean;
  let leadSent = false;

  if (found) {
    const userMessages = all.filter((m) => m.role === "user").map((m) => m.content);
    const valid = validateLead(lead, userMessages);
    if (!valid) {
      text = "Кажется, в номере телефона ошибка. Напишите, пожалуйста, имя и номер ещё раз.";
    } else if (payload.leadSent === true) {
      leadSent = true; // заявка уже была отправлена в этом чате, второй раз не шлём
    } else if (await sendTelegram(valid)) {
      leadSent = true;
    } else {
      text = `Не получилось передать заявку. Пожалуйста, позвоните нам: ${phone}`;
    }
  }

  if (!text) text = "Спасибо! Администратор свяжется с вами в рабочее время";
  return json({ reply: text.slice(0, 1500), leadSent }, 200, cors);
};
