"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/data/client";
import {
  DEFAULT_PRINT_TEMPLATE,
  type PrintTemplate,
} from "@/lib/print-template";

export const PRINT_TEMPLATES_QUERY_KEY = ["print-templates"] as const;
const PRINT_TEMPLATES_STALE_TIME = 5 * 60 * 1000;

export function usePrintTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;
    const { data } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        receivedAuthEvent = true;
        setUserId(session?.user.id ?? null);
        setSessionReady(true);
      },
    );

    void supabase.auth
      .getSession()
      .then(({ data: sessionData }: { data: { session: Session | null } }) => {
        if (!active || receivedAuthEvent) return;
        setUserId(sessionData.session?.user.id ?? null);
        setSessionReady(true);
      })
      .catch(() => {
        if (!active || receivedAuthEvent) return;
        setUserId(null);
        setSessionReady(true);
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const queryKey = useMemo(
    () => [...PRINT_TEMPLATES_QUERY_KEY, userId ?? "anonymous"] as const,
    [userId],
  );
  const queryFn = useCallback(async () => {
    const { data, error } = await supabase
      .from("print_templates")
      .select(
        "id,name,content,paper_width_mm,paper_orientation,is_default,created_at,updated_at",
      )
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []) as PrintTemplate[];
  }, [supabase]);

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: sessionReady,
    staleTime: PRINT_TEMPLATES_STALE_TIME,
    refetchOnWindowFocus: false,
  });

  const ensureLoaded = useCallback(async () => {
    if (!sessionReady) {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user.id ?? null);
      setSessionReady(true);
    }
    const { data } = await supabase.auth.getSession();
    const nextUserId = data.session?.user.id ?? null;
    const nextKey = [...PRINT_TEMPLATES_QUERY_KEY, nextUserId ?? "anonymous"];
    return queryClient.fetchQuery({
      queryKey: nextKey,
      queryFn,
      staleTime: PRINT_TEMPLATES_STALE_TIME,
    });
  }, [queryClient, queryFn, sessionReady, supabase]);

  const templates = query.data ?? [];
  return {
    templates,
    defaultTemplate:
      templates.find((template) => template.is_default) ??
      DEFAULT_PRINT_TEMPLATE,
    userId,
    loading: !sessionReady || query.isPending,
    error: query.error,
    ensureLoaded,
    refresh: query.refetch,
  };
}
