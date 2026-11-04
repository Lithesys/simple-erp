import type { HTMLAttributes } from "react";
import { mergeClassNames } from "@/lib/class-names";

type AppBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "danger";
};

export function AppBadge({
  tone = "neutral",
  className = "",
  ...props
}: AppBadgeProps) {
  const toneClass =
    tone === "success"
      ? "badge-green"
      : tone === "warning"
        ? "badge-amber"
        : tone === "danger"
          ? "badge-red"
          : "";

  return (
    <span
      {...props}
      className={mergeClassNames("badge", toneClass, className)}
    />
  );
}
