import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } from "./env.js";

/**Admin Supabase client with service role key (for backend operations)
 * Bypasses RLS policies
 * Use for:
 * - Server-side file uploads/downloads
 * - Admin operations
 * - Background jobs
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

/**Standard Supabase client with anon key
 * Used for auth operations and RLS-protected queries
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    },
});