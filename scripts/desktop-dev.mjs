import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gatewayPort = process.env.ERP_DESKTOP_GATEWAY_PORT || "43122";
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const env = {
  ...process.env,
  ERP_DESKTOP_BUILD: "true",
  ERP_DESKTOP_USER_DATA_DIR:
    process.env.ERP_DESKTOP_USER_DATA_DIR ||
    path.join(root, ".desktop-dev-data"),
  ERP_DESKTOP_GATEWAY_PORT: gatewayPort,
  NEXT_PUBLIC_DESKTOP_BUILD: "true",
  NEXT_PUBLIC_SUPABASE_URL: gatewayUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "desktop-public-key",
  ERP_DESKTOP_GATEWAY_URL: gatewayUrl,
  ERP_DESKTOP_MODE: "gateway",
  ERP_DESKTOP_SERVICE_KEY: randomBytes(32).toString("base64url"),
  NEXT_TELEMETRY_DISABLED: "1",
};
const run = (file, args, options = {}) =>
  spawn(file, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });

const download = run(process.execPath, [
  path.join(root, "scripts", "download-postgrest.mjs"),
]);
const [downloadCode] = await once(download, "exit");
if (downloadCode !== 0) process.exit(downloadCode || 1);

const next = run(process.execPath, [
  path.join(root, "node_modules", "next", "dist", "bin", "next"),
  "dev",
  "--webpack",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3000",
]);
const electronArgs = [
  path.join(root, "node_modules", "electron", "cli.js"),
  ".",
];
if (process.env.ERP_DESKTOP_DEVTOOLS_PORT) {
  electronArgs.push(
    `--remote-debugging-port=${process.env.ERP_DESKTOP_DEVTOOLS_PORT}`,
    "--remote-debugging-address=127.0.0.1",
  );
}
const electron = run(process.execPath, electronArgs);
const shutdown = () => {
  next.kill();
  electron.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
electron.on("exit", (code) => {
  next.kill();
  process.exit(code || 0);
});
