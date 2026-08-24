-- ==============================================================================
-- MavroCoin P2P — Telegram Mini App Supabase SQL Schema
-- Запустите этот скрипт в Supabase Dashboard -> SQL Editor -> Run
-- ==============================================================================

-- 1. Таблица пользователей / кошельков участников Telegram
CREATE TABLE IF NOT EXISTS public.mavro_users (
    id TEXT PRIMARY KEY,                       -- Telegram User ID или dev-id
    name TEXT NOT NULL DEFAULT 'Участник',     -- Имя Telegram (first_name + last_name)
    username TEXT,                             -- Telegram @username
    photo_url TEXT,                            -- Аватарка из Telegram
    telegram_id TEXT,                          -- Числовой ID Telegram
    balance_m NUMERIC NOT NULL DEFAULT 0.00,   -- Начальный баланс новичка: 0.00 М°
    pending_m NUMERIC NOT NULL DEFAULT 0.00,   -- В холде
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Добавляем колонки, если таблица была создана ранее без них
ALTER TABLE public.mavro_users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.mavro_users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.mavro_users ADD COLUMN IF NOT EXISTS telegram_id TEXT;

-- 2. Таблица P2P заявок на взаимопомощь
CREATE TABLE IF NOT EXISTS public.mavro_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    payment_type TEXT NOT NULL,
    details TEXT NOT NULL,
    comment TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'sent', 'confirmed', 'dispute'
    sender_id TEXT,
    sender_name TEXT,
    transfer_proof TEXT,
    date TEXT NOT NULL DEFAULT to_char(timezone('Europe/Moscow'::text, now()), 'DD.MM.YYYY, HH24:MI'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Таблица системных логов
CREATE TABLE IF NOT EXISTS public.mavro_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Публичные политики (RLS) для работы через anon-ключ
ALTER TABLE public.mavro_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavro_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavro_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all access on mavro_users" ON public.mavro_users;
CREATE POLICY "Allow public all access on mavro_users" ON public.mavro_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on mavro_requests" ON public.mavro_requests;
CREATE POLICY "Allow public all access on mavro_requests" ON public.mavro_requests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on mavro_logs" ON public.mavro_logs;
CREATE POLICY "Allow public all access on mavro_logs" ON public.mavro_logs FOR ALL USING (true) WITH CHECK (true);

-- 5. Включаем Realtime для таблиц
ALTER PUBLICATION supabase_realtime ADD TABLE public.mavro_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mavro_users;
