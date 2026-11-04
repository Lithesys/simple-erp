"use client";

import { useEffect } from "react";
import { getPageTitle } from "../navigation-config";
import { useStoreBrand } from "@/components/store-brand-provider";

export function useDocumentTitle(desktopPathname: string) {
  const { displayName } = useStoreBrand();
  useEffect(() => {
    const pageTitle = getPageTitle(desktopPathname);
    document.title = pageTitle ? `${pageTitle} · ${displayName}` : displayName;
  }, [desktopPathname, displayName]);
}
