import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Privileged sync endpoint for the ticket site (chatoo). Authenticated with a
// shared secret header — NOT a Supabase JWT (verify_jwt = false in config.toml).
//
// Actions:
//   sync    — idempotently create the auth user + upsert profiles {email, name,
//             booking_tier}. Tier never downgrades (PATRON wins). Refuses admins.
//   handoff — mint a single-use magic link for an already-synced profile so the
//             ticket site can sign the buyer straight into the rooms app.

interface RequestPayload {
  action: 'sync' | 'handoff';
  email: string;
  name?: string;
  tier?: string;
}

// Hardcoded admin list — mirrors public.is_admin()
// (supabase/migrations/20250806_create_whitelist_tables.sql)
const ADMIN_EMAILS = [
  'andre@thegarden.pt',
  'redis213@gmail.com',
  'dawn@thegarden.pt',
  'simone@thegarden.pt',
  'samjlloa@gmail.com',
  'living@thegarden.pt',
  'samckclarke@gmail.com',
]

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('BACKEND_URL') ?? Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key environment variables.')
    throw new Error('Server configuration error.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Constant-time string comparison so the shared secret can't be timed out byte by byte.
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

// Resolve the auth user id for an email that has no profiles row:
// attempt createUser first (idempotent path for brand-new buyers); if the user
// is already registered, page through auth.admin.listUsers and match client-side.
async function resolveAuthUserId(
  supabaseAdmin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  })

  if (!createError && created?.user) {
    return created.user.id
  }

  console.log(`createUser failed for ${email} (likely already registered): ${createError?.message}`)

  const perPage = 1000
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error('listUsers failed:', error)
      return null
    }
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (match) return match.id
    if (data.users.length < perPage) break
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    // --- Shared-secret auth (constant-time) ---
    const expectedSecret = Deno.env.get('ROOMS_SYNC_SECRET')
    if (!expectedSecret) {
      console.error('ROOMS_SYNC_SECRET is not configured.')
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }
    const providedSecret = req.headers.get('X-Sync-Secret') ?? ''
    if (!constantTimeEqual(providedSecret, expectedSecret)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const { action, email, name, tier } = await req.json() as RequestPayload

    if (!email || (action !== 'sync' && action !== 'handoff')) {
      return jsonResponse({ error: 'Missing email or invalid action' }, 400)
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Never sync or mint links for admin accounts.
    if (ADMIN_EMAILS.includes(normalizedEmail)) {
      return jsonResponse({ error: 'Refused: admin account' }, 400)
    }

    const supabaseAdmin = getSupabaseAdminClient()

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, is_admin, booking_tier')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (existingProfile?.is_admin) {
      return jsonResponse({ error: 'Refused: admin account' }, 400)
    }

    if (action === 'handoff') {
      if (!existingProfile) {
        return jsonResponse({ error: 'Profile not found' }, 404)
      }

      // Redirect target is fixed server-side — never accept a client-supplied redirect.
      const redirectTo = Deno.env.get('FRONTEND_URL') ?? 'https://rooms.castle.community'
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
        options: { redirectTo },
      })

      if (linkError || !linkData?.properties?.action_link) {
        console.error('generateLink failed:', linkError)
        return jsonResponse({ error: 'Failed to generate login link' }, 500)
      }

      return jsonResponse({ action_link: linkData.properties.action_link }, 200)
    }

    // --- action === 'sync' ---
    let userId = existingProfile?.id ?? null
    let currentTier: string | null = existingProfile?.booking_tier ?? null

    if (!userId) {
      userId = await resolveAuthUserId(supabaseAdmin, normalizedEmail)
      if (!userId) {
        return jsonResponse({ error: 'Failed to create or locate auth user' }, 500)
      }

      // A profile row may exist under this id with a stale email — re-check it.
      const { data: profileById } = await supabaseAdmin
        .from('profiles')
        .select('id, is_admin, booking_tier')
        .eq('id', userId)
        .maybeSingle()

      if (profileById?.is_admin) {
        return jsonResponse({ error: 'Refused: admin account' }, 400)
      }
      currentTier = profileById?.booking_tier ?? null
    }

    const profilePayload: Record<string, unknown> = {
      id: userId,
      email: normalizedEmail,
    }

    if (name && name.trim()) {
      const [firstName, ...rest] = name.trim().split(/\s+/)
      profilePayload.first_name = firstName
      profilePayload.last_name = rest.join(' ') || null
    }

    // Tier never downgrades: once PATRON, always PATRON.
    if (tier && currentTier !== 'PATRON') {
      profilePayload.booking_tier = tier
    }

    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' })

    if (upsertError) {
      console.error('Profile upsert failed:', upsertError)
      return jsonResponse({ error: 'Failed to upsert profile' }, 500)
    }

    console.log(`Synced rooms access for ${normalizedEmail} (tier: ${tier ?? 'unchanged'})`)
    return jsonResponse({ ok: true, user_id: userId }, 200)
  } catch (error) {
    console.error('Error:', error)
    return jsonResponse({ error: error.message || 'Internal server error' }, 500)
  }
})
