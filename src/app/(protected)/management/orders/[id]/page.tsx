import { redirectLegacyDetailRoute } from "@/lib/legacy-detail-route";

export default function LegacyOrderDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectLegacyDetailRoute(params, searchParams, "/management/orders");
}
