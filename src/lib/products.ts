import type { Product } from "./types";

// product_id is the primary key of product_costs: PostgREST returns one object.
export function productCost(product: Pick<Product, "product_costs">): number {
  return product.product_costs?.cost ?? 0;
}
