import type { ReactNode } from "react";
import { mergeClassNames } from "@/lib/class-names";

export function FilterPanel({
  ariaLabel,
  heading = "Bộ lọc",
  icon,
  className,
  children,
}: {
  ariaLabel: string;
  heading?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={mergeClassNames("product-filters card", className)}
      aria-label={ariaLabel}
    >
      <div className="filter-panel-title">
        {icon}
        <span>{heading}</span>
      </div>
      {children}
    </aside>
  );
}
