"use client";

import Skeleton from "react-loading-skeleton";

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="loading-skeleton"
      aria-label="Đang tải nội dung"
      role="status"
    >
      <Skeleton height={28} width="30%" />
      <Skeleton height={38} />
      <Skeleton count={rows} height={40} />
    </div>
  );
}
