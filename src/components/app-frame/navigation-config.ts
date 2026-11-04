import {
  LayoutDashboard,
  Package,
  ReceiptText,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import type { PageAccessKey } from "@/lib/access-control";

export type NavChild = {
  href: string;
  label: string;
  page: PageAccessKey;
};

export type NavGroup = {
  label: string;
  children: NavChild[];
};

export type MobileNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const APP_NAVIGATION: NavGroup[] = [
  {
    label: "Tổng quan",
    children: [
      { href: "/dashboard", label: "Trang tổng quan", page: "dashboard" },
    ],
  },
  {
    label: "Hàng hóa",
    children: [
      {
        href: "/management/products",
        label: "Danh sách hàng hóa",
        page: "products",
      },
      {
        href: "/management/purchase",
        label: "Danh sách nhập hàng",
        page: "purchase",
      },
      {
        href: "/stock-check",
        label: "Kiểm kho",
        page: "stockCheck",
      },
      {
        href: "/management/price-lists",
        label: "Quản lý bảng giá",
        page: "priceLists",
      },
    ],
  },
  {
    label: "Phân tích",
    children: [
      {
        href: "/analysis/products",
        label: "Hàng hóa",
        page: "productAnalysis",
      },
    ],
  },
  {
    label: "Khách hàng",
    children: [
      {
        href: "/management/customers",
        label: "Danh sách khách hàng",
        page: "customers",
      },
      { href: "/debt", label: "Quản lý nợ", page: "debt" },
    ],
  },
  {
    label: "Đơn hàng",
    children: [
      {
        href: "/management/orders",
        label: "Danh sách đơn hàng",
        page: "orders",
      },
    ],
  },
  {
    label: "Tài khoản",
    children: [
      { href: "/management/accounts", label: "Tài khoản", page: "accounts" },
    ],
  },
  {
    label: "Vai trò",
    children: [{ href: "/management/roles", label: "Vai trò", page: "roles" }],
  },
  {
    label: "Hệ thống",
    children: [
      {
        href: "/system/settings",
        label: "Cài đặt",
        page: "systemSettings",
      },
      {
        href: "/activity-history",
        label: "Lịch sử thao tác",
        page: "activityHistory",
      },
    ],
  },
];

export function getPageTitle(desktopPathname: string) {
  if (desktopPathname === "/pos") return "Bán hàng";
  if (desktopPathname === "/account") return "Tài khoản cá nhân";

  return APP_NAVIGATION.flatMap((item) => item.children).find(
    ({ href }) =>
      desktopPathname === href || desktopPathname.startsWith(`${href}/`),
  )?.label;
}

export function getMobileNavItems(
  canSell: boolean,
  findAccessiblePage: (page: PageAccessKey) => NavChild | undefined,
): MobileNavItem[] {
  return [
    ...(canSell
      ? [{ href: "/pos", label: "Bán hàng", icon: ShoppingCart }]
      : []),
    ...(findAccessiblePage("dashboard")
      ? [
          {
            href: "/dashboard",
            label: "Tổng quan",
            icon: LayoutDashboard,
          },
        ]
      : []),
    ...(findAccessiblePage("products")
      ? [{ href: "/management/products", label: "Hàng hóa", icon: Package }]
      : []),
    ...(findAccessiblePage("orders")
      ? [{ href: "/management/orders", label: "Đơn hàng", icon: ReceiptText }]
      : []),
  ].slice(0, 4);
}
