import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  ERP_DESKTOP_BUILD: "true",
  NEXT_PUBLIC_DESKTOP_BUILD: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:43121",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "desktop-public-key",
  ERP_DESKTOP_GATEWAY_URL: "http://127.0.0.1:43121",
  ERP_DESKTOP_MODE: "gateway",
  ERP_DESKTOP_SERVICE_KEY: randomBytes(32).toString("base64url"),
  NEXT_TELEMETRY_DISABLED: "1",
};
const run = (file, args, options = {}) => spawn(file, args, { cwd: root, env, stdio: "inherit", windowsHide: true, ...options });

const download = run(process.execPath, [path.join(root, "scripts", "download-postgrest.mjs")]);
const [downloadCode] = await once(download, "exit");
if (downloadCode !== 0) process.exit(downloadCode || 1);

const next = run(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", "3000"]);
const electron = run(process.execPath, [path.join(root, "node_modules", "electron", "cli.js"), "."]);
const shutdown = () => { next.kill(); electron.kill(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
electron.on("exit", (code) => { next.kill(); process.exit(code || 0); });
