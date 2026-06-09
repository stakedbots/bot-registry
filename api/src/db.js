import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

// Pin the bot_registry schema. We use service-role so RLS is bypassed.
export const supabase = createClient(url, key, {
  db: { schema: "bot_registry" },
  auth: { persistSession: false, autoRefreshToken: false },
});
