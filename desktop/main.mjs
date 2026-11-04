import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { fork } from "node:child_process";
import updater from "electron-updater";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { jwtVerify, SignJWT } from "jose";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;
const { autoUpdater } = updater;
const root = path.dirname(fileURLToPath(import.meta.url));
// Keep existing database/config files in place when the display name changes.
const stableUserDataPath = process.env.ERP_DESKTOP_USER_DATA_DIR?.trim()
  ? path.resolve(process.env.ERP_DESKTOP_USER_DATA_DIR)
  : path.join(app.getPath("appData"), "lan-duy-linh-pos");
app.setPath("userData", stableUserDataPath);
const gatewayPort = Number(process.env.ERP_DESKTOP_GATEWAY_PORT || 43121);
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const serviceKey = process.env.ERP_DESKTOP_SERVICE_KEY || randomBytes(32).toString("base64url");
let windowInstance;
let gatewayServer;
let engineProcess;
let nextChild;
let nextChildExitCode = null;
let connection = null;
let backend = { mode: "local", restUrl: null, dbUrl: null, anonJwt: null, serviceJwt: null, status: "starting" };
let lastError = "";
let quitting = false;
let appPort = 43130;
let updateState = { status: "idle", currentVersion: app.getVersion() };
let updateCheckPromise = null;
let updateDownloadPromise = null;
let updateInstallStarted = false;
let pending = new Map();
let requestCounter = 0;
let activeDatabaseOperations = 0;
let databaseIdleWaiters = [];
let switchingDatabase = false;

function waitForDatabaseIdle() {
  if (activeDatabaseOperations === 0) return Promise.resolve();
  return new Promise((resolve) => databaseIdleWaiters.push(resolve));
}

function completeDatabaseOperation() {
  activeDatabaseOperations = Math.max(0, activeDatabaseOperations - 1);
  if (activeDatabaseOperations === 0) {
    const waiters = databaseIdleWaiters;
    databaseIdleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function encryptedConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.enc");
}

function sanitizeError(error, secret = "") {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");
  if (secret) message = message.replaceAll(secret, "••••••••");
  return message.replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1••••••••@");
}

async function loadConfig() {
  try {
    const encrypted = await readFile(encryptedConfigPath(), "utf8");
    const bytes = Buffer.from(JSON.parse(encrypted).value, "base64");
    const decrypted = await safeStorage.decryptStringAsync(bytes);
    return JSON.parse(decrypted.result);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { mode: "local", jwtSecret: randomBytes(32).toString("base64url") };
    }
    throw new Error("The saved desktop connection could not be decrypted. Repair it from the desktop setup screen.");
  }
}

async function saveConfig(config) {
  const folder = app.getPath("userData");
  await mkdir(folder, { recursive: true });
  const bytes = await safeStorage.encryptStringAsync(JSON.stringify(config));
  const temporary = `${encryptedConfigPath()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ value: bytes.toString("base64") }), { mode: 0o600 });
  await rename(temporary, encryptedConfigPath());
  const saved = await loadConfig();
  if (JSON.stringify(saved) !== JSON.stringify(config)) {
    throw new Error("The desktop connection was not saved correctly. The database was not switched.");
  }
}

function getMigrationsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "desktop", "migrations")
    : path.join(root, "..", "supabase", "migrations");
}

function getPostgrestPath() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "desktop", "postgrest.exe")
    : path.join(root, "..", "build", "postgrest-runtime", "postgrest.exe");
  return existsSync(candidate) ? candidate : "";
}

function sendUpdateState(state) {
  updateState = { ...updateState, ...state, currentVersion: app.getVersion() };
  windowInstance?.webContents.send("desktop:update-state", updateState);
}

function requestEngine(type, payload = {}) {
  if (!engineProcess) return Promise.reject(new Error("The desktop database engine is not running."));
  const requestId = `${Date.now()}-${++requestCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("The desktop database engine did not respond in time."));
    }, 60_000);
    pending.set(requestId, { resolve, reject, timer });
    engineProcess.send({ type, requestId, ...payload });
  });
}

function startEngine() {
  const entry = path.join(root, "database-engine.mjs");
  engineProcess = fork(entry, [], {
    execPath: process.execPath,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ERP_DESKTOP_DATA_DIR: path.join(app.getPath("userData"), "database"),
      ERP_DESKTOP_MIGRATIONS_DIR: getMigrationsPath(),
      ERP_DESKTOP_POSTGREST: getPostgrestPath(),
    },
  });
  engineProcess.stdout?.on("data", (chunk) => { if (!app.isPackaged) process.stdout.write(`[database] ${chunk}`); });
  engineProcess.stderr?.on("data", (chunk) => { if (!app.isPackaged) process.stderr.write(`[database] ${chunk}`); });
  engineProcess.on("message", (message) => {
    if (!app.isPackaged) console.log(`[database IPC] ${message?.type || "message"}${message?.error ? `: ${message.error}` : ""}`);
    if (message?.type === "migration-progress") {
      windowInstance?.webContents.send("desktop:migration-progress", message);
      return;
    }
    if (message?.type === "backend-error") {
      lastError = sanitizeError(message.error, connection?.connectionString);
      backend.status = "error";
      return;
    }
    if (message?.requestId) {
      const item = pending.get(message.requestId);
      if (item) {
        clearTimeout(item.timer);
        pending.delete(message.requestId);
        if (message.error) item.reject(new Error(sanitizeError(message.error, connection?.connectionString)));
        else item.resolve(message.result);
      }
    }
    if (message?.type === "backend-ready") {
      backend = {
        ...backend,
        mode: message.result.mode,
        status: message.result.status || "ready",
        restUrl: message.restUrl || null,
        dbUrl: message.dbUrl || null,
        anonJwt: message.anonJwt || null,
        serviceJwt: message.serviceJwt || null,
      };
      lastError = message.result.needsInitialization
        ? "This database is empty. Choose Initialize ERP to create its schema."
        : "";
    }
  });
  engineProcess.on("exit", (code) => {
    if (quitting) return;
    backend.status = "error";
    lastError = `The database engine stopped (${code ?? "unknown"}).`;
  });
}

async function findAvailablePort(startAt) {
  for (let port = startAt; port < startAt + 100; port += 1) {
    try {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => server.close(resolve));
      });
      return port;
    } catch {
      // Try the next private loopback port.
    }
  }
  throw new Error("Could not find an available local web server port.");
}

function currentWindowOrigin() {
  return `http://127.0.0.1:${appPort}`;
}

async function signDesktopToken(userId, email, role = "authenticated", expiresIn = "365d") {
  return new SignJWT({ role, aud: role, email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(connection.jwtSecret));
}

async function verifyDesktopToken(token) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(connection.jwtSecret), { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string") throw new Error("Invalid session.");
  return payload;
}

async function withDatabase(action) {
  if (!backend.dbUrl) throw new Error("The selected database does not support local account operations.");
  const client = new Client({ connectionString: backend.dbUrl, connectionTimeoutMillis: 8_000 });
  await client.connect();
  try { return await action(client); }
  finally { await client.end().catch(() => undefined); }
}

async function requireDatabaseAdministrator(accessToken, recovery) {
  if (recovery && ["error", "empty"].includes(backend.status)) return;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Sign in as an administrator before changing the database.");
  }

  let userId;
  if (connection?.mode === "supabase") {
    const response = await fetch(`${connection.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: connection.anonKey,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    const user = await response.json().catch(() => ({}));
    if (!response.ok || typeof user.id !== "string") {
      throw new Error("The current Supabase session is invalid. Sign in again before changing the database.");
    }
    userId = user.id;
  } else {
    const payload = await verifyDesktopToken(accessToken);
    userId = payload.sub;
  }

  const connectionString = connection?.mode === "local" ? backend.dbUrl : connection?.connectionString;
  if (!connectionString) throw new Error("The current database connection is unavailable.");
  const client = new Client({ connectionString, connectionTimeoutMillis: 8_000 });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM public.profiles p
         JOIN public.roles r ON r.id = p.role_id
         WHERE p.id = $1 AND p.is_active = true AND r.name = 'Admin'
       ) AS is_admin`,
      [userId],
    );
    if (!rows[0]?.is_admin) throw new Error("Only an administrator can change the database connection.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

function authUser(row) {
  return {
    id: row.id,
    aud: row.aud || "authenticated",
    role: row.role || "authenticated",
    email: row.email,
    app_metadata: row.raw_app_meta_data || {},
    user_metadata: row.raw_user_meta_data || {},
    email_confirmed_at: row.email_confirmed_at,
    phone: row.phone || "",
    confirmed_at: row.confirmed_at || row.email_confirmed_at,
    last_sign_in_at: row.last_sign_in_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const userSelect = `SELECT id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  email_confirmed_at, confirmed_at, phone, last_sign_in_at, created_at, updated_at,
  encrypted_password FROM auth.users`;

async function authHandler(request, pathname, url) {
  if (connection?.mode === "supabase") return proxyToSupabase(request, pathname, url);
  if (pathname === "/auth/v1/health") return json({ message: "ok" });
  if (pathname === "/auth/v1/user" && request.method === "GET") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || token === "desktop-public-key") return json({ message: "Invalid JWT" }, 401);
    let payload;
    try {
      payload = await verifyDesktopToken(token);
    } catch {
      return json({ message: "Invalid JWT" }, 401);
    }
    let user;
    try {
      user = await withDatabase(async (client) => {
        const result = await client.query(`${userSelect} WHERE id = $1`, [payload.sub]);
        return result.rows[0] ? authUser(result.rows[0]) : null;
      });
    } catch {
      return json({ message: "The desktop database could not load this session." }, 503);
    }
    return user ? json(user) : json({ message: "User not found" }, 404);
  }
  if (pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token" && request.method === "POST") {
    let payload;
    try {
      const body = await readJson(request);
      ({ payload } = await jwtVerify(body.refresh_token, new TextEncoder().encode(connection.jwtSecret), { algorithms: ["HS256"] }));
      if (payload.purpose !== "refresh" || typeof payload.sub !== "string") throw new Error("Invalid refresh token.");
    } catch {
      return json({ message: "Invalid refresh token" }, 401);
    }
    let row;
    try {
      row = await withDatabase(async (client) => {
        const result = await client.query(`${userSelect} WHERE id = $1`, [payload.sub]);
        return result.rows[0];
      });
    } catch {
      return json({ message: "The desktop database could not refresh this session." }, 503);
    }
    if (!row) return json({ message: "User not found" }, 401);
    const accessToken = await signDesktopToken(row.id, row.email);
    const refreshToken = await new SignJWT({ purpose: "refresh" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setIssuedAt().setAudience("desktop-refresh").setExpirationTime("365d").sign(new TextEncoder().encode(connection.jwtSecret));
    return json({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer", expires_in: 31_536_000, expires_at: Math.floor(Date.now() / 1000) + 31_536_000, user: authUser(row) });
  }
  if (pathname === "/auth/v1/logout" && request.method === "POST") return json({});
  if (pathname === "/auth/v1/user" && ["PUT", "PATCH", "POST"].includes(request.method)) {
    try {
      const user = await requireUser(request);
      const body = await readJson(request);
      const row = await withDatabase(async (client) => {
        if (body.password) {
          const hash = await bcrypt.hash(String(body.password), 12);
          await client.query("UPDATE auth.users SET encrypted_password = $2, updated_at = now() WHERE id = $1", [user.sub, hash]);
        }
        if (body.email) await client.query("UPDATE auth.users SET email = $2, updated_at = now() WHERE id = $1", [user.sub, String(body.email).toLowerCase()]);
        if (body.data && typeof body.data === "object") await client.query("UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now() WHERE id = $1", [user.sub, JSON.stringify(body.data)]);
        const result = await client.query(`${userSelect} WHERE id = $1`, [user.sub]);
        return result.rows[0];
      });
      return json(authUser(row));
    } catch (error) { return json({ message: sanitizeError(error) }, 401); }
  }
  if (pathname === "/auth/v1/admin/users") return adminUsersHandler(request, url);
  const adminId = pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)?.[1];
  if (adminId) return adminUserHandler(request, adminId);
  return json({ message: "Endpoint not found" }, 404);
}

function hasServiceCapability(request) {
  return request.headers.get("x-desktop-service-key") === serviceKey;
}

async function requireUser(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing session.");
  return verifyDesktopToken(token);
}

async function requireService(request) {
  if (!hasServiceCapability(request)) throw new Error("Unauthorized.");
}

async function adminUsersHandler(request, url) {
  try {
    await requireService(request);
    if (request.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const perPage = Math.min(1000, Math.max(1, Number(url.searchParams.get("per_page")) || 50));
      const result = await withDatabase(async (client) => client.query(`${userSelect} ORDER BY created_at LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage]));
      const count = await withDatabase(async (client) => client.query("SELECT count(*)::int AS total FROM auth.users"));
      return json({ users: result.rows.map(authUser), total: count.rows[0].total, aud: "authenticated" });
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !body.password) return json({ message: "Email and password are required." }, 400);
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(String(body.password), 12);
      const appMetadata = body.app_metadata || {};
      const userMetadata = body.user_metadata || {};
      const row = await withDatabase(async (client) => {
        const result = await client.query(`INSERT INTO auth.users
          (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
          VALUES ($1,'authenticated','authenticated',$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,$5::jsonb,$6::jsonb)
          RETURNING id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at,
            confirmed_at, phone, last_sign_in_at, created_at, updated_at, encrypted_password`,
        [id, email, passwordHash, body.email_confirm === true, JSON.stringify(appMetadata), JSON.stringify(userMetadata)]);
        return result.rows[0];
      });
      return json({ user: authUser(row) }, 200);
    }
    return json({ message: "Method not allowed" }, 405);
  } catch (error) { return json({ message: sanitizeError(error) }, hasServiceCapability(request) ? 400 : 401); }
}

async function adminUserHandler(request, id) {
  try {
    await requireService(request);
    if (request.method === "GET") {
      const row = await withDatabase(async (client) => (await client.query(`${userSelect} WHERE id = $1`, [id])).rows[0]);
      return row ? json({ user: authUser(row) }) : json({ message: "User not found" }, 404);
    }
    if (request.method === "DELETE") {
      await withDatabase((client) => client.query("DELETE FROM auth.users WHERE id = $1", [id]));
      return json({ id });
    }
    if (["PUT", "PATCH"].includes(request.method)) {
      const body = await readJson(request);
      const current = await withDatabase(async (client) => (await client.query(`${userSelect} WHERE id = $1`, [id])).rows[0]);
      if (!current) return json({ message: "User not found" }, 404);
      const hash = body.password ? await bcrypt.hash(String(body.password), 12) : current.encrypted_password;
      const updated = await withDatabase(async (client) => {
        const result = await client.query(`UPDATE auth.users SET email = $2, encrypted_password = $3,
          raw_app_meta_data = $4::jsonb, raw_user_meta_data = $5::jsonb, updated_at = now()
          WHERE id = $1 RETURNING id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
          email_confirmed_at, confirmed_at, phone, last_sign_in_at, created_at, updated_at, encrypted_password`,
        [id, String(body.email || current.email).toLowerCase(), hash,
          JSON.stringify(body.app_metadata || current.raw_app_meta_data),
          JSON.stringify(body.user_metadata || current.raw_user_meta_data)]);
        return result.rows[0];
      });
      return json({ user: authUser(updated) });
    }
    return json({ message: "Method not allowed" }, 405);
  } catch (error) { return json({ message: sanitizeError(error) }, hasServiceCapability(request) ? 400 : 401); }
}

async function readJson(request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Request body is too large.");
  return JSON.parse(Buffer.from(bytes).toString("utf8") || "{}");
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function copyHeaders(request, { remote = false } = {}) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("x-desktop-service-key");
  if (remote && connection?.mode === "supabase") {
    if (hasServiceCapability(request)) {
      headers.set("apikey", connection.serviceRoleKey);
      headers.set("authorization", `Bearer ${connection.serviceRoleKey}`);
    } else {
      headers.set("apikey", connection.anonKey);
      if (!headers.get("authorization") || headers.get("authorization") === "Bearer desktop-public-key") {
        headers.set("authorization", `Bearer ${connection.anonKey}`);
      }
    }
  } else if (hasServiceCapability(request)) {
    headers.set("authorization", `Bearer ${backend.serviceJwt}`);
  } else if (!headers.get("authorization") || headers.get("authorization") === "Bearer desktop-public-key") {
    headers.set("authorization", `Bearer ${backend.anonJwt}`);
  }
  return headers;
}

async function proxyToSupabase(request, pathname, url) {
  if (!connection?.supabaseUrl) return json({ message: "Supabase is not configured." }, 503);
  const target = `${connection.supabaseUrl.replace(/\/$/, "")}${pathname}${url.search}`;
  return proxyFetch(request, target, true);
}

async function proxyFetch(request, target, remote = false) {
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
  let response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers: copyHeaders(request, { remote }),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return json({ message: sanitizeError(error, connection?.connectionString) }, 502);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleGatewayRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== currentWindowOrigin()) return json({ message: "Origin not allowed." }, 403);
  if (origin) {
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD",
      "access-control-allow-headers": "apikey, authorization, content-type, x-client-info, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage, prefer, range, accept-profile, content-profile, x-upsert",
      "access-control-expose-headers": "content-range, range, x-total-count",
      vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handleGatewayRoute(request, url);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
  return handleGatewayRoute(request, url);
}

async function handleGatewayRoute(request, url) {
  const { pathname } = url;
  if (pathname === "/desktop/status" && request.method === "GET") return json({ mode: connection?.mode || "local", status: backend.status, message: lastError });
  if (pathname === "/desktop/login" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const username = body.username?.trim().toLowerCase() || "";
      if (!/^[a-z0-9._-]{3,32}$/.test(username) || typeof body.password !== "string") {
        return json({ error: "Tên đăng nhập hoặc mật khẩu chưa chính xác." }, 401);
      }
      const result = connection?.mode === "supabase"
        ? await supabaseDesktopLogin(username, body.password)
        : await requestEngine("admin-login", { ...body, username, jwtSecret: connection.jwtSecret });
      return json(result);
    } catch (error) { return json({ error: sanitizeError(error, connection?.connectionString) }, 401); }
  }
  if (pathname.startsWith("/auth/v1/")) return authHandler(request, pathname, url);
  if (pathname.startsWith("/rest/v1/")) {
    if (connection?.mode === "supabase") return proxyToSupabase(request, pathname, url);
    if (!backend.restUrl) return json({ message: "The database API is not running." }, 503);
    const headers = copyHeaders(request);
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
    const postgrestPath = pathname.slice("/rest/v1".length) || "/";
    let result;
    try {
      result = await fetch(`${backend.restUrl}${postgrestPath}${url.search}`, { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    } catch (error) { return json({ message: sanitizeError(error, connection?.connectionString) }, 502); }
    const responseHeaders = new Headers(result.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers: responseHeaders });
  }
  if (pathname.startsWith("/storage/v1/") && connection?.mode === "supabase") return proxyToSupabase(request, pathname, url);
  return json({ message: "Not found" }, 404);
}

async function supabaseDesktopLogin(username, password) {
  const base = connection.supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: connection.serviceRoleKey,
    authorization: `Bearer ${connection.serviceRoleKey}`,
  };
  const profileUrl = new URL(`${base}/rest/v1/profiles`);
  profileUrl.searchParams.set("select", "id,is_active");
  profileUrl.searchParams.set("username", `eq.${username}`);
  const profileResponse = await fetch(profileUrl, { headers, signal: AbortSignal.timeout(10_000) });
  const profiles = await profileResponse.json().catch(() => []);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profileResponse.ok || !profile?.id || !profile.is_active) {
    throw new Error("Tên đăng nhập hoặc mật khẩu chưa chính xác.");
  }
  const accountResponse = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const accountBody = await accountResponse.json().catch(() => ({}));
  const account = accountBody.user || accountBody;
  if (!accountResponse.ok || !account.email) {
    throw new Error("Tên đăng nhập hoặc mật khẩu chưa chính xác.");
  }
  const sessionResponse = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: connection.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || !session.access_token || !session.refresh_token) {
    throw new Error("Tên đăng nhập hoặc mật khẩu chưa chính xác.");
  }
  return { access_token: session.access_token, refresh_token: session.refresh_token, user_id: profile.id };
}

function startGateway() {
  return new Promise((resolve, reject) => {
    gatewayServer = createHttpServer(async (request, response) => {
      try {
        const origin = `http://${request.headers.host || ""}`;
        if (request.headers.origin && request.headers.origin !== currentWindowOrigin()) {
          response.writeHead(403, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "Origin not allowed." }));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === "string") headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(", "));
        }
        const gatewayRequest = new Request(`${origin}${request.url}`, {
          method: request.method,
          headers,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : await new Promise((resolveBody, rejectBody) => {
            const chunks = [];
            let total = 0;
            request.on("data", (chunk) => { total += chunk.length; if (total > 5 * 1024 * 1024) request.destroy(new Error("Request body is too large.")); else chunks.push(chunk); });
            request.on("end", () => resolveBody(Buffer.concat(chunks)));
            request.on("error", rejectBody);
          }),
        });
        const isDatabaseOperation = /^\/(?:rest\/v1|auth\/v1|storage\/v1|desktop\/login)(?:\/|$)/.test(new URL(gatewayRequest.url).pathname);
        if (isDatabaseOperation && switchingDatabase) {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "The database connection is switching. Retry after the login screen opens." }));
          return;
        }
        if (isDatabaseOperation) activeDatabaseOperations += 1;
        try {
          const result = await handleGatewayRequest(gatewayRequest);
          response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
          if (!result.body) { response.end(); return; }
          const reader = result.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!response.write(Buffer.from(value))) await new Promise((resume) => response.once("drain", resume));
          }
          response.end();
        } finally {
          if (isDatabaseOperation) completeDatabaseOperation();
        }
      } catch (error) {
        if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: sanitizeError(error, connection?.connectionString) }));
      }
    });
    gatewayServer.once("error", reject);
    gatewayServer.listen(gatewayPort, "127.0.0.1", resolve);
  });
}

function runtimeEnv(config) {
  return {
    ...process.env,
    NODE_ENV: "production",
    NODE_OPTIONS: "",
    ERP_DESKTOP_BUILD: "true",
    ERP_DESKTOP_MODE: "gateway",
    ERP_DESKTOP_GATEWAY_URL: gatewayUrl,
    ERP_DESKTOP_SERVICE_KEY: serviceKey,
    ERP_DESKTOP_MIGRATIONS_DIR: getMigrationsPath(),
    ERP_DESKTOP_JWT_SECRET: config.jwtSecret,
    NEXT_PUBLIC_DESKTOP_BUILD: "true",
    NEXT_PUBLIC_SUPABASE_URL: gatewayUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "desktop-public-key",
    PORT: String(appPort),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function waitForAppServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (nextChildExitCode !== null) {
        clearInterval(timer);
        reject(new Error(`The ERP web server stopped during startup (${nextChildExitCode}).`));
        return;
      }
      try {
        const response = await fetch(`${currentWindowOrigin()}/login`, { signal: AbortSignal.timeout(1_500) });
        if (response.status < 500) { clearInterval(timer); resolve(); }
      } catch {
        if (Date.now() - started > 30_000) { clearInterval(timer); reject(new Error("Timed out starting the ERP web server.")); }
      }
    }, 300);
  });
}

function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateState({ status: "development" });
    return Promise.resolve(null);
  }
  if (updateCheckPromise) return updateCheckPromise;
  if (updateDownloadPromise || updateInstallStarted) return Promise.resolve(null);

  updateCheckPromise = autoUpdater.checkForUpdates()
    .catch((error) => {
      sendUpdateState({ status: "error", message: sanitizeError(error) });
      return null;
    })
    .finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

function downloadAvailableUpdate(version) {
  if (updateDownloadPromise || updateInstallStarted) return;
  sendUpdateState({ status: "downloading", percent: 0, availableVersion: version });
  updateDownloadPromise = autoUpdater.downloadUpdate()
    .catch((error) => sendUpdateState({ status: "error", message: sanitizeError(error) }))
    .finally(() => { updateDownloadPromise = null; });
}

function installDownloadedUpdate(version) {
  if (updateInstallStarted) return;
  updateInstallStarted = true;
  sendUpdateState({ status: "installing", availableVersion: version });
  void waitForDatabaseIdle()
    .then(() => autoUpdater.quitAndInstall(true, true))
    .catch((error) => {
      updateInstallStarted = false;
      sendUpdateState({ status: "error", message: sanitizeError(error) });
    });
}

function registerUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => sendUpdateState({ status: "checking" }));
  autoUpdater.on("update-available", (info) => {
    sendUpdateState({ status: "available", availableVersion: info.version });
    downloadAvailableUpdate(info.version);
  });
  autoUpdater.on("update-not-available", (info) => sendUpdateState({ status: "current", availableVersion: info.version }));
  autoUpdater.on("download-progress", (progress) => sendUpdateState({ status: "downloading", percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => installDownloadedUpdate(info.version));
  autoUpdater.on("error", (error) => sendUpdateState({ status: "error", message: sanitizeError(error) }));
  if (app.isPackaged) {
    windowInstance?.on("focus", () => { void checkForUpdates(); });
    void checkForUpdates();
  }
}

function registerIpc() {
  const authorizeFrame = (event) => {
    let senderOrigin = "";
    try {
      senderOrigin = new URL(event.senderFrame?.url || "").origin;
    } catch {
      // Reject malformed or unavailable frame URLs below.
    }
    if (!windowInstance || event.sender !== windowInstance.webContents || senderOrigin !== currentWindowOrigin()) {
      throw new Error("The desktop operation came from an untrusted window.");
    }
  };
  ipcMain.handle("desktop:get-state", (event) => {
    authorizeFrame(event);
    return {
      appVersion: app.getVersion(),
      mode: connection?.mode || "local",
      status: backend.status,
      message: lastError,
      configured: connection?.mode === "local" || Boolean(connection?.connectionString),
      connectionLabel: connection?.mode === "supabase" ? new URL(connection.supabaseUrl).hostname : connection?.mode === "postgres" ? "PostgreSQL" : "Local database",
      update: updateState,
    };
  });
  ipcMain.handle("desktop:test-database", async (event, config) => {
    authorizeFrame(event);
    if (config.mode === "local") return { ok: true, status: "ready", message: "The local database is ready." };
    const candidate = mergeSavedConfig(config);
    validateConfig(candidate);
    return requestEngine("test", { config: { ...candidate, jwtSecret: connection?.jwtSecret || randomBytes(32).toString("base64url") } });
  });
  ipcMain.handle("desktop:save-database", async (event, config, initialize, accessToken, recovery = false) => {
    authorizeFrame(event);
    switchingDatabase = true;
    try {
      await waitForDatabaseIdle();
      await requireDatabaseAdministrator(accessToken, recovery === true);
      const previousConfig = connection;
      const nextConfig = { ...mergeSavedConfig(config), jwtSecret: randomBytes(32).toString("base64url") };
      validateConfig(nextConfig);
      const result = await requestEngine("switch", {
        config: nextConfig,
        initialize: initialize === true,
        setSupabaseAuthProvider: nextConfig.mode === "supabase",
      });
      if (result.status === "ready" && nextConfig.mode !== "supabase" && !result.dbUrl) {
        throw new Error("The database engine did not provide a connection for the selected database.");
      }
      if (result.status === "empty") throw new Error("The database is empty. Confirm Initialize ERP before switching.");
      try {
        await saveConfig(nextConfig);
      } catch (error) {
        try {
          const rollback = await requestEngine("switch", { config: previousConfig, initialize: false });
          backend = {
            mode: previousConfig.mode,
            status: rollback.status || "ready",
            restUrl: rollback.restUrl || null,
            dbUrl: rollback.dbUrl || null,
            anonJwt: rollback.anonJwt || null,
            serviceJwt: rollback.serviceJwt || null,
          };
        } catch (rollbackError) {
          backend.status = "error";
          lastError = `The connection could not be saved, and the previous database could not be restored: ${sanitizeError(rollbackError)}`;
        }
        throw error;
      }
      connection = nextConfig;
      backend = {
        mode: nextConfig.mode,
        status: result.status || "ready",
        restUrl: result.restUrl || null,
        dbUrl: result.dbUrl || null,
        anonJwt: result.anonJwt || null,
        serviceJwt: result.serviceJwt || null,
      };
      lastError = "";
      sendUpdateState({ status: "idle" });
      return { ok: true };
    } finally {
      switchingDatabase = false;
    }
  });
  ipcMain.handle("desktop:check-updates", (event) => { authorizeFrame(event); return checkForUpdates(); });
  ipcMain.handle("desktop:print-page", (event) => {
    authorizeFrame(event);
    return new Promise((resolve) => {
      event.sender.print({ silent: true, printBackground: true }, (success, failureReason) => {
        resolve(success
          ? { ok: true }
          : { ok: false, message: failureReason || "Could not print to the default printer." });
      });
    });
  });
}

function validateConfig(config) {
  if (!config || !["local", "postgres", "supabase"].includes(config.mode)) throw new Error("Choose a valid database type.");
  if (config.mode !== "local" && !/^postgres(?:ql)?:\/\//i.test(String(config.connectionString || ""))) throw new Error("Enter a PostgreSQL connection string starting with postgresql:// or postgres://.");
  if (config.mode === "supabase") {
    let url;
    try { url = new URL(config.supabaseUrl); } catch { throw new Error("Enter the Supabase project URL."); }
    if (!/^https?:$/.test(url.protocol) || !config.anonKey || !config.serviceRoleKey) throw new Error("Enter the Supabase URL, anon key, and service role key.");
  }
}

function mergeSavedConfig(input) {
  const sameMode = connection?.mode === input.mode ? connection : {};
  return {
    ...sameMode,
    ...input,
    connectionString:
      input.connectionString?.trim() || sameMode.connectionString || "",
    supabaseUrl: input.supabaseUrl?.trim() || sameMode.supabaseUrl || "",
    anonKey: input.anonKey?.trim() || sameMode.anonKey || "",
    serviceRoleKey:
      input.serviceRoleKey?.trim() || sameMode.serviceRoleKey || "",
  };
}

async function shutdown() {
  await waitForDatabaseIdle();
  if (gatewayServer) await new Promise((resolve) => gatewayServer.close(resolve));
  if (engineProcess) {
    await requestEngine("shutdown").catch(() => undefined);
    engineProcess.kill();
    engineProcess = null;
  }
  if (nextChild) {
    const child = nextChild;
    nextChild = null;
    if (nextChildExitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        child.once("exit", () => { clearTimeout(timeout); resolve(); });
        child.kill();
      });
    }
  }
}

async function startApp() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("Windows secure storage is unavailable. Desktop credentials cannot be saved safely.");
  connection = await loadConfig();
  if (!connection.jwtSecret) {
    connection.jwtSecret = randomBytes(32).toString("base64url");
    await saveConfig(connection);
  }
  appPort = app.isPackaged ? await findAvailablePort(43130) : 3000;
  startEngine();
  try {
    const result = await requestEngine("switch", { config: connection, initialize: false });
    if (result.status === "ready" && connection.mode !== "supabase" && !result.dbUrl) {
      throw new Error("The database engine did not provide a connection for the selected database.");
    }
    if (result.status === "empty" || result.status === "error") {
      backend.status = result.status;
      lastError = "This database needs ERP setup. Open Database setup from the login screen.";
    }
    if (connection.mode === "local" && result.status === "ready") {
      backend = { ...backend, mode: "local", restUrl: result.restUrl, dbUrl: result.dbUrl, anonJwt: result.anonJwt, serviceJwt: result.serviceJwt, status: "ready" };
    } else if (connection.mode === "postgres" && result.status === "ready") {
      backend = { ...backend, mode: "postgres", restUrl: result.restUrl, dbUrl: result.dbUrl, anonJwt: result.anonJwt, serviceJwt: result.serviceJwt, status: "ready" };
    } else if (connection.mode === "supabase" && result.status === "ready") {
      backend = { ...backend, mode: "supabase", restUrl: null, dbUrl: null, status: "ready" };
    }
  } catch (error) {
    backend = { mode: connection.mode, restUrl: null, dbUrl: null, anonJwt: null, serviceJwt: null, status: "error" };
    lastError = sanitizeError(error, connection.connectionString);
  }
  await startGateway();
  if (app.isPackaged) {
    const serverPath = path.join(process.resourcesPath, "app", "server.js");
    nextChildExitCode = null;
    nextChild = fork(serverPath, [], {
      execPath: process.execPath,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
      cwd: path.dirname(serverPath),
      env: { ...runtimeEnv(connection), ELECTRON_RUN_AS_NODE: "1" },
    });
    nextChild.on("exit", (code) => { nextChildExitCode = code ?? 0; });
    await waitForAppServer();
  }
}

function createWindow() {
  windowInstance = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f5f7fa",
    webPreferences: {
      preload: path.join(root, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      webSecurity: true,
    },
  });
  windowInstance.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowInstance.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(currentWindowOrigin())) event.preventDefault();
  });
  const suffix = process.argv.includes("--desktop-switched") ? "/login" : "/";
  void windowInstance.loadURL(`${currentWindowOrigin()}${suffix}`);
  windowInstance.on("closed", () => { windowInstance = null; });
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void shutdown().finally(() => app.quit());
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.whenReady().then(async () => {
    try {
      registerIpc();
      await startApp();
      createWindow();
      registerUpdater();
    } catch (error) {
      lastError = sanitizeError(error, connection?.connectionString);
      await dialog.showMessageBox({ type: "error", title: "ERP", message: "The desktop app could not start.", detail: lastError });
      quitting = true;
      await shutdown();
      app.quit();
    }
  });
}
