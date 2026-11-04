import { twMerge } from "tailwind-merge";

type ClassNamePart = string | false | null | undefined;

export function mergeClassNames(...classNames: ClassNamePart[]) {
  return twMerge(...classNames);
}
