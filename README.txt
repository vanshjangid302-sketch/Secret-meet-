Secret Meet replacement frontend files

Included:
- index.html: frontend with working login/signup, discovery, profile, matches, chat, block/report, and admin view
- app.js: client logic aligned to the SQL schema fields

IMPORTANT:
Keep your existing config.js file in the GitHub repository. This replacement index.html loads config.js first and expects window.SECRET_MEET_CONFIG with SUPABASE_URL and SUPABASE_ANON_KEY (uppercase keys). It can also read lowercase supabaseUrl/supabaseAnonKey.
Never put the Supabase service_role key in browser code. Use only anon/public key.

These files have not been tested against the live Supabase project in a real browser session. Verify login/signup and RLS with two test accounts before inviting people.
