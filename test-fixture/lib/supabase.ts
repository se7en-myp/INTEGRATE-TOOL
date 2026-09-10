// Deliberately wrong integration: one shared factory. Replace imports after connect supabase.
import { createClient } from '@supabase/supabase-js';
export function sharedSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
