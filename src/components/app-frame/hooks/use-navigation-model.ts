"use client";

import { useCallback, useMemo } from "react";
import {
  canAccessPage,
  canPerformAction,
  type PageAccessKey,
} from "@/lib/access-control";
import {
  APP_NAVIGATION,
  getMobileNavItems,
} from "../navigation-config";
import type { UserAccess } from "./use-user-access";

const NO_PERMISSIONS: UserAccess["permissions"] = [];

export function useNavigationModel(
  access: UserAccess | undefined,
  desktopPathname: string,
  storeName = "ERP",
) {
  const permissions = access?.permissions ?? NO_PERMISSIONS;
  const canSell = canPerformAction("pos.sell", permissions);
  const isPos = desktopPathname === "/pos";

  const accessibleNav = useMemo(
    () =>
      APP_NAVIGATION.map((item) => ({
        ...item,
        children: item.children.filter((child) =>
          canAccessPage(child.page, permissions),
        ),
      })).filter((item) => item.children.length > 0),
    [permissions],
  );

  const allAccessibleLinks = useMemo(
    () => accessibleNav.flatMap(({ children }) => children),
    [accessibleNav],
  );

  const findAccessiblePage = useCallback(
    (page: PageAccessKey) =>
      allAccessibleLinks.find((child) => child.page === page),
    [allAccessibleLinks],
  );

  const mobileNavItems = useMemo(
    () => getMobileNavItems(canSell, findAccessiblePage),
    [canSell, findAccessiblePage],
  );

  const managementHref = accessibleNav[0]?.children[0]?.href || "/account";
  const currentPageLabel =
    (desktopPathname === "/pos" && "Bán hàng") ||
    (desktopPathname === "/account" && "Tài khoản cá nhân") ||
    allAccessibleLinks.find(
      ({ href }) =>
        desktopPathname === href || desktopPathname.startsWith(`${href}/`),
    )?.label ||
    storeName;
  const currentPageIsInMobileNav = mobileNavItems.some(
    ({ href }) =>
      desktopPathname === href || desktopPathname.startsWith(`${href}/`),
  );

  return {
    accessibleNav,
    canSell,
    isPos,
    managementHref,
    mobileNavItems,
    currentPageLabel,
    currentPageIsInMobileNav,
  };
}
