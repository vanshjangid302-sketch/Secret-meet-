// Secret Meet — Supabase public project settings.
// Supabase dashboard → Project Settings → API:
//   SUPABASE_URL      = "Project URL"           (looks like https://abcd1234.supabase.co)
//   SUPABASE_ANON_KEY = "anon / public" key     (safe to publish when Row Level Security is on)
// NEVER put the service_role / secret key here — this file is public.
window.SECRET_MEET_CONFIG = {
  SUPABASE_URL: 'PASTE_SUPABASE_PROJECT_URL_HERE',
  SUPABASE_ANON_KEY: 'PASTE_SUPABASE_ANON_PUBLIC_KEY_HERE'
};
