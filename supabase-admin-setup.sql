-- ============================================
-- RdotA Admin Functions
-- Run this in Supabase SQL Editor AFTER supabase-setup.sql
-- Only abrasive.tax@gmail.com can call these
-- ============================================

-- 1. List all users with premium status + generation count today
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_email TEXT;
  v_result JSON;
BEGIN
  -- Get caller's email
  SELECT email INTO v_caller_email
    FROM auth.users
   WHERE id = auth.uid();

  -- Only admin can call this
  IF v_caller_email IS NULL OR v_caller_email != 'abrasive.tax@gmail.com' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT json_agg(row_to_json(t))
    INTO v_result
    FROM (
      SELECT
        u.id,
        u.email,
        u.created_at,
        COALESCE((u.raw_user_meta_data->>'avatar_url'), NULL) AS avatar_url,
        COALESCE((u.raw_user_meta_data->>'premium')::boolean, false) AS is_premium,
        COALESCE(g.cnt, 0) AS gens_today
      FROM auth.users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt
          FROM generations
         WHERE created_at > now() - INTERVAL '24 hours'
         GROUP BY user_id
      ) g ON g.user_id = u.id
      ORDER BY u.created_at DESC
    ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- 2. Set premium status for a user (by email)
CREATE OR REPLACE FUNCTION admin_set_premium(target_email TEXT, is_premium BOOLEAN)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_email TEXT;
  v_target_id UUID;
BEGIN
  -- Get caller's email
  SELECT email INTO v_caller_email
    FROM auth.users
   WHERE id = auth.uid();

  -- Only admin can call this
  IF v_caller_email IS NULL OR v_caller_email != 'abrasive.tax@gmail.com' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Find target user
  SELECT id INTO v_target_id
    FROM auth.users
   WHERE email = target_email;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', target_email;
  END IF;

  -- Update their metadata (merge, don't overwrite)
  UPDATE auth.users
     SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('premium', is_premium)
   WHERE id = v_target_id;

  RETURN json_build_object('success', true, 'user_id', v_target_id, 'premium', is_premium);
END;
$$;
