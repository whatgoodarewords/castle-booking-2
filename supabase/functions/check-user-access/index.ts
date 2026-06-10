import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestPayload {
  email: string;
}

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('BACKEND_URL')
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email } = await req.json() as RequestPayload

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const supabaseAdmin = getSupabaseAdminClient()

    // Simple check: if user exists in profiles table, they can access
    console.log(`Checking access for ${normalizedEmail}...`)
    
    // Check if user exists in profiles table (by email)
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .single()

    if (profileError || !profileData) {
      console.log(`User ${normalizedEmail} not in whitelist`)
      return new Response(JSON.stringify({
        canAccess: false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // User is in whitelist!
    // This is an unauthenticated pre-auth probe — return nothing beyond canAccess.
    console.log(`User ${normalizedEmail} is whitelisted`)
    return new Response(JSON.stringify({
      canAccess: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({
      canAccess: false
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})