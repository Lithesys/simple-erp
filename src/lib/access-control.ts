import type { Permission } from "./types";

export const PERMISSION_CATALOG = [
  "customers.create",
  "customers.read",
  "customers.update",
  "customers.delete",
  "debts.read",
  "debts.create",
  "debts.update",
  "debts.delete",
  "debts.report",
  "sales.create",
  "sales.price.override",
  "orders.read_own",
  "orders.read_all",
  "orders.edit",
  "orders.delete",
  "purchases.read",
  "purchases.create",
  "purchases.update",
  "purchases.delete",
  "purchases.approve",
  "stock_checks.read",
  "stock_checks.create",
  "stock_checks.update",
  "stock_checks.delete",
  "stock_checks.complete",
  "stock_checks.export",
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "products.cost.read",
  "price_lists.manage",
  "accounts.manage",
  "roles.manage",
  "activity_history.read",
] as const satisfies readonly Permission[];

type Assert<T extends true> = T;
export type PermissionCatalogIsComplete = Assert<
  Exclude<Permission, (typeof PERMISSION_CATALOG)[number]> extends never
    ? true
    : false
>;

export type PermissionPolicy = {
  anyOf?: readonly Permission[];
  allOf?: readonly Permission[];
};

export const PAGE_ACCESS_RULES = {
  dashboard: { anyOf: ["orders.read_own", "orders.read_all"] },
  productAnalysis: { anyOf: ["orders.read_own", "orders.read_all"] },
  salesAnalysis: { anyOf: ["orders.read_own", "orders.read_all"] },
  pos: { allOf: ["sales.create"] },
  products: { allOf: ["products.read"] },
  customers: {
    anyOf: [
      "customers.read",
      "customers.create",
      "customers.update",
      "customers.delete",
      "sales.create",
    ],
  },
  debt: {
    anyOf: [
      "debts.read",
      "debts.create",
      "debts.update",
      "debts.delete",
      "debts.report",
    ],
  },
  orders: { anyOf: ["orders.read_own", "orders.read_all"] },
  purchase: {
    anyOf: [
      "purchases.read",
      "purchases.create",
      "purchases.update",
      "purchases.delete",
      "purchases.approve",
    ],
  },
  stockCheck: {
    anyOf: [
      "stock_checks.read",
      "stock_checks.create",
      "stock_checks.update",
      "stock_checks.delete",
      "stock_checks.complete",
    ],
  },
  priceLists: { allOf: ["price_lists.manage"] },
  accounts: { allOf: ["accounts.manage"] },
  roles: { allOf: ["roles.manage"] },
  activityHistory: { allOf: ["activity_history.read"] },
  systemSettings: { allOf: [] },
  account: { allOf: [] },
} as const satisfies Record<string, PermissionPolicy>;

export type PageAccessKey = keyof typeof PAGE_ACCESS_RULES;

export const PAGE_PATHS: Record<PageAccessKey, string> = {
  dashboard: "/dashboard",
  productAnalysis: "/analysis/products",
  salesAnalysis: "/analysis/sales",
  pos: "/pos",
  products: "/management/products",
  customers: "/management/customers",
  debt: "/debt",
  orders: "/management/orders",
  purchase: "/management/purchase",
  stockCheck: "/stock-check",
  priceLists: "/management/price-lists",
  accounts: "/management/accounts",
  roles: "/management/roles",
  activityHistory: "/activity-history",
  systemSettings: "/system/settings",
  account: "/account",
};

export const ACTION_ACCESS_RULES = {
  "pos.sell": { allOf: ["sales.create"] },
  "pos.editPrice": { allOf: ["sales.price.override"] },
  "products.create": { allOf: ["products.create"] },
  "products.update": { allOf: ["products.update"] },
  "products.updateCost": { allOf: ["products.update", "products.cost.read"] },
  "products.viewCost": { allOf: ["products.cost.read"] },
  "products.archive": { allOf: ["products.archive"] },
  "customers.create": { allOf: ["customers.create"] },
  "customers.update": { allOf: ["customers.update"] },
  "customers.delete": { allOf: ["customers.delete"] },
  "debts.create": { allOf: ["debts.create"] },
  "debts.update": { allOf: ["debts.update"] },
  "debts.delete": { allOf: ["debts.delete"] },
  "debts.report": { allOf: ["debts.report"] },
  "orders.readAll": { allOf: ["orders.read_all"] },
  "orders.edit": { allOf: ["orders.edit"] },
  "orders.delete": { allOf: ["orders.delete"] },
  "orders.searchCustomers": {
    anyOf: [
      "customers.read",
      "customers.update",
      "customers.delete",
      "sales.create",
    ],
  },
  "purchases.list": {
    anyOf: [
      "purchases.read",
      "purchases.update",
      "purchases.delete",
      "purchases.approve",
    ],
  },
  "purchases.read": { allOf: ["purchases.read"] },
  "purchases.create": { allOf: ["purchases.create"] },
  "purchases.createCostOverride": {
    allOf: [
      "purchases.create",
      "purchases.update",
      "purchases.approve",
      "products.cost.read",
    ],
  },
  "purchases.update": { allOf: ["purchases.update"] },
  "purchases.edit": { allOf: ["purchases.update", "products.cost.read"] },
  "purchases.delete": { allOf: ["purchases.delete"] },
  "purchases.approve": { allOf: ["purchases.approve", "products.cost.read"] },
  "purchases.viewCost": { allOf: ["products.cost.read"] },
  "stockChecks.list": {
    anyOf: [
      "stock_checks.read",
      "stock_checks.update",
      "stock_checks.delete",
      "stock_checks.complete",
    ],
  },
  "stockChecks.read": { allOf: ["stock_checks.read"] },
  "stockChecks.create": { allOf: ["stock_checks.create"] },
  "stockChecks.update": { allOf: ["stock_checks.update"] },
  "stockChecks.delete": { allOf: ["stock_checks.delete"] },
  "stockChecks.complete": { allOf: ["stock_checks.complete"] },
  "stockChecks.saveDraft": { allOf: ["stock_checks.create"] },
  "stockChecks.export": { allOf: ["stock_checks.export"] },
} as const satisfies Record<string, PermissionPolicy>;

export type ActionAccessKey = keyof typeof ACTION_ACCESS_RULES;

export function isAllowedByPolicy(
  permissions: readonly Permission[],
  policy: PermissionPolicy,
) {
  return (
    (policy.anyOf === undefined ||
      policy.anyOf.some((permission) => permissions.includes(permission))) &&
    (policy.allOf === undefined ||
      policy.allOf.every((permission) => permissions.includes(permission)))
  );
}

export function canAccessPage(
  page: PageAccessKey,
  permissions: readonly Permission[],
) {
  return isAllowedByPolicy(permissions, PAGE_ACCESS_RULES[page]);
}

export function canPerformAction(
  action: ActionAccessKey,
  permissions: readonly Permission[],
) {
  return isAllowedByPolicy(permissions, ACTION_ACCESS_RULES[action]);
}

export function getLandingPath(permissions: readonly Permission[]) {
  const preference: readonly PageAccessKey[] = [
    "pos",
    "dashboard",
    "products",
    "salesAnalysis",
    "purchase",
    "stockCheck",
    "customers",
    "debt",
    "orders",
    "priceLists",
    "accounts",
    "roles",
    "activityHistory",
    "account",
  ];
  const page = preference.find((candidate) =>
    canAccessPage(candidate, permissions),
  );
  return page ? PAGE_PATHS[page] : "/login";
}
