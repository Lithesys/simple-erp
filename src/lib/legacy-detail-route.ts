import { redirect } from "next/navigation";

type LegacyDetailParams = Promise<{ id: string }>;
type LegacyDetailSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function redirectLegacyDetailRoute(
  params: LegacyDetailParams,
  searchParams: LegacyDetailSearchParams,
  listPath: string,
): Promise<never> {
  const [routeParams, query] = await Promise.all([params, searchParams]);
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === "id" || value == null) continue;
    for (const entry of Array.isArray(value) ? value : [value])
      next.append(key, entry);
  }
  next.set("id", routeParams.id);
  redirect(`${listPath}?${next.toString()}`);
}
