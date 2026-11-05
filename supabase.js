// supabase.js - Client init
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ⭐ Expose cho chat IIFE (non-module) dùng lại — không cần load SDK lần 2 */
if (typeof window !== 'undefined') {
  window.__supabaseCreateClient = createClient;
  window.__supabaseUrl = SUPABASE_URL;
  window.__supabaseKey = SUPABASE_KEY;
  window.__supabaseClient = supabase;
}