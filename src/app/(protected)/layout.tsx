import { AppFrame } from "@/components/app-frame";
import { PosOrderTabsProvider } from "@/components/pos-order-tabs-context";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PosOrderTabsProvider>
      <AppFrame>{children}</AppFrame>
    </PosOrderTabsProvider>
  );
}
