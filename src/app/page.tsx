"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { getUserPermissions } from "@/lib/auth";
import { getLandingPath } from "@/lib/access-control";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    void getUserPermissions()
      .then((access) => {
        if (active)
          router.replace(
            access ? getLandingPath(access.permissions) : "/login",
          );
      })
      .catch(() => {
        if (active) router.replace("/login");
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <div className="main">
      <LoadingSkeleton rows={4} />
    </div>
  );
}
