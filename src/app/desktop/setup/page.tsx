import { DesktopDatabaseSettings } from "@/components/desktop-settings";

export default function DesktopSetupPage() {
  return (
    <main className="auth-page desktop-recovery-page">
      <DesktopDatabaseSettings recovery canManage />
    </main>
  );
}
