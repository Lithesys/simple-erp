/**
 * Build a patch from fields that were supplied and differ from the loaded row.
 * `null` remains an explicit value; `undefined` is treated as omitted.
 */
export function changedFieldPatch<T extends object, K extends keyof T>(
  before: Partial<T> | null | undefined,
  next: Partial<T>,
  keys: readonly K[],
  areEqual: (left: T[K] | undefined, right: T[K]) => boolean = Object.is,
): Partial<Pick<T, K>> {
  const patch: Partial<Pick<T, K>> = {};

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const value = next[key];
    if (value === undefined) continue;
    if (before && areEqual(before[key], value)) continue;
    patch[key] = value as T[K];
  }

  return patch;
}
