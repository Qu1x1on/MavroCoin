// ==============================================================================
// MavroCoin P2P — Telegram Mini App
// 1 Мавро (М°) = 1 рубль оказанной помощи (1 М° = 1 ₽)
// Идентификация участников через Telegram WebApp API
// ==============================================================================

const RATE_RUB_PER_M = 1;
const ASSISTANCE_LIMIT_MULTIPLIER = 1.30;
const STARTER_INVITE_LIMIT_RUB = 1000;

// Supabase конфигурация
const SUPABASE_URL = "https://uigojqsnyiekutccyscw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpZ29qcXNueWlla3V0Y2N5c2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMzYyOTAsImV4cCI6MjEwMjcxMjI5MH0.HWZNGCTwlBtNqiPoT7iaUrtcf5iaaD1PQV2u28YpvgE";

let supabaseClient = null;
let isSupabaseConnected = false;

// ==============================================================================
// TELEGRAM MINI APP — ИДЕНТИФИКАЦИЯ ПОЛЬЗОВАТЕЛЯ
// ==============================================================================

// Ссылка на Telegram WebApp (если открыто внутри Telegram)
const TG = window.Telegram?.WebApp;

// Глобальный объект текущего TG-пользователя
let currentTgUser = null;

function initTelegramUser() {
  const rawUser = TG?.initDataUnsafe?.user;

  if (rawUser && rawUser.id) {
    // Реальный Telegram-пользователь
    currentTgUser = {
      id: String(rawUser.id),
      name: [rawUser.first_name, rawUser.last_name].filter(Boolean).join(" "),
      username: rawUser.username || null,
      photo_url: rawUser.photo_url || null,
      telegram_id: String(rawUser.id)
    };
    localStorage.setItem("mavro_user_id", currentTgUser.id);
    console.log("✅ Telegram user identified:", currentTgUser.name, currentTgUser.username);
  } else {
    // Фоллбэк: открыто в браузере вне Telegram (режим разработки)
    let uid = localStorage.getItem("mavro_user_id");
    if (!uid || uid.startsWith("usr-")) {
      uid = "tg-" + Math.random().toString(36).substring(2, 8);
      localStorage.setItem("mavro_user_id", uid);
    }
    currentTgUser = {
      id: uid,
      name: "Тест-участник",
      username: "telegram_user",
      photo_url: null,
      telegram_id: uid
    };
    console.warn("⚠️ Telegram WebApp не обнаружен. Работает в режиме разработки.");
  }

  return currentTgUser.id;
}

// Инициализируем пользователя сразу
let currentUserId = initTelegramUser();

// Отображаемое имя текущего пользователя
function getMyDisplayName() {
  if (!currentTgUser) return "Участник";
  return currentTgUser.username ? `${currentTgUser.name} (@${currentTgUser.username})` : currentTgUser.name;
}

// Haptic feedback (только в Telegram)
function haptic(type = "impact", style = "light") {
  try {
    if (type === "impact") TG?.HapticFeedback?.impactOccurred(style);
    else if (type === "notification") TG?.HapticFeedback?.notificationOccurred(style);
    else if (type === "selection") TG?.HapticFeedback?.selectionChanged();
  } catch (_) {}
}

// Начальное состояние — реальные участники загружаются из Supabase
function buildDefaultState() {
  return {
    userBalanceM: 0.00,
    pendingBalanceM: 0.00,
    invitedFriendsCount: 0,
    starterBonusUnlocked: false,
    dailyDealsBase: 0,
    users: [
      {
        id: currentUserId,
        name: currentTgUser?.name || "Участник",
        username: currentTgUser?.username || null,
        photo_url: currentTgUser?.photo_url || null,
        telegram_id: currentTgUser?.telegram_id || null,
        balance_m: 0.00,
        pending_m: 0.00
      }
    ],
    requests: []
  };
}

const DEFAULT_STATE = buildDefaultState();

let appState = loadState();
let selectedRequestId = null;

function loadState() {
  const saved = localStorage.getItem("mavro_telegram_p2p_v1");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.users)) {
        // Очищаем старые демо/временные аккаунты из прошлых сессий
        parsed.users = parsed.users.filter(u => u.id === currentUserId || (!u.id.startsWith("usr-") && !u.id.startsWith("demo-")));
      } else {
        parsed.users = [];
      }

      let me = parsed.users.find(u => u.id === currentUserId);
      if (!me) {
        parsed.users.unshift({
          id: currentUserId,
          name: currentTgUser?.name || "Участник",
          username: currentTgUser?.username || null,
          photo_url: currentTgUser?.photo_url || null,
          telegram_id: currentTgUser?.telegram_id || null,
          balance_m: parsed.userBalanceM || 0,
          pending_m: parsed.pendingBalanceM || 0
        });
      } else {
        // Актуализируем данные Telegram
        me.name = currentTgUser?.name || me.name;
        me.username = currentTgUser?.username || me.username;
        me.photo_url = currentTgUser?.photo_url || me.photo_url;
        me.telegram_id = currentTgUser?.telegram_id || me.telegram_id;
        me.balance_m = parsed.userBalanceM || 0;
        me.pending_m = parsed.pendingBalanceM || 0;
      }
      return parsed;
    } catch (e) {
      console.error("Ошибка чтения сохраненных данных", e);
    }
  }
  return buildDefaultState();
}

function saveState() {
  // Очищаем любых фантомных пользователей перед сохранением
  if (Array.isArray(appState.users)) {
    appState.users = appState.users.filter(u => u.id === currentUserId || (!u.id.startsWith("usr-") && !u.id.startsWith("demo-")));
  }

  let me = appState.users.find(u => u.id === currentUserId);
  if (me) {
    me.balance_m = appState.userBalanceM;
    me.pending_m = appState.pendingBalanceM;
    if (currentTgUser) {
      me.name = currentTgUser.name;
      me.username = currentTgUser.username;
      me.photo_url = currentTgUser.photo_url;
      me.telegram_id = currentTgUser.telegram_id;
    }
  } else {
    appState.users.unshift({
      id: currentUserId,
      name: currentTgUser?.name || "Участник",
      username: currentTgUser?.username || null,
      photo_url: currentTgUser?.photo_url || null,
      telegram_id: currentTgUser?.telegram_id || null,
      balance_m: appState.userBalanceM,
      pending_m: appState.pendingBalanceM
    });
  }

  localStorage.setItem("mavro_telegram_p2p_v1", JSON.stringify(appState));
  renderAll();
}

function updateDbStatusBadge(status, message) {
  const badge = document.getElementById("db-status-badge");
  const dot = document.getElementById("db-dot");
  const text = document.getElementById("db-status-text");

  if (!badge || !dot || !text) return;

  if (status === "live") {
    dot.style.backgroundColor = "#3ecf8e";
    text.innerHTML = `БД: <strong style="color: #3ecf8e;">Supabase Live</strong>`;
    badge.title = "Подключено к Supabase Database. Все данные синхронизируются в реальном времени.";
  } else if (status === "connecting") {
    dot.style.backgroundColor = "#ff9500";
    text.innerHTML = `БД: <strong style="color: #ff9500;">Подключение...</strong>`;
  } else {
    dot.style.backgroundColor = "#c9a84c";
    text.innerHTML = `БД: <strong style="color: #c9a84c;">Локальный режим</strong>`;
    badge.title = message || "Работает в локальном режиме. Выполните supabase_setup.sql в Supabase SQL Editor для полной синхронизации.";
  }
}

// ==============================================================================
// РАСЧЕТ ЛИМИТОВ И РАЗМОРОЗКА
// ==============================================================================

function getRequestLimitRub() {
  if (appState.userBalanceM > 0) {
    return Math.floor(appState.userBalanceM * ASSISTANCE_LIMIT_MULTIPLIER);
  }
  // Если баланс 0, но приглашен друг или разблокирован стартовый бонус
  if (appState.starterBonusUnlocked || appState.invitedFriendsCount > 0) {
    return STARTER_INVITE_LIMIT_RUB;
  }
  return 0;
}

function reconcilePendingBalances(notify = false) {
  let changed = false;

  const actualSentPending = appState.requests
    .filter(r => (r.sender_id === currentUserId || (r.senderName && r.senderName.includes("Вы"))) && r.status === "sent")
    .reduce((sum, r) => sum + (r.amount * RATE_RUB_PER_M), 0);

  if (appState.pendingBalanceM > actualSentPending) {
    const diff = appState.pendingBalanceM - actualSentPending;
    appState.userBalanceM += diff;
    appState.pendingBalanceM = actualSentPending;
    changed = true;
  } else if (appState.pendingBalanceM < actualSentPending) {
    appState.pendingBalanceM = actualSentPending;
    changed = true;
  }

  appState.users.forEach(u => {
    if (u.id === currentUserId) {
      u.balance_m = appState.userBalanceM;
      u.pending_m = appState.pendingBalanceM;
      return;
    }
    const uSentPending = appState.requests
      .filter(r => (r.sender_id === u.id || (r.senderName && r.senderName.includes(u.name))) && r.status === "sent")
      .reduce((sum, r) => sum + (r.amount * RATE_RUB_PER_M), 0);

    if (u.pending_m > uSentPending) {
      const diff = u.pending_m - uSentPending;
      u.balance_m += diff;
      u.pending_m = uSentPending;
      changed = true;
    }
  });

  if (changed) {
    saveState();
    if (supabaseClient && isSupabaseConnected) {
      supabaseClient
        .from("mavro_users")
        .update({
          balance_m: appState.userBalanceM,
          pending_m: appState.pendingBalanceM
        })
        .eq("id", currentUserId)
        .then(() => {});
    }
  }

  if (notify) {
    showAdminToast("⚡ Балансы сверены! Все подтвержденные сделки разморожены.");
  }
}

// ==============================================================================
// SUPABASE REALTIME & DATABASE SYNC
// ==============================================================================

async function initSupabase() {
  updateDbStatusBadge("connecting");
  try {
    if (typeof window.supabase !== "undefined" && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    if (!supabaseClient) {
      updateDbStatusBadge("local", "SDK не загружен");
      reconcilePendingBalances();
      return;
    }

    const { data: testData, error: testError } = await supabaseClient
      .from("mavro_requests")
      .select("*")
      .limit(1);

    if (testError) {
      updateDbStatusBadge("local", "Выполните supabase_setup.sql в Supabase SQL Editor");
      reconcilePendingBalances();
      return;
    }

    isSupabaseConnected = true;
    updateDbStatusBadge("live");

    await syncUserWithSupabase();
    await fetchRequestsFromSupabase();
    await fetchAllUsersFromSupabase();
    reconcilePendingBalances();

    supabaseClient
      .channel("public:mavro_requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "mavro_requests" }, () => {
        fetchRequestsFromSupabase();
      })
      .subscribe();

    supabaseClient
      .channel("public:mavro_users")
      .on("postgres_changes", { event: "*", schema: "public", table: "mavro_users" }, () => {
        syncUserWithSupabase();
        fetchAllUsersFromSupabase();
      })
      .subscribe();

  } catch (err) {
    console.error("Ошибка инициализации Supabase:", err);
    updateDbStatusBadge("local", err.message);
    reconcilePendingBalances();
  }
}

async function syncUserWithSupabase() {
  if (!supabaseClient || !isSupabaseConnected) return;

  const displayName = currentTgUser ? currentTgUser.name : "Участник";

  try {
    const { data, error } = await supabaseClient
      .from("mavro_users")
      .select("*")
      .eq("id", currentUserId)
      .single();

    if (error && error.code === "PGRST116") {
      // Новый пользователь — регистрируем
      let insertPayload = {
        id: currentUserId,
        name: displayName,
        username: currentTgUser?.username || null,
        photo_url: currentTgUser?.photo_url || null,
        telegram_id: currentTgUser?.telegram_id || null,
        balance_m: appState.userBalanceM || 0,
        pending_m: appState.pendingBalanceM || 0
      };

      let { data: newUser, error: insertError } = await supabaseClient
        .from("mavro_users")
        .insert([insertPayload])
        .select()
        .single();

      // Если в БД еще не добавлены колонки username/photo_url — делаем базовый insert
      if (insertError) {
        console.warn("Retrying with base columns:", insertError.message);
        const { data: baseUser } = await supabaseClient
          .from("mavro_users")
          .insert([{
            id: currentUserId,
            name: displayName,
            balance_m: appState.userBalanceM || 0,
            pending_m: appState.pendingBalanceM || 0
          }])
          .select()
          .single();
        newUser = baseUser;
      }

      if (newUser) {
        appState.userBalanceM = Number(newUser.balance_m);
        appState.pendingBalanceM = Number(newUser.pending_m);
        saveState();
      }
    } else if (data) {
      // Пользователь найден — обновляем TG-данные и загружаем баланс
      appState.userBalanceM = Number(data.balance_m);
      appState.pendingBalanceM = Number(data.pending_m);

      // Обновляем TG-профиль в базе
      const updatePayload = {
        name: displayName,
        username: currentTgUser?.username || data.username,
        photo_url: currentTgUser?.photo_url || data.photo_url,
        telegram_id: currentTgUser?.telegram_id || data.telegram_id
      };

      const { error: updateError } = await supabaseClient
        .from("mavro_users")
        .update(updatePayload)
        .eq("id", currentUserId);

      if (updateError) {
        // Фоллбэк на обновление только имени
        await supabaseClient
          .from("mavro_users")
          .update({ name: displayName })
          .eq("id", currentUserId);
      }

      saveState();
    }
  } catch (err) {
    console.warn("Ошибка syncUserWithSupabase:", err);
  }
}

async function fetchRequestsFromSupabase() {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    const { data, error } = await supabaseClient
      .from("mavro_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      appState.requests = data.map(row => {
        const isMySent = row.sender_id === currentUserId;
        const senderDisplayName = isMySent
          ? (currentTgUser ? currentTgUser.name : "Вы (Текущий аккаунт)")
          : (row.sender_name || (row.sender_id ? "Участник (" + row.sender_id.slice(-4) + ")" : null));

        return {
          id: row.id,
          user_id: row.user_id,
          name: row.name,
          amount: Number(row.amount),
          paymentType: row.payment_type,
          details: row.details,
          comment: row.comment || "",
          date: row.date,
          status: row.status,
          sender_id: row.sender_id,
          senderName: senderDisplayName,
          transferProof: row.transfer_proof,
          isMine: row.user_id === currentUserId
        };
      });

      reconcilePendingBalances();
      saveState();
    }
  } catch (err) {
    console.error("Ошибка fetchRequestsFromSupabase:", err);
  }
}

async function fetchAllUsersFromSupabase() {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    const { data, error } = await supabaseClient
      .from("mavro_users")
      .select("*")
      .order("balance_m", { ascending: false });

    if (!error && data && data.length > 0) {
      // Исключаем старые демо/временные аккаунты из прошлых тестов
      const validUsers = data.filter(u => !u.id.startsWith("demo-") && !u.id.startsWith("usr-"));

      appState.users = validUsers.map(dbUser => {
        const isMe = dbUser.id === currentUserId;
        return {
          id: dbUser.id,
          name: isMe ? (currentTgUser?.name || dbUser.name) : dbUser.name,
          username: isMe ? (currentTgUser?.username || dbUser.username) : dbUser.username,
          photo_url: isMe ? (currentTgUser?.photo_url || dbUser.photo_url) : dbUser.photo_url,
          telegram_id: dbUser.telegram_id || null,
          balance_m: Number(dbUser.balance_m || 0),
          pending_m: Number(dbUser.pending_m || 0)
        };
      });

      // Гарантируем наличие текущего пользователя в списке
      if (!appState.users.some(u => u.id === currentUserId)) {
        appState.users.unshift({
          id: currentUserId,
          name: currentTgUser?.name || "Участник",
          username: currentTgUser?.username || null,
          photo_url: currentTgUser?.photo_url || null,
          telegram_id: currentTgUser?.telegram_id || null,
          balance_m: appState.userBalanceM,
          pending_m: appState.pendingBalanceM
        });
      }

      saveState();
    }
  } catch (e) {
    console.warn("Ошибка fetchAllUsersFromSupabase:", e);
  }
}

// ==============================================================================
// НАВИГАЦИЯ И РЕНДЕР
// ==============================================================================

function switchTab(tabId) {
  haptic("selection");
  document.querySelectorAll(".bottom-tab-btn, .seg-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));

  const targetBtn = document.getElementById(`btn-${tabId}`);
  if (targetBtn) targetBtn.classList.add("active");

  const targetContent = document.getElementById(tabId);
  if (targetContent) {
    targetContent.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (tabId === "tab-leaders") renderLeaderboard();
  if (tabId === "tab-history") renderPublicHistory();
}

function copyRequisites(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.textContent;
    btnElement.textContent = "Скопировано!";
    btnElement.style.backgroundColor = "#e8f8ec";
    btnElement.style.color = "#1f7a37";
    setTimeout(() => {
      btnElement.textContent = originalText;
      btnElement.style.backgroundColor = "";
      btnElement.style.color = "";
    }, 1500);
  }).catch(() => {
    alert("Реквизиты: " + text);
  });
}

function renderAll() {
  // 1. Балансы в шапке
  const userBalanceElem = document.getElementById("user-m-balance");
  const userPendingElem = document.getElementById("user-m-pending");
  const userLimitElem = document.getElementById("user-req-limit");
  const userLimitSubtext = document.getElementById("user-limit-subtext");
  const amountHintElem = document.getElementById("amount-hint");
  const dailyDealsElem = document.getElementById("daily-deals-counter");

  const limitRub = getRequestLimitRub();

  if (userBalanceElem) {
    userBalanceElem.textContent = `${appState.userBalanceM.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} М°`;
  }
  
  if (userPendingElem) {
    userPendingElem.textContent = `${appState.pendingBalanceM.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} М°`;
  }
  
  if (userLimitElem) {
    userLimitElem.textContent = `${limitRub.toLocaleString("ru-RU")} ₽`;
  }

  if (userLimitSubtext) {
    if (appState.userBalanceM > 0) {
      userLimitSubtext.textContent = `Доступно к выводу (+30% к ${appState.userBalanceM.toLocaleString("ru-RU")} М°)`;
    } else if (limitRub > 0) {
      userLimitSubtext.textContent = `Стартовый лимит за друга: ${limitRub.toLocaleString("ru-RU")} ₽`;
    } else {
      userLimitSubtext.textContent = `Окажите помощь или пригласите друга`;
    }
  }

  if (amountHintElem) {
    if (limitRub > 0) {
      amountHintElem.style.color = "var(--text-muted)";
      amountHintElem.textContent = `Доступно к запросу: ${limitRub.toLocaleString("ru-RU")} ₽`;
    } else {
      amountHintElem.style.color = "var(--text-muted)";
      amountHintElem.textContent = `Текущий лимит: 0 ₽. Окажите помощь или пригласите друга для открытия лимита 1 000 ₽.`;
    }
  }

  // Общее число сделок за день
  if (dailyDealsElem) {
    const confirmedCount = appState.requests.filter(r => r.status === "confirmed").length;
    dailyDealsElem.textContent = (appState.dailyDealsBase || 0) + confirmedCount;
  }

  // Обновление Telegram Профиля в шапке
  const headerUsersElem = document.getElementById("header-users-count");
  if (headerUsersElem) {
    headerUsersElem.textContent = `${appState.users.length} участников`;
  }

  const tgNameElem = document.getElementById("tg-user-name");
  const tgSubElem = document.getElementById("tg-user-sub");
  const tgAvatarElem = document.getElementById("tg-user-avatar");
  if (tgNameElem && currentTgUser) {
    tgNameElem.textContent = currentTgUser.name;
    if (tgSubElem) {
      tgSubElem.textContent = currentTgUser.username ? "@" + currentTgUser.username : "ID: " + currentUserId.slice(0, 6);
    }
    if (tgAvatarElem) {
      if (currentTgUser.photo_url) {
        tgAvatarElem.style.backgroundImage = `url(${currentTgUser.photo_url})`;
        tgAvatarElem.style.backgroundSize = "cover";
        tgAvatarElem.textContent = "";
      } else {
        tgAvatarElem.style.backgroundImage = "";
        tgAvatarElem.textContent = (currentTgUser.name || "У").charAt(0).toUpperCase();
      }
    }
  }

  // Предзаполнение имени в форме запроса
  const reqNameInput = document.getElementById("req-name");
  if (reqNameInput && !reqNameInput.value && currentTgUser) {
    reqNameInput.value = currentTgUser.username ? `${currentTgUser.name} (@${currentTgUser.username})` : currentTgUser.name;
  }

  // 2. Список "Оказать помощь" (чужие открытые заявки)
  const giveListElem = document.getElementById("give-help-list");
  const openRequests = appState.requests.filter(r => !r.isMine && r.status === "open");
  const reqBadge = document.getElementById("requests-count-badge");
  if (reqBadge) reqBadge.textContent = `Доступно: ${openRequests.length}`;

  if (giveListElem) {
    if (openRequests.length === 0) {
      giveListElem.innerHTML = `
        <div class="empty-placeholder">
          🎉 <strong>Все текущие заявки уже закрыты!</strong><br>
          Вы можете запросить помощь для себя или посмотреть завершенные сделки во вкладке «Общая история сделок».
        </div>
      `;
    } else {
      giveListElem.innerHTML = openRequests.map(req => {
        const earnedM = req.amount * RATE_RUB_PER_M;
        const boostLimit = Math.floor(earnedM * ASSISTANCE_LIMIT_MULTIPLIER);
        
        return `
          <div class="req-item-card">
            <div class="req-row-top">
              <div class="req-person">
                ${escapeHtml(req.name)}
                <span class="req-reward-badge">+${earnedM.toLocaleString("ru-RU")} М°</span>
              </div>
              <div class="req-sum">${req.amount.toLocaleString("ru-RU")} ₽</div>
            </div>
            
            <div class="req-info-grid">
              <div class="info-snippet"><strong>Способ:</strong> ${escapeHtml(req.paymentType)}</div>
              <div class="info-snippet"><strong>Цель:</strong> ${escapeHtml(req.comment)}</div>
              <div class="info-snippet"><strong>Лимит после перевода:</strong> +${boostLimit.toLocaleString("ru-RU")} ₽ (+30%)</div>
            </div>

            <div class="requisites-box">
              <span><strong>Реквизиты:</strong> ${escapeHtml(req.details)}</span>
              <button type="button" class="btn-copy" onclick="copyRequisites('${escapeHtml(req.details)}', this)">Скопировать</button>
            </div>

            <div class="req-row-bottom">
              <div>
                <span class="status-pill open">🟡 Ожидает перевода</span>
                <span style="color: #86868b; font-size: 12px; margin-left: 8px;">${escapeHtml(req.date)}</span>
              </div>
              <div>
                <button class="btn-apple" onclick="openHelpModal('${req.id}')">
                  Оказать помощь на ${req.amount.toLocaleString("ru-RU")} ₽ ➔
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 3. Входящие подтверждения
  const incomingListElem = document.getElementById("incoming-transfers-list");
  const sentRequests = appState.requests.filter(r => r.status === "sent");
  
  const incomingBadge = document.getElementById("incoming-count-badge");
  if (incomingBadge) {
    incomingBadge.textContent = sentRequests.length;
    incomingBadge.style.display = sentRequests.length > 0 ? "flex" : "none";
  }

  if (incomingListElem) {
    if (sentRequests.length === 0) {
      incomingListElem.innerHTML = `
        <div class="empty-placeholder">
          Нет заявок, ожидающих подтверждения второй стороны.<br>
          <em>Окажите помощь по открытой заявке в первом разделе для проверки перевода.</em>
        </div>
      `;
    } else {
      incomingListElem.innerHTML = sentRequests.map(req => {
        const earnedM = req.amount * RATE_RUB_PER_M;
        return `
          <div class="req-item-card pending-verification">
            <div class="req-row-top">
              <div class="req-person">Получатель: ${escapeHtml(req.name)} (${escapeHtml(req.paymentType)})</div>
              <div class="req-sum">${req.amount.toLocaleString("ru-RU")} ₽</div>
            </div>
            
            <div style="background-color: #fff9ed; border: 1px dashed #ff9500; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px;">
              <strong>🔔 Входящее уведомление о переводе:</strong><br>
              Отправитель: <strong>${escapeHtml(req.senderName || "Участник MavroCoin")}</strong><br>
              Номер чека / квитанция: <code>${escapeHtml(req.transferProof || "Без номера")}</code><br>
              Зачисление на: <code>${escapeHtml(req.details)}</code>
            </div>

            <div class="req-row-bottom">
              <span class="status-pill sent">🟠 Требуется подтверждение получения</span>
              <div style="display: flex; gap: 8px;">
                <button class="btn-apple" onclick="receiverConfirmTransfer('${req.id}')">
                  ✅ Подтвердить получение (+${earnedM.toLocaleString("ru-RU")} М°)
                </button>
                <button class="btn-apple btn-apple-danger" onclick="receiverRejectTransfer('${req.id}')">
                  ❌ Не поступили
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 4. Таблица лидеров и история
  renderLeaderboard();
  renderPublicHistory();

  // Счетчики админки
  const adminReqCount = document.getElementById("admin-req-total-count");
  if (adminReqCount) adminReqCount.textContent = appState.requests.length;
}

// ==============================================================================
// ТАБЛИЦА ЛИДЕРОВ УЧАСТНИКОВ (LEADERBOARD)
// ==============================================================================

function renderLeaderboard() {
  const container = document.getElementById("leaderboard-list");
  const podiumContainer = document.getElementById("leaders-podium");
  const myRankBanner = document.getElementById("my-rank-banner");
  const countBadge = document.getElementById("leaders-count-badge");

  if (!container) return;

  // Сортируем пользователей по балансу М° (от большего к меньшему)
  const sortedUsers = [...appState.users].sort((a, b) => (b.balance_m || 0) - (a.balance_m || 0));

  if (countBadge) countBadge.textContent = sortedUsers.length;

  const renderAvatar = (user, className) => {
    if (user.photo_url) {
      return `<div class="${className}" style="background-image: url('${escapeHtml(user.photo_url)}'); background-size: cover; background-position: center;"></div>`;
    }
    const initial = (user.name || "У").charAt(0).toUpperCase();
    return `<div class="${className}">${escapeHtml(initial)}</div>`;
  };

  // 1. Топ-3 пьедестал (1st, 2nd, 3rd)
  if (podiumContainer) {
    if (sortedUsers.length >= 3) {
      const first = sortedUsers[0];
      const second = sortedUsers[1];
      const third = sortedUsers[2];

      podiumContainer.innerHTML = `
        <!-- 2 МЕСТО -->
        <div class="podium-step step-2">
          <div class="podium-avatar-wrap">
            ${renderAvatar(second, "podium-avatar")}
            <span class="podium-rank-tag">2</span>
          </div>
          <div class="podium-name">${escapeHtml(second.name)}</div>
          ${second.username ? `<div style="font-size: 10px; color: #229ED9; font-weight: 600;">@${escapeHtml(second.username)}</div>` : ''}
          <div class="podium-m-badge">${(second.balance_m || 0).toLocaleString("ru-RU")} М°</div>
          <div class="podium-pillar">2</div>
        </div>

        <!-- 1 МЕСТО -->
        <div class="podium-step step-1">
          <div class="podium-avatar-wrap">
            <span class="podium-crown">👑</span>
            ${renderAvatar(first, "podium-avatar")}
            <span class="podium-rank-tag">1</span>
          </div>
          <div class="podium-name">${escapeHtml(first.name)}</div>
          ${first.username ? `<div style="font-size: 10px; color: #229ED9; font-weight: 600;">@${escapeHtml(first.username)}</div>` : ''}
          <div class="podium-m-badge">${(first.balance_m || 0).toLocaleString("ru-RU")} М°</div>
          <div class="podium-pillar">1</div>
        </div>

        <!-- 3 МЕСТО -->
        <div class="podium-step step-3">
          <div class="podium-avatar-wrap">
            ${renderAvatar(third, "podium-avatar")}
            <span class="podium-rank-tag">3</span>
          </div>
          <div class="podium-name">${escapeHtml(third.name)}</div>
          ${third.username ? `<div style="font-size: 10px; color: #229ED9; font-weight: 600;">@${escapeHtml(third.username)}</div>` : ''}
          <div class="podium-m-badge">${(third.balance_m || 0).toLocaleString("ru-RU")} М°</div>
          <div class="podium-pillar">3</div>
        </div>
      `;
    } else {
      podiumContainer.innerHTML = `
        <div style="text-align: center; padding: 18px 12px; color: var(--text-muted); font-size: 12.5px; width: 100%; background: var(--surface); border-radius: 12px; border: 1px dashed var(--border);">
          🏆 Таблица лидеров формируется из участников Telegram. Окажите помощь первым, чтобы занять 1 место!
        </div>
      `;
    }
  }

  // 2. Баннер позиции текущего пользователя
  if (myRankBanner) {
    const myIndex = sortedUsers.findIndex(u => u.id === currentUserId);
    const myRank = myIndex > -1 ? myIndex + 1 : sortedUsers.length;
    const myLimit = getRequestLimitRub();

    myRankBanner.innerHTML = `
      <div class="my-rank-left">
        <div class="my-rank-badge">#${myRank}</div>
        <div class="my-rank-text">
          <strong>Ваша позиция в рейтинге</strong>
          <span>Лимит на вывод: ${myLimit.toLocaleString("ru-RU")} ₽ (+30%)</span>
        </div>
      </div>
      <div class="my-rank-right">
        <div class="my-rank-val">${(appState.userBalanceM || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} М°</div>
        <button class="btn-apple btn-apple-gold" style="padding: 4px 10px; font-size: 11px; margin-top: 4px;" onclick="switchTab('tab-give')">
          Поднять ➔
        </button>
      </div>
    `;
  }

  // 3. Полный список участников
  if (sortedUsers.length === 0) {
    container.innerHTML = `<div class="empty-placeholder">Участники рейтинга пока отсутствуют.</div>`;
    return;
  }

  container.innerHTML = sortedUsers.map((user, index) => {
    const isMe = user.id === currentUserId;
    const rank = index + 1;
    let rankBadge = `${rank}`;
    let rankClass = "";

    if (rank === 1) { rankBadge = "🥇 1"; rankClass = "rank-1"; }
    else if (rank === 2) { rankBadge = "🥈 2"; rankClass = "rank-2"; }
    else if (rank === 3) { rankBadge = "🥉 3"; rankClass = "rank-3"; }

    const limitRub = Math.floor((user.balance_m || 0) * ASSISTANCE_LIMIT_MULTIPLIER);
    const handleText = user.username ? `@${escapeHtml(user.username)}` : `ID: ${escapeHtml(user.id.slice(0, 8))}...`;

    return `
      <div class="leaderboard-card ${isMe ? 'current-user-rank' : ''}">
        <div class="leaderboard-left">
          <div class="leaderboard-rank ${rankClass}">${rankBadge}</div>
          ${renderAvatar(user, "leaderboard-avatar")}
          <div>
            <div class="leaderboard-name">
              ${escapeHtml(user.name)}
              ${isMe ? '<span class="req-reward-badge" style="background: var(--accent); color: #fff; padding: 2px 6px; border-radius: 4px;">ВЫ</span>' : ''}
            </div>
            <div class="leaderboard-sub">${handleText} · ⭐ 5.0</div>
          </div>
        </div>

        <div class="leaderboard-right">
          <div class="leaderboard-bal-m">${(user.balance_m || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} М°</div>
          <div class="leaderboard-limit-rub">Лимит: ${limitRub.toLocaleString("ru-RU")} ₽</div>
        </div>
      </div>
    `;
  }).join("");
}

// ==============================================================================
// ОБЩАЯ ИСТОРИЯ ОКАЗАНИЯ ПОМОЩИ И СДЕЛОК
// ==============================================================================

function renderPublicHistory() {
  const listElem = document.getElementById("public-history-list");
  const badgeElem = document.getElementById("deals-count-badge");
  if (!listElem) return;

  const allRequests = appState.requests;
  if (badgeElem) badgeElem.textContent = `Всего записей: ${allRequests.length}`;

  if (allRequests.length === 0) {
    listElem.innerHTML = `<div class="empty-placeholder">История сделок пока пуста.</div>`;
    return;
  }

  listElem.innerHTML = allRequests.map(req => {
    let statusPill = "";
    if (req.status === "confirmed") {
      statusPill = `<span class="status-pill confirmed">🟢 Сделка успешно подтверждена и закрыта</span>`;
    } else if (req.status === "sent") {
      statusPill = `<span class="status-pill sent">🟠 Перевод отправлен — проверка получателем</span>`;
    } else if (req.status === "open") {
      statusPill = `<span class="status-pill open">🟡 Ожидает перевода помощи</span>`;
    } else {
      statusPill = `<span class="status-pill dispute">🔴 Диспут</span>`;
    }

    return `
      <div class="req-item-card ${req.status === 'confirmed' ? 'completed' : ''} ${req.isMine ? 'my-card' : ''}">
        <div class="req-row-top">
          <div class="req-person">
            ${req.status === 'confirmed' ? '🤝 Оказана помощь участнику: ' : 'Запрос помощи: '}
            <strong>${escapeHtml(req.name)}</strong>
          </div>
          <div class="req-sum" style="color: ${req.status === 'confirmed' ? '#1a7f4b' : 'var(--navy)'};">
            ${req.amount.toLocaleString("ru-RU")} ₽
          </div>
        </div>

        <div class="req-info-grid">
          <div class="info-snippet"><strong>Получатель:</strong> ${escapeHtml(req.name)} (${escapeHtml(req.paymentType)})</div>
          <div class="info-snippet"><strong>Отправитель:</strong> ${escapeHtml(req.senderName || "—")}</div>
          <div class="info-snippet"><strong>Чек / Квитанция:</strong> <code>${escapeHtml(req.transferProof || "Ожидает")}</code></div>
          <div class="info-snippet"><strong>Цель:</strong> ${escapeHtml(req.comment || "Взаимопомощь")}</div>
        </div>

        <div class="requisites-box">
          <span><strong>Реквизиты:</strong> ${escapeHtml(req.details)}</span>
          <span style="color: var(--text-muted); font-size: 11px;">ID: ${escapeHtml(req.id)}</span>
        </div>

        <div class="req-row-bottom">
          ${statusPill}
          <span style="color: #8fa3b3; font-size: 12px; font-weight: 500;">⏱️ Время сделки: <strong>${escapeHtml(req.date)}</strong></span>
        </div>
      </div>
    `;
  }).join("");
}

// ==============================================================================
// РЕФЕРАЛЬНАЯ СИСТЕМА (ПРИГЛАСИТЬ ДРУГА)
// ==============================================================================

function openInviteModal() {
  const linkInput = document.getElementById("invite-link-input");
  const countText = document.getElementById("invite-count-text");
  const bonusStatus = document.getElementById("invite-bonus-status");

  if (linkInput) {
    linkInput.value = `https://mavrocoin.p2p/?ref=${currentUserId}`;
  }

  if (countText) {
    countText.textContent = appState.invitedFriendsCount || 0;
  }

  if (bonusStatus) {
    if (appState.starterBonusUnlocked || appState.invitedFriendsCount > 0) {
      bonusStatus.innerHTML = `<span style="color: #1a7f4b;">✅ Разблокирован (+1 000 ₽)</span>`;
    } else {
      bonusStatus.innerHTML = `<span style="color: #ff9500;">Не активен (0 ₽)</span>`;
    }
  }

  document.getElementById("invite-modal").classList.add("active");
}

function closeInviteModal(event) {
  if (event && event.target !== document.getElementById("invite-modal")) return;
  document.getElementById("invite-modal").classList.remove("active");
}

function copyInviteLink(btn) {
  haptic("impact", "light");
  const linkInput = document.getElementById("invite-link-input");
  if (!linkInput) return;

  navigator.clipboard.writeText(linkInput.value).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Скопировано!";
    btn.style.backgroundColor = "#e8f8ec";
    btn.style.color = "#1f7a37";
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.backgroundColor = "";
      btn.style.color = "";
    }, 1500);
  }).catch(() => {
    alert("Ссылка: " + linkInput.value);
  });
}

function shareInTelegram() {
  haptic("impact", "medium");
  const referralCode = currentTgUser?.username ? currentTgUser.username : currentUserId;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/MavroCoinBot?start=ref_${referralCode}`)}&text=${encodeURIComponent("🤝 Присоединяйся к P2P кассе взаимопомощи MavroCoin! Получи стартовый лимит 1 000 ₽ на получение помощи.")}`;
  
  if (TG?.openTelegramLink) {
    TG.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, "_blank");
  }
}

function simulateInviteFriend() {
  appState.invitedFriendsCount = (appState.invitedFriendsCount || 0) + 1;
  appState.starterBonusUnlocked = true;

  saveState();
  openInviteModal();
  renderAll();

  alert(`🎉 Поздравляем! Друг успешно присоединился по вашей ссылке!\n\nВам начислен стартовый лимит на получение помощи: 1 000 ₽.\nТеперь вы можете выставить заявку во вкладке «Запросить помощь»!`);
}

// ==============================================================================
// ОПЕРАЦИИ ОКАЗАНИЯ И ЗАПРОСА ПОМОЩИ
// ==============================================================================

function openHelpModal(requestId) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  selectedRequestId = requestId;
  const earnedM = req.amount * RATE_RUB_PER_M;
  const newLimitIncrease = Math.floor(earnedM * ASSISTANCE_LIMIT_MULTIPLIER);

  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = `
    <div style="font-size: 15px; margin-bottom: 12px;">
      Переведите <strong>${req.amount.toLocaleString("ru-RU")} ₽</strong> участнику <strong>${escapeHtml(req.name)}</strong>:
    </div>
    <div style="background-color: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 2px;">Способ оплаты:</div>
      <div style="font-size: 14px; font-weight: 700; color: var(--navy); margin-bottom: 8px;">${escapeHtml(req.paymentType)}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 2px;">Реквизиты получателя:</div>
      <div style="font-size: 16px; font-weight: 800; font-family: monospace; color: var(--accent);">${escapeHtml(req.details)}</div>
    </div>
    <div style="font-size: 13px; color: var(--success); font-weight: 600; line-height: 1.4;">
      🎁 После подтверждения второй стороной вам начислится <strong>+${earnedM.toLocaleString("ru-RU")} М°</strong>, а ваш лимит на запрос помощи вырастет на <strong>+${newLimitIncrease.toLocaleString("ru-RU")} ₽ (+30%)</strong>!
    </div>
  `;

  document.getElementById("confirm-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("confirm-modal").classList.remove("active");
  selectedRequestId = null;
}

function openConfirmModal() {
  renderAll();
  document.getElementById("confirm-incoming-modal").classList.add("active");
}

function closeConfirmModal(event) {
  if (event && event.target !== document.getElementById("confirm-incoming-modal")) return;
  document.getElementById("confirm-incoming-modal").classList.remove("active");
}

// Отправитель отправил средства
async function submitAssistanceTransfer() {
  if (!selectedRequestId) return;
  const req = appState.requests.find(r => r.id === selectedRequestId);
  if (!req) return;

  const proof = document.getElementById("transfer-proof-input").value.trim() || "Чек перевода прикреплен";
  const earnedM = req.amount * RATE_RUB_PER_M;

  req.status = "sent";
  req.sender_id = currentUserId;
  req.senderName = "Вы (Текущий аккаунт)";
  req.transferProof = proof;
  appState.pendingBalanceM += earnedM;

  closeModal();
  saveState();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .update({
          status: "sent",
          sender_id: currentUserId,
          sender_name: "Вы (Текущий аккаунт)",
          transfer_proof: proof
        })
        .eq("id", req.id);

      await supabaseClient
        .from("mavro_users")
        .update({ pending_m: appState.pendingBalanceM })
        .eq("id", currentUserId);
    } catch (e) {
      console.warn("Supabase update error:", e);
    }
  }

  alert(`Шаг 1 выполнен!\nПеревод на ${req.amount.toLocaleString("ru-RU")} ₽ отправлен на проверку получателю.\n\nЗаявка появилась в списке входящих подтверждений (🔔).`);
  openConfirmModal();
}

// Получатель подтверждает получение
async function receiverConfirmTransfer(requestId) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  const earnedM = req.amount * RATE_RUB_PER_M;
  const limitBoost = Math.floor(earnedM * ASSISTANCE_LIMIT_MULTIPLIER);
  req.status = "confirmed";

  const isCurrentSender = (req.sender_id === currentUserId) || 
                          (req.senderName && (req.senderName.includes("Вы") || req.senderName.includes(currentUserId.slice(-4)))) ||
                          (!req.sender_id && !req.isMine);

  if (isCurrentSender) {
    appState.pendingBalanceM = Math.max(0, (appState.pendingBalanceM || 0) - earnedM);
    appState.userBalanceM = (appState.userBalanceM || 0) + earnedM;
  }

  if (req.sender_id) {
    const senderUser = appState.users.find(u => u.id === req.sender_id);
    if (senderUser && senderUser.id !== currentUserId) {
      senderUser.pending_m = Math.max(0, (senderUser.pending_m || 0) - earnedM);
      senderUser.balance_m = (senderUser.balance_m || 0) + earnedM;
    }
  }

  reconcilePendingBalances();
  saveState();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .update({ status: "confirmed" })
        .eq("id", req.id);

      await supabaseClient
        .from("mavro_users")
        .update({
          balance_m: appState.userBalanceM,
          pending_m: appState.pendingBalanceM
        })
        .eq("id", currentUserId);

      if (req.sender_id && req.sender_id !== currentUserId) {
        const senderUser = appState.users.find(u => u.id === req.sender_id);
        if (senderUser) {
          await supabaseClient
            .from("mavro_users")
            .update({
              balance_m: senderUser.balance_m,
              pending_m: senderUser.pending_m
            })
            .eq("id", req.sender_id);
        }
      }
    } catch (e) {
      console.warn("Supabase confirm error:", e);
    }
  }

  closeConfirmModal();
  alert(`✅ Сделка успешно подтверждена!\nПолучатель ${req.name} подтвердил получение ${req.amount.toLocaleString("ru-RU")} ₽.\nМонеты +${earnedM.toLocaleString("ru-RU")} М° зачислены на баланс!`);
  switchTab("tab-history");
}

async function receiverRejectTransfer(requestId) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  const earnedM = req.amount * RATE_RUB_PER_M;
  req.status = "dispute";

  const isCurrentSender = (req.sender_id === currentUserId) || (req.senderName && req.senderName.includes("Вы"));
  if (isCurrentSender) {
    appState.pendingBalanceM = Math.max(0, (appState.pendingBalanceM || 0) - earnedM);
  }

  reconcilePendingBalances();
  saveState();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .update({ status: "dispute" })
        .eq("id", req.id);

      await supabaseClient
        .from("mavro_users")
        .update({ pending_m: appState.pendingBalanceM })
        .eq("id", currentUserId);
    } catch (e) {
      console.warn("Supabase dispute error:", e);
    }
  }

  alert(`⚠️ Статус обновлен: Вторая сторона указала, что средства не поступили.`);
}

function validateAmount(input) {
  const maxLimit = getRequestLimitRub();
  const val = parseFloat(input.value) || 0;
  const hint = document.getElementById("amount-hint");

  if (val > maxLimit) {
    hint.style.color = "#dc2626";
    if (maxLimit === 0) {
      hint.innerHTML = `⚠️ Ваш текущий лимит <strong>0 ₽</strong>. Окажите помощь другим участникам или пригласите друга, чтобы открыть лимит 1 000 ₽!`;
    } else {
      hint.innerHTML = `⚠️ Превышен лимит! Доступно максимум <strong>${maxLimit.toLocaleString("ru-RU")} ₽</strong>.`;
    }
  } else {
    hint.style.color = "var(--text-muted)";
    hint.textContent = `Доступно по лимиту: ${maxLimit.toLocaleString("ru-RU")} ₽`;
  }
}

// Создание запроса помощи
async function handleCreateRequest(e) {
  e.preventDefault();

  const name = document.getElementById("req-name").value.trim();
  const amount = parseFloat(document.getElementById("req-amount").value);
  const paymentType = document.getElementById("req-type").value;
  const details = document.getElementById("req-details-input").value.trim();
  const comment = document.getElementById("req-comment").value.trim();

  const maxLimit = getRequestLimitRub();

  if (amount <= 0) {
    alert("Пожалуйста, укажите корректную сумму.");
    return;
  }

  if (amount > maxLimit) {
    if (maxLimit === 0) {
      alert(`Ошибка! Ваш текущий лимит равен 0 ₽.\n\nДля того чтобы запросить помощь на 1 000 ₽:\n1) Окажите помощь другому участнику (купите М°)\nИЛИ\n2) Пригласите друга по вашей реферальной ссылке!`);
    } else {
      alert(`Ошибка! Вы не можете запросить ${amount.toLocaleString("ru-RU")} ₽, так как ваш доступный лимит составляет ${maxLimit.toLocaleString("ru-RU")} ₽.`);
    }
    return;
  }

  const newId = "req-" + Date.now();
  const nowDateStr = "Сегодня, " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const newReq = {
    id: newId,
    user_id: currentUserId,
    name: name,
    amount: amount,
    paymentType: paymentType,
    details: details,
    comment: comment,
    date: nowDateStr,
    status: "open",
    sender_id: null,
    senderName: null,
    transferProof: null,
    isMine: true
  };

  appState.requests.unshift(newReq);
  saveState();
  document.getElementById("create-request-form").reset();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .insert([{
          id: newId,
          user_id: currentUserId,
          name: name,
          amount: amount,
          payment_type: paymentType,
          details: details,
          comment: comment,
          status: "open",
          date: nowDateStr
        }]);
    } catch (e) {
      console.warn("Supabase insert error:", e);
    }
  }

  alert(`Ваш запрос на получение ${amount.toLocaleString("ru-RU")} ₽ успешно опубликован в реестре!`);
  switchTab("tab-history");
}

// ==============================================================================
// АДМИН-ПАНЕЛЬ MAVROCOIN CORE
// ==============================================================================

function openAdminModal() {
  reconcilePendingBalances();
  renderAdminUsers();
  renderAdminRequests();
  document.getElementById("admin-modal").classList.add("active");
}

function closeAdminModal(event) {
  if (event && event.target !== document.getElementById("admin-modal")) return;
  document.getElementById("admin-modal").classList.remove("active");
}

function switchAdminTab(tabId) {
  document.querySelectorAll(".admin-tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".admin-tab-content").forEach(content => content.classList.remove("active"));

  const targetBtn = document.getElementById(`btn-${tabId}`);
  if (targetBtn) targetBtn.classList.add("active");

  const targetContent = document.getElementById(tabId);
  if (targetContent) targetContent.classList.add("active");

  if (tabId === "admin-tab-users") renderAdminUsers();
  if (tabId === "admin-tab-requests") renderAdminRequests();
}

function showAdminToast(message) {
  const toast = document.getElementById("admin-toast-message");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

function renderAdminUsers() {
  const usersListElem = document.getElementById("admin-users-list");
  if (!usersListElem) return;

  const users = [...appState.users];
  const meIndex = users.findIndex(u => u.id === currentUserId);
  if (meIndex > -1) {
    const [me] = users.splice(meIndex, 1);
    me.balance_m = appState.userBalanceM;
    me.pending_m = appState.pendingBalanceM;
    users.unshift(me);
  }

  usersListElem.innerHTML = users.map(user => {
    const isMe = user.id === currentUserId;
    const limitRub = Math.floor(user.balance_m * ASSISTANCE_LIMIT_MULTIPLIER);

    return `
      <div class="admin-user-card ${isMe ? 'current-user-card' : ''}">
        <div class="admin-user-header">
          <div class="admin-user-name">
            ${escapeHtml(user.name)}
            ${isMe ? '<span class="req-reward-badge" style="background: var(--accent); color: #fff;">ВЫ</span>' : ''}
          </div>
          <div class="admin-user-id">ID: ${escapeHtml(user.id)}</div>
        </div>

        <div class="admin-balance-controls">
          <div class="admin-input-group">
            <label>Основной баланс (М°):</label>
            <div class="admin-inline-input">
              <input type="number" id="input-bal-${user.id}" class="form-control" value="${user.balance_m}" step="any" min="0">
            </div>
          </div>
          <div class="admin-input-group">
            <label>В холде / заморозке (М°):</label>
            <div class="admin-inline-input">
              <input type="number" id="input-pend-${user.id}" class="form-control" value="${user.pending_m}" step="any" min="0" style="color: #ff9500;">
            </div>
          </div>
        </div>

        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
          Лимит запроса помощи (+30%): <strong style="color: var(--accent);">${limitRub.toLocaleString("ru-RU")} ₽</strong>
        </div>

        <div class="admin-quick-row">
          <span style="font-size: 11px; font-weight: 700; color: var(--text-faint); margin-right: 4px;">Быстро:</span>
          <button type="button" class="admin-btn-tiny" onclick="quickAddUserBalance('${user.id}', 1000)">+1 000 М°</button>
          <button type="button" class="admin-btn-tiny" onclick="quickAddUserBalance('${user.id}', 5000)">+5 000 М°</button>
          <button type="button" class="admin-btn-tiny" onclick="quickAddUserBalance('${user.id}', 10000)">+10 000 М°</button>
          <button type="button" class="admin-btn-tiny unfreeze-btn" onclick="unfreezeUserHold('${user.id}')" title="Снять холд и начислить на баланс">⚡ Разморозить холд (0 М°)</button>
          <button type="button" class="btn-apple btn-apple-blue" style="margin-left: auto; padding: 4px 12px; font-size: 12px;" onclick="saveUserBalance('${user.id}')">💾 Сохранить</button>
        </div>
      </div>
    `;
  }).join("");
}

async function saveUserBalance(userId) {
  const balInput = document.getElementById(`input-bal-${userId}`);
  const pendInput = document.getElementById(`input-pend-${userId}`);
  if (!balInput || !pendInput) return;

  const newBalance = parseFloat(balInput.value) || 0;
  const newPending = parseFloat(pendInput.value) || 0;

  const user = appState.users.find(u => u.id === userId);
  if (user) {
    user.balance_m = newBalance;
    user.pending_m = newPending;
  }

  if (userId === currentUserId) {
    appState.userBalanceM = newBalance;
    appState.pendingBalanceM = newPending;
  }

  saveState();
  renderAdminUsers();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_users")
        .upsert([{
          id: userId,
          name: user ? user.name : "Участник",
          balance_m: newBalance,
          pending_m: newPending
        }]);
    } catch (e) {
      console.warn("Ошибка обновления пользователя в Supabase:", e);
    }
  }

  showAdminToast(`✅ Баланс участника [${userId}] обновлен: ${newBalance.toLocaleString("ru-RU")} М°`);
}

function quickAddUserBalance(userId, amount) {
  const balInput = document.getElementById(`input-bal-${userId}`);
  if (balInput) {
    balInput.value = (parseFloat(balInput.value) || 0) + amount;
    saveUserBalance(userId);
  }
}

function unfreezeUserHold(userId) {
  const balInput = document.getElementById(`input-bal-${userId}`);
  const pendInput = document.getElementById(`input-pend-${userId}`);
  if (balInput && pendInput) {
    const currentPend = parseFloat(pendInput.value) || 0;
    balInput.value = (parseFloat(balInput.value) || 0) + currentPend;
    pendInput.value = 0;
    saveUserBalance(userId);
    showAdminToast(`⚡ Холд разморожен! +${currentPend.toLocaleString("ru-RU")} М° переведено на основной баланс.`);
  }
}

function openAdminCreateUserModal() {
  document.getElementById("admin-create-user-modal").classList.add("active");
}

function closeAdminCreateUserModal(event) {
  if (event && event.target !== document.getElementById("admin-create-user-modal")) return;
  document.getElementById("admin-create-user-modal").classList.remove("active");
}

async function saveAdminCreateUser(e) {
  e.preventDefault();
  const name = document.getElementById("admin-user-name").value.trim();
  const balance = parseFloat(document.getElementById("admin-user-balance").value) || 0;
  const pending = parseFloat(document.getElementById("admin-user-pending").value) || 0;

  const newId = "usr-" + Math.random().toString(36).substring(2, 8);
  const newUser = {
    id: newId,
    name: name,
    balance_m: balance,
    pending_m: pending
  };

  appState.users.push(newUser);
  saveState();
  closeAdminCreateUserModal();
  renderAdminUsers();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_users")
        .insert([newUser]);
    } catch (err) {
      console.warn("Supabase insert user error:", err);
    }
  }

  showAdminToast(`🎉 Новый участник «${name}» успешно добавлен!`);
}

function renderAdminRequests() {
  const listElem = document.getElementById("admin-requests-list");
  if (!listElem) return;

  const searchQuery = (document.getElementById("admin-req-search")?.value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("admin-req-status-filter")?.value || "all";

  let filtered = appState.requests.filter(req => {
    const matchStatus = statusFilter === "all" || req.status === statusFilter;
    const matchSearch = !searchQuery ||
      req.id.toLowerCase().includes(searchQuery) ||
      req.name.toLowerCase().includes(searchQuery) ||
      (req.details && req.details.toLowerCase().includes(searchQuery)) ||
      (req.senderName && req.senderName.toLowerCase().includes(searchQuery)) ||
      (req.comment && req.comment.toLowerCase().includes(searchQuery));
    return matchStatus && matchSearch;
  });

  const totalCountElem = document.getElementById("admin-req-total-count");
  if (totalCountElem) totalCountElem.textContent = appState.requests.length;

  if (filtered.length === 0) {
    listElem.innerHTML = `<div class="empty-placeholder">Заявок по заданным критериям не найдено.</div>`;
    return;
  }

  listElem.innerHTML = filtered.map(req => {
    return `
      <div class="admin-req-card">
        <div class="admin-req-top">
          <div class="admin-req-title">
            <span>${escapeHtml(req.name)}</span>
            <span class="admin-user-id">${escapeHtml(req.id)}</span>
            ${req.isMine ? '<span class="req-reward-badge" style="background: var(--navy); color: #fff;">Ваша заявка</span>' : ''}
          </div>
          <div class="admin-req-amount">${req.amount.toLocaleString("ru-RU")} ₽</div>
        </div>

        <div class="admin-req-details-grid">
          <div><strong>Способ:</strong> ${escapeHtml(req.paymentType)}</div>
          <div><strong>Реквизиты:</strong> <code>${escapeHtml(req.details)}</code></div>
          <div><strong>Отправитель:</strong> ${escapeHtml(req.senderName || "—")}</div>
          <div><strong>Чек:</strong> ${escapeHtml(req.transferProof || "—")}</div>
          <div style="grid-column: 1 / -1;"><strong>Комментарий:</strong> ${escapeHtml(req.comment || "Без комментария")}</div>
        </div>

        <div class="admin-req-actions">
          <div class="admin-status-select-wrap">
            <span>Статус:</span>
            <select class="admin-status-dropdown" onchange="adminChangeRequestStatus('${req.id}', this.value)">
              <option value="open" ${req.status === "open" ? "selected" : ""}>🟡 open (Ожидает)</option>
              <option value="sent" ${req.status === "sent" ? "selected" : ""}>🟠 sent (В холде)</option>
              <option value="confirmed" ${req.status === "confirmed" ? "selected" : ""}>🟢 confirmed (Закрыта)</option>
              <option value="dispute" ${req.status === "dispute" ? "selected" : ""}>🔴 dispute (Диспут)</option>
            </select>
          </div>

          <div class="admin-btn-group">
            ${req.status !== "confirmed" ? `
              <button type="button" class="btn-apple btn-apple-green" style="padding: 4px 10px; font-size: 11px;" onclick="receiverConfirmTransfer('${req.id}')">
                ✅ Подтвердить
              </button>
            ` : ''}
            <button type="button" class="admin-btn-tiny" onclick="openAdminEditReqModal('${req.id}')">✏️ Редактировать</button>
            <button type="button" class="admin-btn-tiny" style="color: #dc2626;" onclick="adminDeleteRequest('${req.id}')">🗑️ Удалить</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function adminChangeRequestStatus(requestId, newStatus) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  const oldStatus = req.status;
  req.status = newStatus;

  const earnedM = req.amount * RATE_RUB_PER_M;
  const isCurrentSender = (req.sender_id === currentUserId) || (req.senderName && req.senderName.includes("Вы"));

  if (newStatus === "confirmed" && oldStatus !== "confirmed") {
    if (isCurrentSender) {
      appState.pendingBalanceM = Math.max(0, (appState.pendingBalanceM || 0) - earnedM);
      appState.userBalanceM = (appState.userBalanceM || 0) + earnedM;
    }
  } else if (newStatus === "open" && oldStatus === "sent") {
    if (isCurrentSender) {
      appState.pendingBalanceM = Math.max(0, (appState.pendingBalanceM || 0) - earnedM);
    }
    req.sender_id = null;
    req.senderName = null;
    req.transferProof = null;
  }

  reconcilePendingBalances();
  saveState();
  renderAdminRequests();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .update({
          status: newStatus,
          sender_id: req.sender_id,
          sender_name: req.senderName,
          transfer_proof: req.transferProof
        })
        .eq("id", requestId);

      await supabaseClient
        .from("mavro_users")
        .update({
          balance_m: appState.userBalanceM,
          pending_m: appState.pendingBalanceM
        })
        .eq("id", currentUserId);
    } catch (e) {
      console.warn("Supabase update status error:", e);
    }
  }

  showAdminToast(`Статус заявки [${requestId}] изменен на: ${newStatus}`);
}

async function adminDeleteRequest(requestId) {
  if (!confirm(`Вы действительно хотите удалить заявку ${requestId}?`)) return;

  const reqIndex = appState.requests.findIndex(r => r.id === requestId);
  if (reqIndex > -1) {
    appState.requests.splice(reqIndex, 1);
  }

  reconcilePendingBalances();
  saveState();
  renderAdminRequests();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .delete()
        .eq("id", requestId);
    } catch (e) {
      console.warn("Supabase delete error:", e);
    }
  }

  showAdminToast(`🗑️ Заявка [${requestId}] успешно удалена.`);
}

function openAdminEditReqModal(requestId) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  document.getElementById("edit-req-id").value = req.id;
  document.getElementById("edit-req-id-badge").textContent = `(${req.id})`;
  document.getElementById("edit-req-name").value = req.name;
  document.getElementById("edit-req-amount").value = req.amount;
  document.getElementById("edit-req-status").value = req.status;
  document.getElementById("edit-req-type").value = req.paymentType;
  document.getElementById("edit-req-details").value = req.details;
  document.getElementById("edit-req-comment").value = req.comment || "";
  document.getElementById("edit-req-sender").value = req.senderName || "";
  document.getElementById("edit-req-proof").value = req.transferProof || "";

  document.getElementById("admin-edit-req-modal").classList.add("active");
}

function closeAdminEditReqModal(event) {
  if (event && event.target !== document.getElementById("admin-edit-req-modal")) return;
  document.getElementById("admin-edit-req-modal").classList.remove("active");
}

async function saveAdminReqEdit(e) {
  e.preventDefault();
  const id = document.getElementById("edit-req-id").value;
  const req = appState.requests.find(r => r.id === id);
  if (!req) return;

  req.name = document.getElementById("edit-req-name").value.trim();
  req.amount = parseFloat(document.getElementById("edit-req-amount").value) || req.amount;
  req.status = document.getElementById("edit-req-status").value;
  req.paymentType = document.getElementById("edit-req-type").value;
  req.details = document.getElementById("edit-req-details").value.trim();
  req.comment = document.getElementById("edit-req-comment").value.trim();
  req.senderName = document.getElementById("edit-req-sender").value.trim() || null;
  req.transferProof = document.getElementById("edit-req-proof").value.trim() || null;

  reconcilePendingBalances();
  saveState();
  closeAdminEditReqModal();
  renderAdminRequests();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .update({
          name: req.name,
          amount: req.amount,
          status: req.status,
          payment_type: req.paymentType,
          details: req.details,
          comment: req.comment,
          sender_name: req.senderName,
          transfer_proof: req.transferProof
        })
        .eq("id", id);
    } catch (err) {
      console.warn("Supabase update error:", err);
    }
  }

  showAdminToast(`💾 Заявка [${id}] успешно обновлена!`);
}

function openAdminCreateReqModal() {
  document.getElementById("admin-create-req-modal").classList.add("active");
}

function closeAdminCreateReqModal(event) {
  if (event && event.target !== document.getElementById("admin-create-req-modal")) return;
  document.getElementById("admin-create-req-modal").classList.remove("active");
}

async function saveAdminCreateReq(e) {
  e.preventDefault();
  const name = document.getElementById("admin-new-name").value.trim();
  const amount = parseFloat(document.getElementById("admin-new-amount").value) || 1000;
  const paymentType = document.getElementById("admin-new-type").value;
  const details = document.getElementById("admin-new-details").value.trim();
  const comment = document.getElementById("admin-new-comment").value.trim();

  const newId = "req-adm-" + Date.now();
  const nowDateStr = "Сегодня, " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const newReq = {
    id: newId,
    user_id: "admin-created",
    name: name,
    amount: amount,
    paymentType: paymentType,
    details: details,
    comment: comment,
    date: nowDateStr,
    status: "open",
    sender_id: null,
    senderName: null,
    transferProof: null,
    isMine: false
  };

  appState.requests.unshift(newReq);
  saveState();
  closeAdminCreateReqModal();
  renderAdminRequests();
  document.getElementById("admin-create-req-form").reset();

  if (supabaseClient && isSupabaseConnected) {
    try {
      await supabaseClient
        .from("mavro_requests")
        .insert([{
          id: newId,
          user_id: "admin-created",
          name: name,
          amount: amount,
          payment_type: paymentType,
          details: details,
          comment: comment,
          status: "open",
          date: nowDateStr
        }]);
    } catch (err) {
      console.warn("Supabase insert error:", err);
    }
  }

  showAdminToast(`➕ Заявка на ${amount.toLocaleString("ru-RU")} ₽ успешно создана!`);
}

function adminFixStuckPending() {
  reconcilePendingBalances(true);
}

async function adminForceSyncSupabase() {
  if (!supabaseClient || !isSupabaseConnected) {
    alert("Supabase сейчас не подключен или работает в локальном режиме.");
    return;
  }
  showAdminToast("🔄 Синхронизация с Supabase...");
  await syncUserWithSupabase();
  await fetchRequestsFromSupabase();
  await fetchAllUsersFromSupabase();
  reconcilePendingBalances();
  renderAdminUsers();
  renderAdminRequests();
  showAdminToast("✅ Полная синхронизация с базой завершена!");
}

async function adminGenerateTestRequests() {
  const names = ["Павел И.", "Ольга С.", "Максим Т.", "Виктория Н.", "Артем Г."];
  const types = ["Банковская карта (Сбер)", "Банковская карта (Т-Банк)", "СБП (по номеру телефона)", "USDT TRC20"];
  const amounts = [1500, 3000, 5500, 7000, 12000];
  const comments = ["На покупку инструментов", "Оплата коммунальных услуг", "Помощь детскому саду", "Ремонт авто"];

  for (let i = 0; i < 3; i++) {
    const newId = "req-demo-" + Math.random().toString(36).substring(2, 7) + Date.now();
    const name = names[Math.floor(Math.random() * names.length)];
    const paymentType = types[Math.floor(Math.random() * types.length)];
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    const comment = comments[Math.floor(Math.random() * comments.length)];
    const details = paymentType.includes("СБП") ? "+7 (999) " + Math.floor(100 + Math.random() * 900) + "-" + Math.floor(10 + Math.random() * 90) + "-" + Math.floor(10 + Math.random() * 90) : "2202 20" + Math.floor(10 + Math.random() * 90) + " " + Math.floor(1000 + Math.random() * 9000) + " " + Math.floor(1000 + Math.random() * 9000);
    const dateStr = "Сегодня, " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const reqObj = {
      id: newId,
      user_id: "demo-system",
      name: name,
      amount: amount,
      paymentType: paymentType,
      details: details,
      comment: comment,
      date: dateStr,
      status: "open",
      sender_id: null,
      senderName: null,
      transferProof: null,
      isMine: false
    };

    appState.requests.unshift(reqObj);

    if (supabaseClient && isSupabaseConnected) {
      try {
        await supabaseClient.from("mavro_requests").insert([{
          id: newId,
          user_id: "demo-system",
          name: name,
          amount: amount,
          payment_type: paymentType,
          details: details,
          comment: comment,
          status: "open",
          date: dateStr
        }]);
      } catch (e) {}
    }
  }

  saveState();
  renderAdminRequests();
  showAdminToast("➕ Добавлено 3 новые тестовые заявки!");
}

function adminResetDemoData() {
  if (!confirm("Вы уверены, что хотите сбросить все данные к начальным демо?")) return;
  localStorage.removeItem("mavro_apple_p2p_state_v2");
  appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveState();
  renderAdminUsers();
  renderAdminRequests();
  showAdminToast("♻️ База данных сброшена к начальному демо-состоянию.");
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==============================================================================
// ИНИЦИАЛИЗАЦИЯ TELEGRAM MINI APP
// ==============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Инициализировать Telegram WebApp
  if (TG) {
    TG.ready();
    TG.expand(); // Разворачиваем на весь экран
    TG.disableVerticalSwipes(); // Отключаем свайп-закрытие

    // Применяем тему Telegram
    applyTelegramTheme();

    // Показываем имя пользователя в шапке если есть
    const tgUserBanner = document.getElementById("tg-user-banner");
    if (tgUserBanner && currentTgUser) {
      tgUserBanner.style.display = "flex";
      document.getElementById("tg-user-name").textContent = currentTgUser.name;
      if (currentTgUser.username) {
        document.getElementById("tg-user-sub").textContent = "@" + currentTgUser.username;
      }
      if (currentTgUser.photo_url) {
        const avatarEl = document.getElementById("tg-user-avatar");
        if (avatarEl) {
          avatarEl.style.backgroundImage = `url(${currentTgUser.photo_url})`;
          avatarEl.style.backgroundSize = "cover";
          avatarEl.textContent = "";
        }
      }
    }
  }

  // 2. Обновляем currentUserId и пересобираем DEFAULT_STATE
  const freshState = buildDefaultState();
  appState = loadState() || freshState;

  // 3. Синхронизируем баланс и рендерим
  reconcilePendingBalances();
  renderAll();

  // 4. Подключаемся к Supabase
  await initSupabase();
});

// Применение CSS-переменных темы Telegram
function applyTelegramTheme() {
  if (!TG?.themeParams) return;
  const tp = TG.themeParams;
  const root = document.documentElement.style;

  if (tp.bg_color)          root.setProperty("--tg-bg",           tp.bg_color);
  if (tp.text_color)        root.setProperty("--tg-text",         tp.text_color);
  if (tp.hint_color)        root.setProperty("--tg-hint",         tp.hint_color);
  if (tp.link_color)        root.setProperty("--tg-link",         tp.link_color);
  if (tp.button_color)      root.setProperty("--tg-btn-bg",       tp.button_color);
  if (tp.button_text_color) root.setProperty("--tg-btn-text",     tp.button_text_color);
  if (tp.secondary_bg_color) root.setProperty("--tg-secondary-bg", tp.secondary_bg_color);
}
