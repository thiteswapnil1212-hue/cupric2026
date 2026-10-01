import { z } from "zod";

const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverEnvironmentSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
});

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function getClientEnvironment(): ClientEnvironment {
  return clientEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function getServerEnvironment(): ServerEnvironment {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are only available on the server.");
  }

  return serverEnvironmentSchema.parse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  });
}