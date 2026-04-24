import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceRoleKey, getSupabaseAnonKey, getSupabaseUrl } from './env.ts'

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey())
}

export function createUserClient(req: Request) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: {
      headers: {
        Authorization: req.headers.get('authorization') ?? '',
      },
    },
  })
}

export async function requireUser(req: Request) {
  const userClient = createUserClient(req)
  const { data, error } = await userClient.auth.getUser()

  if (error || !data.user) {
    return {
      ok: false as const,
      status: 401,
      error: 'LOGIN_REQUIRED',
      admin: createAdminClient(),
      userClient,
    }
  }

  return {
    ok: true as const,
    admin: createAdminClient(),
    userClient,
    user: data.user,
  }
}
