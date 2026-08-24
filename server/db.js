const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "mavrocoin.db");
const db = new Database(DB_PATH);

// Включаем WAL для производительности
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Создание таблиц ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT 'Участник',
    balance_m  REAL NOT NULL DEFAULT 10000,
    pending_m  REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS requests (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    name           TEXT NOT NULL,
    amount         REAL NOT NULL,
    payment_type   TEXT NOT NULL,
    details        TEXT NOT NULL,
    comment        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'open',
    sender_id      TEXT,
    sender_name    TEXT,
    transfer_proof TEXT,
    date           TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

// ── Seed: демо-заявки если база пустая ───────────────────────
const count = db.prepare("SELECT COUNT(*) as c FROM requests").get().c;
if (count === 0) {
  const seedUserId = "demo-system";
  db.prepare("INSERT OR IGNORE INTO users (id, name, balance_m) VALUES (?, ?, ?)").run(
    seedUserId, "Система (Демо)", 0
  );

  const seed = [
    {
      id: uuidv4(),
      user_id: seedUserId,
      name: "Алексей М.",
      amount: 3500,
      payment_type: "Банковская карта (Сбер)",
      details: "4276 3801 2345 6789",
      comment: "На лечение зубов",
    },
    {
      id: uuidv4(),
      user_id: seedUserId,
      name: "Елена К.",
      amount: 7200,
      payment_type: "СБП (по номеру телефона)",
      details: "+7 916 123-45-67",
      comment: "Помощь семье с детьми",
    },
    {
      id: uuidv4(),
      user_id: seedUserId,
      name: "Дмитрий Н.",
      amount: 1500,
      payment_type: "USDT TRC20",
      details: "TRx8nBq...7kL3",
      comment: "На оплату курса обучения",
    },
  ];

  const insert = db.prepare(`
    INSERT INTO requests (id, user_id, name, amount, payment_type, details, comment, date)
    VALUES (@id, @user_id, @name, @amount, @payment_type, @details, @comment, datetime('now', 'localtime'))
  `);

  for (const row of seed) {
    insert.run(row);
  }

  console.log("[DB] Seed данные добавлены:", seed.length, "заявок");
}

// ── Хелперы ──────────────────────────────────────────────────

/** Получить или создать пользователя по ID */
function getOrCreateUser(userId) {
  let user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    db.prepare("INSERT INTO users (id, name, balance_m, pending_m) VALUES (?, ?, ?, ?)").run(
      userId, "Участник", 10000, 0
    );
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    console.log("[DB] Новый пользователь создан:", userId);
  }
  return user;
}

/** Все открытые заявки (не принадлежащие данному пользователю) */
function getOpenRequests(userId) {
  return db
    .prepare("SELECT * FROM requests WHERE status = 'open' AND user_id != ? ORDER BY date DESC")
    .all(userId);
}

/** Заявки текущего пользователя ожидающие подтверждения им как получателем */
function getIncomingRequests(userId) {
  return db
    .prepare("SELECT * FROM requests WHERE status = 'sent' AND user_id = ? ORDER BY date DESC")
    .all(userId);
}

/** Все сделки (для реестра) */
function getAllRequests(userId) {
  return db
    .prepare("SELECT * FROM requests WHERE user_id = ? OR sender_id = ? ORDER BY date DESC")
    .all(userId, userId);
}

/** Создать заявку */
function createRequest(userId, { name, amount, paymentType, details, comment }) {
  const id = uuidv4();
  const now = new Date().toLocaleString("ru-RU");
  db.prepare(`
    INSERT INTO requests (id, user_id, name, amount, payment_type, details, comment, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, amount, paymentType, details, comment || "", now);
  return db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
}

/** Отправить перевод (шаг 1) */
function sendTransfer(requestId, senderId, senderName, proof) {
  const req = db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId);
  if (!req || req.status !== "open") return null;

  const RATE = 1;
  const MULT = 1.30;
  const earnedM = req.amount * RATE;

  db.prepare(`
    UPDATE requests SET status = 'sent', sender_id = ?, sender_name = ?, transfer_proof = ?
    WHERE id = ?
  `).run(senderId, senderName, proof, requestId);

  // Увеличиваем pendingBalanceM отправителя
  db.prepare("UPDATE users SET pending_m = pending_m + ? WHERE id = ?").run(earnedM, senderId);

  const now = new Date().toLocaleString("ru-RU");
  db.prepare("INSERT INTO logs (user_id, message) VALUES (?, ?)").run(
    senderId,
    `[${now}] Перевод ${req.amount} ₽ участнику ${req.name}. Ожидается подтверждение.`
  );

  return { req: db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId), earnedM };
}

/** Подтвердить получение (шаг 2) */
function confirmTransfer(requestId, receiverId) {
  const req = db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId);
  if (!req || req.status !== "sent") return null;

  const RATE = 1;
  const earnedM = req.amount * RATE;

  db.prepare("UPDATE requests SET status = 'confirmed' WHERE id = ?").run(requestId);

  // Переносим из pending в balance у отправителя
  if (req.sender_id) {
    db.prepare(`
      UPDATE users SET
        pending_m = MAX(0, pending_m - ?),
        balance_m = balance_m + ?
      WHERE id = ?
    `).run(earnedM, earnedM, req.sender_id);
  }

  const now = new Date().toLocaleString("ru-RU");
  db.prepare("INSERT INTO logs (user_id, message) VALUES (?, ?)").run(
    receiverId,
    `[${now}] Подтверждено получение ${req.amount} ₽. +${earnedM} М° зачислено отправителю.`
  );

  return { req: db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId), earnedM };
}

/** Открыть диспут */
function rejectTransfer(requestId, receiverId) {
  const req = db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId);
  if (!req || req.status !== "sent") return null;

  const earnedM = req.amount;

  db.prepare("UPDATE requests SET status = 'dispute' WHERE id = ?").run(requestId);

  // Возвращаем pending обратно
  if (req.sender_id) {
    db.prepare("UPDATE users SET pending_m = MAX(0, pending_m - ?) WHERE id = ?").run(
      earnedM, req.sender_id
    );
  }

  return { req: db.prepare("SELECT * FROM requests WHERE id = ?").get(requestId) };
}

module.exports = {
  db,
  getOrCreateUser,
  getOpenRequests,
  getIncomingRequests,
  getAllRequests,
  createRequest,
  sendTransfer,
  confirmTransfer,
  rejectTransfer,
};
