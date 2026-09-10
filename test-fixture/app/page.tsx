'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { sharedSupabase } from '@/lib/supabase';
export default function Page() {
  const [status, setStatus] = useState('Ready');
  async function checkRoute() {
    try {
      const response = await fetch('/api/echo');
      if (!response.ok) throw new Error('Route failed');
      const data: { message: string } = await response.json();
      setStatus(data.message);
    } catch { setStatus('Request failed'); }
  }
  return <main><h1>stackwire integration fixture</h1><p>{status}</p>
    <Button onClick={checkRoute}>Test real route</Button>
    <Button variant="outline" onClick={() => { try { sharedSupabase(); setStatus('Client created'); } catch { setStatus('Configure Supabase first'); } }}>Create Supabase client</Button>
  </main>;
}
