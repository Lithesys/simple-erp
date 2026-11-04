"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { mergeClassNames } from "@/lib/class-names";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  wrapperClassName?: string;
};

export const AppInput = forwardRef<HTMLInputElement, Props>(
  function AppInput(
    {
      type,
      className,
      wrapperClassName = "",
      iconLeft,
      iconRight,
      ...props
    },
    ref,
  ) {
    const isChoice = type === "checkbox" || type === "radio";
    const inputClassName = mergeClassNames(
      isChoice ? "app-choice-input" : type === "hidden" ? undefined : "field",
      className,
    );
    const input = (
      <input
        {...props}
        ref={ref}
        type={type}
        className={inputClassName || undefined}
      />
    );

    if (!iconLeft && !iconRight) return input;

    return (
      <span
        className={mergeClassNames(
          "app-input-shell",
          iconLeft ? "app-input-shell--leading" : undefined,
          iconRight ? "app-input-shell--trailing" : undefined,
          wrapperClassName,
        )}
      >
        {iconLeft && (
          <span className="app-input-icon app-input-icon--left" aria-hidden="true">
            {iconLeft}
          </span>
        )}
        {input}
        {iconRight && (
          <span className="app-input-icon app-input-icon--right" aria-hidden="true">
            {iconRight}
          </span>
        )}
      </span>
    );
  },
);
