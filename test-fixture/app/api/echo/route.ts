import { sharedSupabase } from '@/lib/supabase';
export async function GET() {
  // Shared with a browser component intentionally, to exercise boundary diagnostics.
  return Response.json({ message: 'The shadcn button is connected to a real Route Handler.', configured: typeof sharedSupabase === 'function' });
}
