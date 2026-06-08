-- ============================================
-- RdotA Generations Rate Limit Table + RLS
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================

-- 1. Create the generations table
CREATE TABLE IF NOT EXISTS generations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generator_type TEXT NOT NULL DEFAULT 'unknown',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create index for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_generations_user_day
  ON generations (user_id, created_at DESC);

-- 3. Enable Row Level Security
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

-- 4. Users can INSERT their own rows only
CREATE POLICY "Users can insert own generations"
  ON generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 5. Users can SELECT their own rows only
CREATE POLICY "Users can read own generations"
  ON generations FOR SELECT
  USING (auth.uid() = user_id);

-- 6. NO UPDATE or DELETE policies = tamper-proof
-- Users cannot delete or modify their generation logs

-- 7. RPC function for atomic count check (uses server time)
CREATE OR REPLACE FUNCTION get_generation_count(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_oldest TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT COUNT(*), MIN(created_at)
    INTO v_count, v_oldest
    FROM generations
   WHERE user_id = p_user_id
     AND created_at > v_now - INTERVAL '24 hours';

  RETURN json_build_object(
    'count', v_count,
    'oldest_at', v_oldest,
    'server_now', v_now
  );
END;
$$;
