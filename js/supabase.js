import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://ymfwfruzhzpvexzqwbfq.supabase.co";
export const SUPABASE_KEY = "sb_publishable_MaLbSbI140CBstTTP2ICmw_R8XEZNyy";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
