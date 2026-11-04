"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getResponsiveHref, toDesktopRoute } from "@/lib/mobile-routes";

export function useAppRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const desktopPathname = toDesktopRoute(pathname);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 720px)");
    const synchronizeRoute = () => {
      const nextHref = getResponsiveHref(
        pathname,
        window.location.search,
        window.location.hash,
        viewport.matches,
      );
      const currentHref = `${pathname}${window.location.search}${window.location.hash}`;
      if (nextHref !== currentHref) router.replace(nextHref);
    };

    synchronizeRoute();
    viewport.addEventListener("change", synchronizeRoute);
    return () => viewport.removeEventListener("change", synchronizeRoute);
  }, [pathname, router]);

  return { pathname, isMobileRoute, desktopPathname };
}
