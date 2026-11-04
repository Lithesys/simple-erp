# Chạy mã nguồn và build ERP

## Yêu cầu

- Git và Node.js 24 LTS (npm đi kèm).
- Tài khoản Supabase dùng cho môi trường phát triển. Dùng một project thử nghiệm, không dùng database production để thử migration.
- Docker Desktop nếu chạy Supabase local.
- Windows x64 để tạo installer desktop.

## Chạy bản web

```powershell
git clone https://github.com/Lithesys/erp-landuylinh-release.git
cd erp-landuylinh-release
npm ci
Copy-Item .env.example .env.local
```

Điền URL và anon/publishable key của project thử nghiệm vào `.env.local`. Điền service role key vào `SUPABASE_SERVICE_ROLE_KEY` ở server; không dùng tiền tố `NEXT_PUBLIC_` cho khóa này. Đặt `ADMIN_EMAIL` và một `ADMIN_PASSWORD` riêng dài ít nhất 12 ký tự để tạo tài khoản đầu tiên.

Liên kết Supabase CLI với project thử nghiệm và xem migration trước khi áp dụng:

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF_THU_NGHIEM>
npx supabase db push --dry-run --remote
npx supabase db push --remote
npm run bootstrap:admin
npm run dev
```

Mở `http://localhost:3000`. Để dùng Supabase local, chạy `npx supabase start`, xem key bằng `npx supabase status -o env`, sau đó áp dụng schema bằng `npx supabase db reset`.

## Build bản desktop

Trên Windows x64:

```powershell
npm ci
npm run desktop:build
```

Installer nằm trong `release/`. Khi phát triển desktop, chạy `npm run desktop:dev`. Lần chạy đầu dùng database local mới và tạo `admin/admin`.

## Phát hành phiên bản

Workflow `.github/workflows/desktop-release.yml` chạy khi push tag có dạng `vX.Y.Z`. Tạo phiên bản mới trong `package.json`, kiểm tra build, rồi:

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

GitHub Actions build installer Windows và đưa file cài cùng metadata cập nhật lên GitHub Releases. Repository phát hành mặc định là `Lithesys/erp-landuylinh-release`. Không thêm token phát hành hay chứng thư ký ứng dụng vào mã nguồn; dùng GitHub Actions secrets nếu cần quyền hoặc ký code.

## Lệnh kiểm tra

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Chỉ chạy migration trên project thử nghiệm trước. Không dùng dữ liệu thật hoặc tệp dump khách hàng trong commit, issue hay release.
