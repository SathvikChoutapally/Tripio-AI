import { createClient } from '@supabase/supabase-js';

// Uses service role key for server-side operations (bypasses RLS where needed)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Verify a Supabase JWT and return the user
export async function verifyToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error('Invalid or expired token');
  }
  return data.user;
}

export default supabase;
