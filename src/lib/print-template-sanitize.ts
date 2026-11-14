import { defaultSchema, type Options as Schema } from "rehype-sanitize";
import { PRINT_TEMPLATE_FONT_SIZES } from "@/lib/print-template";

const allowedSpanClasses = [
  "receipt-line-align-center",
  "receipt-line-align-right",
  ...PRINT_TEMPLATE_FONT_SIZES.map(
    (fontSize) => `receipt-font-size-${fontSize}`,
  ),
];

export const PRINT_TEMPLATE_SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "print-template-columns"],
      "data-print-columns",
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", ...allowedSpanClasses],
    ],
  },
};
