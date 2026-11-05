"use client";

import { AppInput } from "@/components/app-input";
import {
  useAutoPrintSetting,
  useSilentPrintSetting,
} from "@/lib/system-settings";
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
  const [silentPrint, setSilentPrint, silentPrintReady] = useSilentPrintSetting();

  return (
    <section className="system-settings-page">
      <header className="page-heading">
        <div>
          <h1>Cài đặt</h1>
          <p>Tùy chỉnh hoạt động của ứng dụng trên thiết bị này.</p>
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
        <p className="system-settings-note">
          Tên cửa hàng được lưu trong trình duyệt này, không lưu vào cơ sở dữ liệu.
        </p>
      </div>
      <div className="card system-settings-card">
        <h2>Cài đặt in</h2>
        <label className="system-setting-row">
          <span className="system-setting-copy">
            <strong>Tự động in sau khi sửa hóa đơn</strong>
            <span>
              Tự gửi hóa đơn đến máy in sau khi lưu chỉnh sửa thành công.
            </span>
          </span>
          <AppInput
            type="checkbox"
            className="system-setting-checkbox"
            aria-label="Tự động in sau khi sửa hóa đơn"
            checked={autoPrint}
            disabled={!ready}
            onChange={(event) => setAutoPrint(event.target.checked)}
          />
        </label>
        <label className="system-setting-row">
          <span className="system-setting-copy">
            <strong>In thẳng, không mở hộp thoại</strong>
            <span>
              Khi bật, phiếu được gửi trực tiếp đến máy in mặc định. Khi tắt, ứng dụng mở hộp thoại in để bạn chọn máy in và tuỳ chỉnh.
            </span>
          </span>
          <AppInput
            type="checkbox"
            className="system-setting-checkbox"
            aria-label="In thẳng, không mở hộp thoại"
            checked={silentPrint}
            disabled={!silentPrintReady}
            onChange={(event) => setSilentPrint(event.target.checked)}
          />
        </label>
        <p className="system-settings-note">
          Tùy chọn in được lưu trên thiết bị này và áp dụng từ lần in tiếp theo, không cần khởi động lại ứng dụng. Cần cài sẵn driver phù hợp với máy in và đặt máy in đó làm mặc định. Chế độ in thẳng dùng khổ giấy mặc định trong driver.
        </p>
      </div>
      <DesktopDatabaseSettings canManage={access?.role === "Admin"} />
    </section>
  );
}
