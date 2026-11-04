import type { Product } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

const QUANTITY_SCALE = 1000;

export function getBundleComponentQuantity(
  quantityPerBundle: number,
  bundleQuantity: number,
) {
  return (
    Math.round(quantityPerBundle * bundleQuantity * QUANTITY_SCALE) /
    QUANTITY_SCALE
  );
}

export function hasSellableBundleItems(product: Product) {
  return (
    product.kind !== "combo" ||
    ((product.bundle_items?.length ?? 0) > 0 &&
      product.bundle_items?.every((item) => item.is_active) === true)
  );
}

export async function attachProductBundleItems(
  supabase: SupabaseClient,
  products: Product[],
) {
  const comboIds = products
    .filter((product) => product.kind === "combo")
    .map((product) => product.id);
  if (comboIds.length === 0) return products;

  const result = await supabase
    .from("product_bundle_items")
    .select(
      "bundle_product_id,product_id,quantity_per_bundle,products!product_bundle_items_product_id_fkey(id,sku,name,unit,stock,is_active)",
    )
    .in("bundle_product_id", comboIds);
  if (result.error) throw result.error;

  const byBundle = new Map<string, NonNullable<Product["bundle_items"]>>();
  for (const row of (result.data ?? []) as unknown as {
    bundle_product_id: string;
    product_id: string;
    quantity_per_bundle: number;
    products: {
      id: string;
      sku: string;
      name: string;
      unit: string;
      stock: number;
      is_active: boolean;
    } | null;
  }[]) {
    if (!row.products) continue;
    const bundleItems = byBundle.get(row.bundle_product_id) ?? [];
    bundleItems.push({
      product_id: row.product_id,
      sku: row.products.sku,
      name: row.products.name,
      unit: row.products.unit,
      stock: Number(row.products.stock),
      is_active: row.products.is_active,
      quantity_per_bundle: Number(row.quantity_per_bundle),
    });
    byBundle.set(row.bundle_product_id, bundleItems);
  }

  return products.map((product) =>
    product.kind === "combo"
      ? { ...product, bundle_items: byBundle.get(product.id) ?? [] }
      : product,
  );
}
