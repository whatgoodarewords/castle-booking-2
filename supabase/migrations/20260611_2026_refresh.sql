-- ============================================================================
-- 2026 content refresh: glamping retired, room pricing, sold_out reset
--
-- 1. accommodations.archived — glamping (bell tents + tipis) is retired for
--    2026 ("expensive and didn't work well"). Archiving instead of deleting
--    preserves the FK history of 2025 bookings; the guest UI filters it out
--    (BookingService.getAccommodations).
-- 2. 2026 pricing — +10% across the board, +20% for the four cheapest castle
--    rooms (Lierre I, Lierre II, Sahara, Chouette). One-shot: guarded by a
--    settings marker so re-running this file can never compound prices.
-- 3. sold_out reset — 2025 sell-outs must not leak into 2026 sales.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Archive glamping
-- ----------------------------------------------------------------------------
ALTER TABLE public.accommodations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

UPDATE public.accommodations SET archived = true
WHERE id IN (
  '48e09427-bec3-4659-9754-1998159b5965', -- Single Bed in 3 Person, 4-Meter Bell Tent [Vallery Gardens]
  'e5b493ec-8dd0-476b-a41c-ba706232bc21', -- Tipi [Vallery Gardens]
  'e798c3c3-6516-4532-a29a-7f8016d9d494', -- Tipi, Ramparts View (Closest to Chateau)
  '9378b6fe-cc31-4d94-9eac-857d349076d8', -- 4-Meter Bell Tent [Vallery Gardens]
  '9e1ea46b-5090-41c7-bc37-797f18724941'  -- 4M Bell Tent, [Castle Grounds / Forest Clearing]
);

-- ----------------------------------------------------------------------------
-- 2. 2026 pricing (one-shot, marker-guarded — NEVER compounds on re-run)
--    +20%: the four cheapest castle rooms. +10%: every other live, priced
--    accommodation. Archived rows and €0 items (own van / DIY tent) untouched.
--    All current prices produce whole euros under these multipliers.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.settings WHERE key = '2026_pricing_applied') THEN

    UPDATE public.accommodations
       SET base_price = round(base_price * 1.2)
     WHERE id IN (
       '01779c04-3c79-49e4-b16b-1a7edae63ec5', -- Lierre I    800 -> 960
       '939d0715-30df-4620-9bae-4638701fc646', -- Lierre II   800 -> 960
       'c7fb0610-0787-4aee-a3d8-d1fe2c723a0c', -- Sahara     1700 -> 2040
       'd836894c-2d5d-4ebc-9262-d16fff8e69a9'  -- Chouette   1700 -> 2040
     );

    UPDATE public.accommodations
       SET base_price = round(base_price * 1.1)
     WHERE id NOT IN (
       '01779c04-3c79-49e4-b16b-1a7edae63ec5',
       '939d0715-30df-4620-9bae-4638701fc646',
       'c7fb0610-0787-4aee-a3d8-d1fe2c723a0c',
       'd836894c-2d5d-4ebc-9262-d16fff8e69a9'
     )
       AND archived = false
       AND base_price > 0;

    INSERT INTO public.settings (key, value)
    VALUES ('2026_pricing_applied', now()::text);

  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Reset 2025 sell-out flags for everything still on sale
-- ----------------------------------------------------------------------------
UPDATE public.accommodations SET sold_out = false WHERE archived = false;
