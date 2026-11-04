import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import "./styles/base.css";
import "./styles/shared-controls.css";
import "./styles/pages/orders.css";
import "./styles/pages/activity-history.css";
import "./styles/pages/dashboard.css";
import "./styles/pages/product-analysis.css";
import "./styles/pages/pos.css";
import "./styles/responsive-base.css";
import "./styles/shared-interactions.css";
import "./styles/management.css";
import "./styles/pages/products.css";
import "./styles/pages/purchase.css";
import "./styles/pages/stock-check.css";
import "./styles/pages/system-settings.css";
import "./styles/management-controls.css";
import "./styles/pages/pos-records.css";
import "./styles/tables.css";
import "./styles/pages/pos-workspace.css";
import "./styles/mobile-shell.css";
import "./styles/pages/products-mobile.css";
import "./styles/pages/orders-mobile.css";
import "./styles/pages/inventory-mobile.css";
import "./styles/mobile-overlays.css";
import "./styles/pages/pos-mobile.css";
import "./styles/mobile-overrides.css";
import "./styles/mobile-card-states.css";
import "react-toastify/dist/ReactToastify.css";
import "daterangepicker/daterangepicker.css";
import "react-loading-skeleton/dist/skeleton.css";
import { ToastContainer } from "react-toastify";
import { AppProviders } from "@/components/app-providers";

const roboto = Roboto({
  subsets: ["latin", "vietnamese"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ERP",
  description: "Phần mềm quản lý bán hàng ERP",
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={roboto.variable}>
      <body>
        <AppProviders>
          {children}
          <ToastContainer position="top-right" autoClose={3200} newestOnTop />
        </AppProviders>
      </body>
    </html>
  );
}
