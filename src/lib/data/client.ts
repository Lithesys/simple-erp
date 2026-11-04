/**
 * Shared browser data/auth entry point for ERP screens.
 *
 * The underlying Supabase-compatible client is configured by the active
 * runtime: browser deployments use the configured Supabase project, while the
 * Electron build points the same contract at its private desktop gateway.
 */
export { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
