// Функция принимает заявку с сайта и пересылает её в Telegram.
// Токен бота и номер чата берутся из переменных окружения Netlify,
// в код они НЕ вписываются.

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

// Убираем символы, которые Telegram мог бы принять за разметку,
// и обрезаем длину, чтобы никто не прислал огромный текст.
const clean = (value, max) =>
  String(value ?? "")
    .replace(/[<>&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export default async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID");
    return json(500, { ok: false, error: "config" });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return json(400, { ok: false, error: "json" });
  }

  // Ловушка для роботов: настоящий человек это поле не видит и не заполняет.
  // Роботу отвечаем "успех", но в Telegram ничего не отправляем.
  if (data && data.website) {
    return json(200, { ok: true });
  }

  const name = clean(data?.name, 60);
  const phone = clean(data?.phone, 30);
  const service = clean(data?.service, 80);
  const digits = phone.replace(/\D/g, "");

  if (name.length < 2 || digits.length < 10 || digits.length > 15) {
    return json(400, { ok: false, error: "validation" });
  }

  const text =
    "Новая заявка с сайта «Мята»\n\n" +
    `Имя: ${name}\n` +
    `Телефон: ${phone}\n` +
    `Услуга: ${service || "не указана"}`;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      // В журнал пишем только код ответа, без токена.
      console.error("Telegram ответил кодом", resp.status);
      return json(502, { ok: false, error: "telegram" });
    }
  } catch (err) {
    console.error("Ошибка сети при отправке в Telegram");
    return json(502, { ok: false, error: "network" });
  }

  return json(200, { ok: true });
};
