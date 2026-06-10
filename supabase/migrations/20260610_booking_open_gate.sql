-- ============================================================================
-- 2026 booking-open gate: patron early access + July 19 general on-sale
--
-- 1. profiles.booking_tier — room entitlement, written only by the rooms-sync
--    edge function (service role). NULL for the entire 2025 residue.
-- 2. settings.booking_opens_at — the clock that opens general booking.
-- 3. Profiles lockdown — users must not self-assign booking_tier / is_admin /
--    credits (otherwise the gate is decorative).
-- 4. Booking gate trigger — BEFORE INSERT OR UPDATE on bookings, keyed on the
--    booking OWNER's profile (NEW.user_id), plus acting-admin override.
-- 5. Bookings RLS reconciliation — INSERT requires a booking_tier; the
--    permissive user UPDATE policy (Extend Stay) is dropped, retiring that
--    flow for 2026.
-- 6. Anon enumeration off — no more guest-list dumps with the public anon key.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Entitlement column (NULL for all existing rows — that's the point)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS booking_tier text;

-- rooms-sync upserts first/last name; ensure the columns exist everywhere.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text;

-- ----------------------------------------------------------------------------
-- 2. settings table + booking_opens_at seed
--    (20240321000001_fix_settings_value.sql may already define it with text
--    value + timestamps; this is compatible.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value text
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Replace the public-read policy: settings are readable by authenticated only.
DROP POLICY IF EXISTS "Public read access to settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated read access to settings" ON public.settings;
CREATE POLICY "Authenticated read access to settings"
  ON public.settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin full access to settings" ON public.settings;
CREATE POLICY "Admin full access to settings"
  ON public.settings FOR ALL
  USING (public.is_admin());

REVOKE ALL ON public.settings FROM anon, authenticated;
GRANT SELECT ON public.settings TO authenticated;

INSERT INTO public.settings (key, value)
VALUES ('booking_opens_at', '2026-07-19T10:00:00+02:00')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ----------------------------------------------------------------------------
-- 3. Profiles lockdown
--    Without this, any user can UPDATE profiles SET booking_tier='PATRON' /
--    is_admin=true / credits=… on their own row (wide self-update policy +
--    table-wide grant).
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (first_name, last_name) ON public.profiles TO authenticated;

-- Guard trigger: discriminate by DB role, NOT auth.jwt() claims, so SECURITY
-- DEFINER paths (admin credit RPCs, credit triggers — owned by postgres) keep
-- working while user-JWT requests cannot touch the protected columns.
CREATE OR REPLACE FUNCTION public.guard_profiles_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF NEW.booking_tier IS DISTINCT FROM OLD.booking_tier
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.credits IS DISTINCT FROM OLD.credits THEN
      RAISE EXCEPTION 'PROFILE_PROTECTED_COLUMN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_protected_columns ON public.profiles;
CREATE TRIGGER guard_profiles_protected_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_protected_columns();

-- ----------------------------------------------------------------------------
-- 4. Booking gate
--    Keyed on the booking OWNER (NEW.user_id) — correct under both the
--    user-JWT direct insert and service-role/RPC paths where auth.uid() is
--    NULL. SECURITY INVOKER on purpose: current_user must reflect the acting
--    DB role. Missing settings row ⇒ locked.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_booking_open()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_is_admin boolean;
  owner_tier text;
  opens_at timestamptz;
BEGIN
  SELECT p.is_admin, p.booking_tier
    INTO owner_is_admin, owner_tier
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  -- Owner-based rules
  IF COALESCE(owner_is_admin, false) THEN
    RETURN NEW;
  END IF;

  IF owner_tier = 'PATRON' THEN
    RETURN NEW;
  END IF;

  SELECT s.value::timestamptz
    INTO opens_at
    FROM public.settings s
   WHERE s.key = 'booking_opens_at';

  IF owner_tier IS NOT NULL AND opens_at IS NOT NULL AND now() >= opens_at THEN
    RETURN NEW;
  END IF;

  -- Acting-user override: admins can create/reassign bookings for anyone.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles ap WHERE ap.id = auth.uid() AND ap.is_admin
  ) THEN
    RETURN NEW;
  END IF;

  -- Service/system roles may UPDATE existing rows (stripe-payment-webhook
  -- confirms pending bookings via service role). Service-role INSERTs are NOT
  -- blanket-exempted — they must pass the owner-tier rules above.
  IF TG_OP = 'UPDATE' AND current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'BOOKING_NOT_OPEN';
END;
$$;

DROP TRIGGER IF EXISTS booking_open_gate ON public.bookings;
CREATE TRIGGER booking_open_gate
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_booking_open();

-- ----------------------------------------------------------------------------
-- 5. Bookings RLS reconciliation
-- ----------------------------------------------------------------------------
-- Replace the user INSERT policy: own row + a booking tier required.
-- (Admin INSERT policy from 20250807_admin_booking_rls.sql stays untouched.)
DROP POLICY IF EXISTS "Users can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can insert their own bookings" ON public.bookings;
CREATE POLICY "Users can create bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.booking_tier IS NOT NULL
    )
  );

-- Drop the permissive update-anything policy (20250128000000) that existed
-- solely for the Extend Stay flow — retired for 2026. The surviving
-- "Users can update own bookings" policy (20250807) already restricts
-- non-admin updates to status → 'cancelled'.
DROP POLICY IF EXISTS "Users can update their own bookings" ON public.bookings;

-- ----------------------------------------------------------------------------
-- 6. Anon enumeration off
--    (20250808_fix_whitelist_anon_access.sql granted anon SELECT on the full
--    guest list; this integration would add the patron flag to that dump.)
--    Authenticated SELECT grants stay as-is.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON public.profiles FROM anon;

DO $$
BEGIN
  IF to_regclass('public.whitelist_all') IS NOT NULL THEN
    REVOKE SELECT ON public.whitelist_all FROM anon;
  END IF;
  IF to_regclass('public.whitelist_pending') IS NOT NULL THEN
    REVOKE SELECT ON public.whitelist_pending FROM anon;
  END IF;
END $$;
