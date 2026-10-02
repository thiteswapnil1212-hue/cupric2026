import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getClientEnvironment } from "../config/env";

const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
  getClientEnvironment();

export const supabase = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
