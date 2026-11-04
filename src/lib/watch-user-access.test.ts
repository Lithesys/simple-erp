import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { AuthStateListener } from "./watch-user-access";
import { watchUserAccess } from "./watch-user-access";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("watchUserAccess", () => {
  it("defers auth lookups and ignores results made stale by a refresh event", async () => {
    vi.useFakeTimers();
    let authListener: AuthStateListener | undefined;
    const firstLookup = deferred<string | null>();
    const refreshedLookup = deferred<string | null>();
    const loadAccess = vi
      .fn<() => Promise<string | null>>()
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(refreshedLookup.promise);
    const onAccess = vi.fn();
    const onSessionEnded = vi.fn();

    const stop = watchUserAccess({
      subscribe: (listener) => {
        authListener = listener;
        return vi.fn();
      },
      loadAccess,
      onAccess,
      onSessionEnded,
    });

    expect(loadAccess).toHaveBeenCalledTimes(1);
    authListener?.("TOKEN_REFRESHED", {} as Session);
    expect(loadAccess).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();
    expect(loadAccess).toHaveBeenCalledTimes(2);

    firstLookup.resolve("stale access");
    await Promise.resolve();
    expect(onAccess).not.toHaveBeenCalled();

    refreshedLookup.resolve("current access");
    await Promise.resolve();
    expect(onAccess).toHaveBeenCalledOnce();
    expect(onAccess).toHaveBeenCalledWith("current access");
    expect(onSessionEnded).not.toHaveBeenCalled();

    stop();
  });

  it("invalidates pending access lookups on sign-out", async () => {
    vi.useFakeTimers();
    let authListener: AuthStateListener | undefined;
    const pendingLookup = deferred<string | null>();
    const onAccess = vi.fn();
    const onSessionEnded = vi.fn();

    const stop = watchUserAccess({
      subscribe: (listener) => {
        authListener = listener;
        return vi.fn();
      },
      loadAccess: () => pendingLookup.promise,
      onAccess,
      onSessionEnded,
    });

    authListener?.("SIGNED_OUT", null);
    expect(onAccess).toHaveBeenCalledWith(null);
    expect(onSessionEnded).toHaveBeenCalledOnce();

    pendingLookup.resolve("stale access");
    await Promise.resolve();
    expect(onAccess).toHaveBeenCalledOnce();

    stop();
  });

  it("keeps the session when an access lookup fails temporarily", async () => {
    vi.useFakeTimers();
    const onAccess = vi.fn();
    const onSessionEnded = vi.fn();
    const loadAccess = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce("recovered access");

    const stop = watchUserAccess({
      subscribe: () => vi.fn(),
      loadAccess,
      onAccess,
      onSessionEnded,
    });

    await Promise.resolve();
    expect(onAccess).not.toHaveBeenCalled();
    expect(onSessionEnded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(loadAccess).toHaveBeenCalledTimes(2);
    expect(onAccess).toHaveBeenCalledWith("recovered access");
    expect(onSessionEnded).not.toHaveBeenCalled();

    stop();
  });
});
