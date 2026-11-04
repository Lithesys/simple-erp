"use client";

import { AppInput } from "@/components/app-input";
import { useAutoPrintSetting } from "@/lib/system-settings";
import { useUserAccess } from "@/components/app-frame/hooks/use-user-access";
import { DesktopDatabaseSettings } from "@/components/desktop-settings";
import {
  countStoreNameCharacters,
  useStoreBrand,
} from "@/components/store-brand-provider";

export function SystemSettingsPage() {
  const { access } = useUserAccess();
  const { storeName, setStoreName, isLoaded } = useStoreBrand();
  const [autoPrint, setAutoPrint, ready] = useAutoPrintSetting(
    access?.user.id ?? null,
  );

  return (
    <section className="system-settings-page">
      <header className="page-heading">
        <div>
          <h1>Cài đặt</h1>
          <p>Tùy chỉnh cách ứng dụng hoạt động trên trình duyệt này.</p>
        </div>
      </header>
      <div className="card system-settings-card">
        <label className="system-setting-row">
          <span className="system-setting-copy">
            <strong>Tên cửa hàng</strong>
            <span>
              Hiển thị trên tiêu đề ứng dụng, thanh điều hướng và hóa đơn. Tối đa 20 ký tự.
            </span>
            <AppInput
              className="field"
              type="text"
              value={storeName}
              maxLength={40}
              disabled={!isLoaded || access?.role !== "Admin"}
              aria-label="Tên cửa hàng"
              onChange={(event) => setStoreName(event.target.value)}
            />
            <small>{countStoreNameCharacters(storeName)}/20 ký tự</small>
          </span>
        </label>
        <label className="system-setting-row">
          <span className="system-setting-copy">
            <strong>In tự động</strong>
            <span>
              Tự động mở hộp thoại in sau khi sửa hóa đơn thành công.
            </span>
          </span>
          <AppInput
            type="checkbox"
            className="system-setting-checkbox"
            aria-label="In tự động"
            checked={autoPrint}
            disabled={!ready}
            onChange={(event) => setAutoPrint(event.target.checked)}
          />
        </label>
        <p className="system-settings-note">
          Tên cửa hàng và tùy chọn in tự động được lưu trong trình duyệt này, không lưu vào cơ sở dữ liệu.
        </p>
      </div>
      <DesktopDatabaseSettings canManage={access?.role === "Admin"} />
    </section>
  );
}
