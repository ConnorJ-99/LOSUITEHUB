import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const environment = import.meta.env.VITE_SUPABASE_ENV as string | undefined

/**
 * Safety tripwire for CLAUDE.md rule 1: the app refuses to start against a
 * Supabase project unless the environment says which kind it is. The live
 * site (Vercel) sets "production"; .env.local on a computer sets "development".
 */
if (url && anonKey && environment !== 'development' && environment !== 'production') {
  throw new Error('Refusing to connect: set VITE_SUPABASE_ENV to "development" (.env.local) or "production" (the live site).')
}

/** True once the project's URL and anon key are set. */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** Null in preview mode (no .env.local yet); the app then runs without a backend. */
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, anonKey!) : null
