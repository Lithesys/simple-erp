"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { mergeClassNames } from "@/lib/class-names";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  noBorder?: boolean;
};

export const AppTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AppTextarea({ className, noBorder = false, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={mergeClassNames(
          "field app-textarea",
          noBorder && "app-textarea--no-border",
          className,
        )}
      />
    );
  },
);
