export const browserClient = `'use client';
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing public Supabase configuration.');
  return createBrowserClient(url, key);
}
`;
export const serverClient = `import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing public Supabase configuration.');
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. The request proxy/middleware
          // refreshes the session; Route Handlers and Server Actions can write here.
        }
      },
    },
  });
}
`;
export const adminClient = `import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Administrative access bypasses RLS. Never import into browser code or use for user queries.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing server-side Supabase admin configuration.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
`;
export const sessionRefresh = `import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing public Supabase configuration.');
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Validate with the Auth server. Never trust getSession() for authorization.
  const { error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError' && error.status && error.status >= 500) {
    const unavailable = NextResponse.json({ error: 'Authentication service unavailable.' }, { status: 503 });
    response.cookies.getAll().forEach(cookie => unavailable.cookies.set(cookie));
    unavailable.headers.set('Cache-Control', 'private, no-store');
    return unavailable;
  }
  // This refreshes sessions; per-route authentication and authorization remain required.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
`;
export function requestEntry(name: 'proxy' | 'middleware', helperImport = './lib/supabase/middleware'): string {
  return `import type { NextRequest } from 'next/server';
import { updateSession } from ${JSON.stringify(helperImport)};

export async function ${name}(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
`;
}
