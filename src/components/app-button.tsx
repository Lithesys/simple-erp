"use client";

import {
  Children,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { mergeClassNames } from "@/lib/class-names";

export type AppButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "default";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: AppButtonVariant;
  iconOnly?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

const variantClasses: Record<AppButtonVariant, string> = {
  primary: "app-button--primary",
  secondary: "app-button--secondary",
  ghost: "app-button--ghost",
  danger: "app-button--danger",
  default: "app-button--default",
};
const legacyVariantClasses: Record<AppButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-quiet",
  danger: "btn-danger",
  default: "btn-default",
};

export const AppButton = forwardRef<HTMLButtonElement, Props>(
  function AppButton(
    {
      variant,
      iconOnly = false,
      iconLeft,
      iconRight,
      className = "",
      children,
      ...props
    },
    ref,
  ) {
    const childItems = Children.toArray(children);
    const hasTextContent = childItems.some(
      (child) => typeof child === "string" || typeof child === "number",
    );
    const hasOnlyIcon =
      !hasTextContent &&
      childItems.length === 1 &&
      isValidElement(childItems[0]) &&
      childItems[0].type === "svg";
    const classes = mergeClassNames(
      "app-button",
      variantClasses[variant],
      (iconOnly || hasOnlyIcon) && "app-button--icon-only",
      "btn",
      legacyVariantClasses[variant],
      className,
    );

    return (
      <button ref={ref} className={classes} {...props}>
        {iconLeft && (
          <span
            className="app-button-icon app-button-icon--left"
            aria-hidden="true"
          >
            {iconLeft}
          </span>
        )}
        {children}
        {iconRight && (
          <span
            className="app-button-icon app-button-icon--right"
            aria-hidden="true"
          >
            {iconRight}
          </span>
        )}
      </button>
    );
  },
);
