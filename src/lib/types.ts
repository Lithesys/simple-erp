export type Permission =
  | "customers.create"
  | "customers.read"
  | "customers.update"
  | "customers.delete"
  | "debts.read"
  | "debts.create"
  | "debts.update"
  | "debts.delete"
  | "debts.report"
  | "sales.create"
  | "sales.price.override"
  | "orders.read_own"
  | "orders.read_all"
  | "orders.edit"
  | "orders.delete"
  | "purchases.read"
  | "purchases.create"
  | "purchases.update"
  | "purchases.delete"
  | "purchases.approve"
  | "stock_checks.read"
  | "stock_checks.create"
  | "stock_checks.update"
  | "stock_checks.delete"
  | "stock_checks.complete"
  | "stock_checks.export"
  | "products.read"
  | "products.create"
  | "products.update"
  | "products.archive"
  | "products.cost.read"
  | "price_lists.manage"
  | "accounts.manage"
  | "roles.manage"
  | "activity_history.read";

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  kind?: "product" | "combo";
  is_active: boolean;
  product_prices: { price_list_id: string; price: number }[];
  product_costs?: { cost: number } | null;
  bundle_items?: ProductBundleItem[];
};

export type ProductBundleItem = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  is_active: boolean;
  quantity_per_bundle: number;
};

export type PriceList = {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
};

export type CartLine = { product: Product; quantity: number; price: number };
