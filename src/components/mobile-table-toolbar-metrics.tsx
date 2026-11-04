import type { ReactNode } from "react";
import { mergeClassNames } from "../lib/class-names";

export type MobileTableToolbarMetric = {
  label: string;
  value: ReactNode;
};

export function MobileTableToolbarMetrics({
  metrics,
  className,
}: {
  metrics: readonly MobileTableToolbarMetric[];
  className?: string;
}) {
  if (!metrics.length) return null;

  return (
    <section
      className={mergeClassNames(
        "dashboard-metrics mobile-table-toolbar-metrics",
        className,
      )}
      aria-label="Thống kê bảng"
    >
      {metrics.map(({ label, value }) => (
        <article className="card dashboard-metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

