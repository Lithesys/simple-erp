"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

const entityDetailIdChangeEvent = "app:entity-detail-id-change";
const activeEntityDetailIds = new Map<string, string>();

function getEntityDetailId(search: string) {
  return new URLSearchParams(search).get("id") || null;
}

export function buildEntityDetailUrl(
  href: string,
  id: string | null,
  removeParams: string[] = [],
) {
  const url = new URL(href);
  for (const key of removeParams) url.searchParams.delete(key);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  return `${url.pathname}${url.search}${url.hash}`;
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(entityDetailIdChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(entityDetailIdChangeEvent, onStoreChange);
  };
}

function getSnapshot() {
  return getEntityDetailId(window.location.search);
}

function getServerSnapshot() {
  return null;
}

function getActiveEntityDetailId() {
  const currentId = getEntityDetailId(window.location.search);
  return (
    currentId || activeEntityDetailIds.get(window.location.pathname) || null
  );
}

function updateEntityDetailId(
  id: string | null,
  options: { replace?: boolean; removeParams?: string[] } = {},
) {
  if (id) activeEntityDetailIds.set(window.location.pathname, id);
  const next = buildEntityDetailUrl(
    window.location.href,
    id,
    options.removeParams,
  );
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;

  const replace = options.replace || !id;
  window.history[replace ? "replaceState" : "pushState"](
    window.history.state,
    "",
    next,
  );
  window.dispatchEvent(new Event(entityDetailIdChangeEvent));
}

export function useEntityDetailId() {
  const id = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activeId = useSyncExternalStore(
    subscribe,
    getActiveEntityDetailId,
    getServerSnapshot,
  );
  useEffect(() => {
    if (!id) return;
    const pathname = window.location.pathname;
    if (activeEntityDetailIds.get(pathname) === id) return;
    activeEntityDetailIds.set(pathname, id);
    window.dispatchEvent(new Event(entityDetailIdChangeEvent));
  }, [id]);
  const open = useCallback((nextId: string) => {
    if (!nextId.trim()) return;
    updateEntityDetailId(nextId);
  }, []);
  const replace = useCallback((nextId: string, removeParams: string[] = []) => {
    if (!nextId.trim()) return;
    updateEntityDetailId(nextId, { replace: true, removeParams });
  }, []);
  const close = useCallback(() => updateEntityDetailId(null), []);

  return useMemo(
    () => ({ id, activeId, open, replace, close }),
    [id, activeId, open, replace, close],
  );
}
