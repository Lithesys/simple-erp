"use client";

import { useCallback } from "react";

type AppFrameActionsOptions = {
  closeMobileMenu: () => void;
  signOut: () => Promise<void>;
};

export function useAppFrameActions({
  closeMobileMenu,
  signOut,
}: AppFrameActionsOptions) {
  const handleMobileSignOut = useCallback(async () => {
    closeMobileMenu();
    await signOut();
  }, [closeMobileMenu, signOut]);

  return { handleSignOut: signOut, handleMobileSignOut };
}
