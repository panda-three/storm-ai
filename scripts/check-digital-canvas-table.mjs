import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log("url set:", Boolean(url), "key set:", Boolean(key))
if (!url || !key) {
  console.log("MISSING_ENV")
  process.exit(0)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const { error } = await supabase.from("digital_canvas_documents").select("id").limit(1)
if (error) {
  console.log("TABLE_ERROR", error.code, error.message)
} else {
  console.log("TABLE_OK")
}
