import { redirectLegacyDetailRoute } from "@/lib/legacy-detail-route";

export default function LegacyMobileDebtDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectLegacyDetailRoute(params, searchParams, "/mobile/debt");
}
