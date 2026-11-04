import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  ERP_DESKTOP_BUILD: "true",
  NEXT_PUBLIC_DESKTOP_BUILD: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:43121",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "desktop-public-key",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.platform !== "win32") throw new Error("The first desktop installer is built on Windows.");
run(process.execPath, [path.join(root, "scripts", "download-postgrest.mjs")]);
const electronZip = path.join(root, "node_modules", "electron", "dist", "electron.exe");
try {
  await (await import("node:fs/promises")).access(electronZip);
} catch {
  run(process.execPath, [path.join(root, "node_modules", "electron", "install.js")]);
}
run(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"]);
