import { describe, expect, it } from "vitest";
import {
  ACTION_ACCESS_RULES,
  canAccessPage,
  canPerformAction,
  getLandingPath,
  PAGE_PATHS,
  PAGE_ACCESS_RULES,
  PERMISSION_CATALOG,
  type ActionAccessKey,
  type PageAccessKey,
  type PermissionPolicy,
} from "./access-control";
import type { Permission } from "./types";

const expectedPageRules: Record<PageAccessKey, PermissionPolicy> = {
  dashboard: { anyOf: ["orders.read_own", "orders.read_all"] },
  productAnalysis: { anyOf: ["orders.read_own", "orders.read_all"] },
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
};

const expectedActionRules: Record<ActionAccessKey, PermissionPolicy> = {
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
};

function matchesPolicy(
  permissions: readonly Permission[],
  policy: PermissionPolicy,
) {
  return (
    (!policy.anyOf ||
      policy.anyOf.some((permission) => permissions.includes(permission))) &&
    (!policy.allOf ||
      policy.allOf.every((permission) => permissions.includes(permission)))
  );
}

describe("protected page permission rules", () => {
  it("declares the expected access policy for every protected page", () => {
    expect(PAGE_ACCESS_RULES).toEqual(expectedPageRules);
  });

  it("enforces every page policy for every single permission grant", () => {
    for (const [page, policy] of Object.entries(expectedPageRules) as [
      PageAccessKey,
      PermissionPolicy,
    ][]) {
      for (const permission of PERMISSION_CATALOG) {
        expect(
          canAccessPage(page, [permission]),
          `${page} with only ${permission}`,
        ).toBe(matchesPolicy([permission], policy));
      }
      expect(canAccessPage(page, []), `${page} with no feature grant`).toBe(
        matchesPolicy([], policy),
      );
      const required = policy.allOf || [];
      expect(
        canAccessPage(page, required),
        `${page} with all required grants`,
      ).toBe(matchesPolicy(required, policy));
      for (const permission of required) {
        expect(
          canAccessPage(
            page,
            required.filter((grant) => grant !== permission),
          ),
          `${page} missing ${permission}`,
        ).toBe(false);
      }
    }
  });

  it("allows the dashboard nav and page for read-all users", () => {
    expect(canAccessPage("dashboard", ["orders.read_all"])).toBe(true);
    expect(canAccessPage("productAnalysis", ["orders.read_all"])).toBe(true);
    expect(canAccessPage("productAnalysis", ["orders.read_own"])).toBe(true);
    expect(canAccessPage("productAnalysis", ["products.read"])).toBe(false);
  });

  it("does not require a feature permission to open the authenticated account page", () => {
    expect(canAccessPage("account", [])).toBe(true);
  });

  it("sends each permission profile to a page it can open after login", () => {
    expect(getLandingPath(["sales.create"])).toBe("/pos");
    expect(getLandingPath(["orders.read_all"])).toBe("/dashboard");
    expect(getLandingPath(["products.read"])).toBe("/management/products");
    expect(getLandingPath(["purchases.create"])).toBe("/management/purchase");
    expect(getLandingPath(["stock_checks.create"])).toBe("/stock-check");
    expect(getLandingPath(["customers.read"])).toBe("/management/customers");
    expect(getLandingPath(["debts.read"])).toBe("/debt");
    expect(getLandingPath(["price_lists.manage"])).toBe(
      "/management/price-lists",
    );
    expect(getLandingPath(["accounts.manage"])).toBe("/management/accounts");
    expect(getLandingPath(["roles.manage"])).toBe("/management/roles");
    expect(getLandingPath(["activity_history.read"])).toBe("/activity-history");
    expect(getLandingPath([])).toBe("/account");
  });

  it("never chooses a landing route that the same permission set cannot open", () => {
    for (const permission of PERMISSION_CATALOG) {
      const path = getLandingPath([permission]);
      const page = (Object.keys(PAGE_PATHS) as PageAccessKey[]).find(
        (key) => PAGE_PATHS[key] === path,
      );
      expect(page, `${permission} landing page ${path}`).toBeDefined();
      if (page)
        expect(
          canAccessPage(page, [permission]),
          `${permission} can open ${path}`,
        ).toBe(true);
    }
  });
});

describe("page action permission rules", () => {
  it("declares the expected access policy for each gated action", () => {
    expect(ACTION_ACCESS_RULES).toEqual(expectedActionRules);
  });

  it("enforces every action policy for every single permission grant", () => {
    for (const [action, policy] of Object.entries(expectedActionRules) as [
      ActionAccessKey,
      PermissionPolicy,
    ][]) {
      for (const permission of PERMISSION_CATALOG) {
        expect(
          canPerformAction(action, [permission]),
          `${action} with only ${permission}`,
        ).toBe(matchesPolicy([permission], policy));
      }
      expect(canPerformAction(action, []), `${action} with no grant`).toBe(
        matchesPolicy([], policy),
      );
      const required = policy.allOf || [];
      expect(
        canPerformAction(action, required),
        `${action} with all required grants`,
      ).toBe(matchesPolicy(required, policy));
      for (const permission of required) {
        expect(
          canPerformAction(
            action,
            required.filter((grant) => grant !== permission),
          ),
          `${action} missing ${permission}`,
        ).toBe(false);
      }
    }
  });

  it("keeps purchase create, update, delete, and approval permissions independent", () => {
    const actions = [
      "purchases.create",
      "purchases.update",
      "purchases.delete",
      "purchases.approve",
    ] as const;
    for (const permission of actions) {
      const grants: Permission[] =
        permission === "purchases.update" || permission === "purchases.approve"
          ? [permission, "products.cost.read"]
          : [permission];
      for (const action of actions) {
        expect(canPerformAction(action, grants)).toBe(action === permission);
      }
    }
    expect(canPerformAction("purchases.edit", ["purchases.update"])).toBe(
      false,
    );
    expect(
      canPerformAction("purchases.edit", [
        "purchases.update",
        "products.cost.read",
      ]),
    ).toBe(true);
    expect(canPerformAction("purchases.approve", ["purchases.approve"])).toBe(
      false,
    );
    expect(
      canPerformAction("purchases.approve", [
        "purchases.approve",
        "products.cost.read",
      ]),
    ).toBe(true);
    expect(
      canPerformAction("purchases.createCostOverride", [
        "purchases.create",
        "purchases.update",
        "purchases.approve",
        "products.cost.read",
      ]),
    ).toBe(true);
    for (const missingPermission of [
      "purchases.create",
      "purchases.update",
      "purchases.approve",
      "products.cost.read",
    ] as const) {
      const allPermissions: Permission[] = [
        "purchases.create",
        "purchases.update",
        "purchases.approve",
        "products.cost.read",
      ];
      expect(
        canPerformAction(
          "purchases.createCostOverride",
          allPermissions.filter(
            (permission) => permission !== missingPermission,
          ),
        ),
      ).toBe(false);
    }
  });

  it("keeps customer create, update, and delete permissions independent", () => {
    const actions = [
      "customers.create",
      "customers.update",
      "customers.delete",
    ] as const;
    for (const permission of actions) {
      for (const action of actions) {
        expect(canPerformAction(action, [permission])).toBe(
          action === permission,
        );
      }
    }
  });

  it("allows POS unit-price edits only with the dedicated permission", () => {
    expect(canPerformAction("pos.editPrice", [])).toBe(false);
    expect(canPerformAction("pos.editPrice", ["sales.create"])).toBe(false);
    expect(canPerformAction("pos.editPrice", ["sales.price.override"])).toBe(
      true,
    );
  });
});
