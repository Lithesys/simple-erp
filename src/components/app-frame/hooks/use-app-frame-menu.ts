"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function useAppFrameMenu() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMoreButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMoreCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuWasOpenRef = useRef(false);
  const mobileMenuRestoreRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!openMenu && !mobileMenuOpen) return;

    function closeOutside(event: PointerEvent) {
      if (
        openMenu &&
        !(event.target as Element | null)?.closest(".primary-nav-group")
      ) {
        setOpenMenu(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu, mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      mobileMoreCloseRef.current?.focus();
    } else if (mobileMenuWasOpenRef.current) {
      mobileMenuRestoreRef.current?.focus();
    }
    mobileMenuWasOpenRef.current = mobileMenuOpen;
  }, [mobileMenuOpen]);

  const togglePrimaryMenu = useCallback((label: string) => {
    setOpenMenu((current) => (current === label ? null : label));
  }, []);

  const openPrimaryMenu = useCallback((label: string) => {
    setOpenMenu(label);
  }, []);

  const leavePrimaryMenu = useCallback((label: string) => {
    setOpenMenu((current) => (current === label ? null : current));
  }, []);

  const closePrimaryMenu = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const toggleMobileMenu = useCallback(
    (restoreFocusTo: HTMLButtonElement | null) => {
      mobileMenuRestoreRef.current = restoreFocusTo;
      setOpenMenu(null);
      setMobileMenuOpen((current) => !current);
    },
    [],
  );

  const handleMobileMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && first && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        last &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first?.focus();
      }
    },
    [],
  );

  return {
    openMenu,
    mobileMenuOpen,
    mobileMenuTriggerRef,
    mobileMoreButtonRef,
    mobileMoreCloseRef,
    togglePrimaryMenu,
    openPrimaryMenu,
    leavePrimaryMenu,
    closePrimaryMenu,
    closeMobileMenu,
    toggleMobileMenu,
    handleMobileMenuKeyDown,
  };
}
