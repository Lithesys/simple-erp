import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

const { Client } = pg;
const engineDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = process.env.ERP_DESKTOP_MIGRATIONS_DIR;
const postgrestExecutable = process.env.ERP_DESKTOP_POSTGREST;
const databaseDirectory = process.env.ERP_DESKTOP_DATA_DIR;
const parentPort = process.parentPort;

let pgLite;
let pgSocket;
let postgrest;
let current = { mode: "local", restUrl: null, anonJwt: null, serviceJwt: null, dbUrl: null };
let remoteConnectionString = null;
const pending = new Map();

function send(type, payload = {}) {
  const message = { type, ...payload };
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
}

function waitForPort(host, port, child) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (child?.exitCode !== null && child?.exitCode !== undefined) {
        clearInterval(timer);
        reject(new Error("The database API service stopped during startup."));
        return;
      }
      const socket = createConnection({ host, port });
      socket.once("error", () => {
        if (Date.now() - startedAt > 15_000) {
          clearInterval(timer);
          reject(new Error("Timed out starting the database API service."));
        }
      });
      socket.once("connect", () => {
        socket.destroy();
        clearInterval(timer);
        resolve();
      });
    }, 100);
  });
}

async function choosePort(startAt) {
  const errors = new Map();
  for (let port = startAt; port < startAt + 100; port += 1) {
    try {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => server.close(resolve));
      });
      return port;
    } catch (error) {
      const detail = `${error?.code || ""} ${error?.message || String(error)}`.trim();
      errors.set(detail, (errors.get(detail) || 0) + 1);
      // Try the next loopback port; the API server only accepts local requests.
    }
  }
  const details = [...errors].map(([message, count]) => `${message} × ${count}`).join("; ");
  throw new Error(`Could not find an available local database port (${details || "no port was available"}).`);
}

function roleSql(name, options = "") {
  return `DO $role$ BEGIN CREATE ROLE ${name} ${options}; EXCEPTION WHEN duplicate_object THEN NULL; END $role$;`;
}

async function bootstrapCompatibility(client, { local = false, supabase = false } = {}) {
  await client.query("CREATE SCHEMA IF NOT EXISTS auth");
  await client.query("CREATE SCHEMA IF NOT EXISTS private");
  await client.query("CREATE SCHEMA IF NOT EXISTS extensions");
  if (!supabase) {
    await client.query(roleSql("anon", "NOLOGIN"));
    await client.query(roleSql("authenticated", "NOLOGIN"));
    await client.query(roleSql("service_role", "NOLOGIN BYPASSRLS"));
  }
  if (local) {
    await client.query(roleSql("authenticator", "LOGIN NOINHERIT PASSWORD 'desktop-local'"));
    await client.query("GRANT anon, authenticated, service_role TO authenticator");
  }
  if (!supabase) await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      instance_id uuid,
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      aud varchar(255),
      role varchar(255),
      email varchar(255) UNIQUE,
      encrypted_password varchar(255),
      email_confirmed_at timestamptz,
      invited_at timestamptz,
      confirmation_token varchar(255),
      confirmation_sent_at timestamptz,
      recovery_token varchar(255),
      recovery_sent_at timestamptz,
      email_change_token_new varchar(255),
      email_change varchar(255),
      email_change_sent_at timestamptz,
      last_sign_in_at timestamptz,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_super_admin boolean,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      phone text UNIQUE,
      phone_confirmed_at timestamptz,
      phone_change text DEFAULT '',
      phone_change_token varchar(255) DEFAULT '',
      phone_change_sent_at timestamptz,
      confirmed_at timestamptz GENERATED ALWAYS AS (least(email_confirmed_at, phone_confirmed_at)) STORED,
      email_change_token_current varchar(255) DEFAULT '',
      email_change_confirm_status smallint DEFAULT 0,
      banned_until timestamptz,
      reauthentication_token varchar(255) DEFAULT '',
      reauthentication_sent_at timestamptz,
      is_sso_user boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      is_anonymous boolean NOT NULL DEFAULT false
    )
  `);
  if (!supabase) await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid $$
  `);
  if (!supabase) await client.query(`
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(
      current_setting('request.jwt.claim.role', true),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ) $$
  `);
  if (!supabase) await client.query(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$
  `);
}

async function setAuthProvider(client, provider) {
  await client.query("CREATE SCHEMA IF NOT EXISTS private");
  await client.query(`
    CREATE TABLE IF NOT EXISTS private.desktop_runtime (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      auth_provider text NOT NULL
    )
  `);
  await client.query(
    `INSERT INTO private.desktop_runtime(singleton, auth_provider) VALUES(true, $1)
     ON CONFLICT(singleton) DO UPDATE SET auth_provider = EXCLUDED.auth_provider`,
    [provider],
  );
}

async function chooseMigrationsDirectory() {
  if (migrationsDirectory) return migrationsDirectory;
  const packaged = path.join(path.dirname(engineDirectory), "migrations");
  try {
    await stat(packaged);
    return packaged;
  } catch {
    return path.resolve(engineDirectory, "..", "supabase", "migrations");
  }
}

async function migrationFiles() {
  const directory = await chooseMigrationsDirectory();
  return (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

function migrationSlug(name) {
  return name.replace(/^\d+_/, "").replace(/\.sql$/, "");
}

async function readSupabaseMigrationHistory(client) {
  try {
    const history = await client.query(
      "SELECT to_regclass('supabase_migrations.schema_migrations') AS relation",
    );
    if (!history.rows[0]?.relation) return null;
    try {
      const { rows } = await client.query(
        "SELECT version::text AS version, name FROM supabase_migrations.schema_migrations",
      );
      return {
        versions: new Set(rows.map((row) => String(row.version))),
        names: new Set(rows.map((row) => String(row.name || "")).filter(Boolean)),
      };
    } catch {
      const { rows } = await client.query(
        "SELECT version::text AS version FROM supabase_migrations.schema_migrations",
      );
      return { versions: new Set(rows.map((row) => String(row.version))), names: new Set() };
    }
  } catch {
    return null;
  }
}

async function migrationStatus(client) {
  const files = await migrationFiles();
  const supabaseHistory = await readSupabaseMigrationHistory(client);
  const isAppliedInSupabase = (name) => supabaseHistory && (
    supabaseHistory.versions.has(name.split("_")[0]) || supabaseHistory.names.has(migrationSlug(name))
  );
  const history = await client.query(
    "SELECT to_regclass('private.desktop_schema_migrations') AS relation",
  );
  if (history.rows[0]?.relation) {
    const { rows } = await client.query(
      "SELECT name FROM private.desktop_schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.name));
    const appliedSlugs = new Set([...applied].map(migrationSlug));
    return {
      migrations: files.filter((name) => !applied.has(name)
        && !appliedSlugs.has(migrationSlug(name))
        && !isAppliedInSupabase(name)),
      source: "desktop",
    };
  }
  if (supabaseHistory) {
    return {
      migrations: files.filter((name) => !isAppliedInSupabase(name)),
      source: "supabase",
    };
  }
  return { migrations: [], source: "untracked" };
}

async function runMigrations(client, onProgress = () => {}) {
  const directory = await chooseMigrationsDirectory();
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  await client.query("CREATE SCHEMA IF NOT EXISTS private");
  await client.query(`
    CREATE TABLE IF NOT EXISTS private.desktop_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows: appliedRows } = await client.query(
    "SELECT name FROM private.desktop_schema_migrations",
  );
  const applied = new Set(appliedRows.map((row) => row.name));
  const appliedSlugs = new Set([...applied].map(migrationSlug));
  const supabaseHistory = await readSupabaseMigrationHistory(client);
  for (const name of files) {
    const slug = migrationSlug(name);
    const appliedInSupabase = supabaseHistory && (
      supabaseHistory.versions.has(name.split("_")[0]) || supabaseHistory.names.has(slug)
    );
    if (!appliedInSupabase && !applied.has(name) && !appliedSlugs.has(slug)) continue;
    if (applied.has(name)) continue;
    await client.query(
      "INSERT INTO private.desktop_schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING",
      [name],
    );
    applied.add(name);
    appliedSlugs.add(slug);
  }
  const embedded = typeof client.exec === "function";
  for (let index = 0; index < files.length; index += 1) {
    const name = files[index];
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(directory, name), "utf8");
    onProgress({ applied: index, total: files.length, name });
    try {
      if (embedded) {
        await client.exec("BEGIN");
        await client.exec(sql);
        await client.query(
          "INSERT INTO private.desktop_schema_migrations(name) VALUES($1)",
          [name],
        );
        await client.exec("COMMIT");
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO private.desktop_schema_migrations(name) VALUES($1)",
          [name],
        );
        await client.query("COMMIT");
      }
    } catch (error) {
      if (embedded) await client.exec("ROLLBACK").catch(() => undefined);
      else await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Migration ${name} failed: ${error.message}`);
    }
  }
  await client.query(`
    CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE v_role uuid;
    BEGIN
      IF new.raw_app_meta_data ->> 'erp_managed' IS DISTINCT FROM 'true' THEN RETURN new; END IF;
      SELECT id INTO v_role FROM public.roles WHERE name = 'Nhân viên' LIMIT 1;
      INSERT INTO public.profiles(id, username, display_name, role_id)
      VALUES (
        new.id,
        'user_' || replace(substr(new.id::text, 1, 13), '-', ''),
        coalesce(new.raw_user_meta_data ->> 'display_name', ''),
        v_role
      ) ON CONFLICT (id) DO NOTHING;
      RETURN new;
    END $$
  `);
  await client.query("GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role");
  await client.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role");
  await client.query("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role");
  await client.query("GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role");
  await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role");
  await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role");
  await client.query(`DO $grant$ BEGIN
    EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
  END $grant$`);
}

async function ensureProfile(client, userId, username, displayName, { admin = false } = {}) {
  const { rows: roles } = await client.query(
    "SELECT id FROM public.roles WHERE name = $1 LIMIT 1",
    [admin ? "Admin" : "Nhân viên"],
  );
  const role = roles[0];
  if (!role) throw new Error("The ERP Admin role was not created by the migrations.");
  await client.query(
    `INSERT INTO public.profiles(id, username, display_name, role_id, is_active)
     VALUES($1, $2, $3, $4, true)
     ON CONFLICT(id) DO UPDATE SET username = EXCLUDED.username,
       display_name = EXCLUDED.display_name, role_id = EXCLUDED.role_id,
       is_active = true`,
    [userId, username, displayName, role.id],
  );
}

async function insertDesktopUser(client, { username, password, admin = false }) {
  const userId = randomUUID();
  const email = `${username}@desktop.local`;
  const passwordHash = await bcrypt.hash(password, 12);
  const userMetadata = { display_name: admin ? "Quản trị viên" : username };
  const appMetadata = { erp_managed: "true", provider: "email", providers: ["email"] };
  await client.query(
    `INSERT INTO auth.users
      (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     VALUES ($1, 'authenticated', 'authenticated', $2, $3, now(), $4::jsonb, $5::jsonb)`,
    [userId, email, passwordHash, JSON.stringify(appMetadata), JSON.stringify(userMetadata)],
  );
  await ensureProfile(client, userId, username, userMetadata.display_name, { admin });
  return { id: userId, email, encrypted_password: passwordHash, raw_app_meta_data: appMetadata, raw_user_meta_data: userMetadata };
}

async function bootstrapAdmin(client) {
  const { rows } = await client.query("SELECT id FROM auth.users WHERE email = $1", ["admin@desktop.local"]);
  if (rows.length) return;
  const user = await insertDesktopUser(client, { username: "admin", password: "admin", admin: true });
  await client.query("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1", [user.id]);
}

async function bootstrapSupabaseAdmin(client, config) {
  const response = await fetch(
    `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "admin@desktop.local",
        password: "admin",
        email_confirm: true,
        user_metadata: { display_name: "Quản trị viên" },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Supabase could not create the initial administrator (${response.status}): ${result.msg || result.message || result.error_description || "Check the service role key and Auth settings."}`,
    );
  }
  const user = result.user || result;
  if (!user.id) throw new Error("Supabase Auth did not return the administrator ID.");
  await ensureProfile(client, user.id, "admin", "Quản trị viên", { admin: true });
}

async function nextPort(first) {
  return choosePort(first);
}

async function startPostgrest({ connectionString, jwtSecret, preparedStatements = true, poolSize = 5 }) {
  if (!postgrestExecutable) throw new Error("PostgREST is missing from this installation.");
  const port = await nextPort(43140);
  const args = [];
  const child = spawn(postgrestExecutable, args, {
    env: {
      ...process.env,
      PGRST_DB_URI: connectionString,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_EXTRA_SEARCH_PATH: "extensions",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_DB_PREPARED_STATEMENTS: String(preparedStatements),
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(port),
      PGRST_LOG_LEVEL: "error",
      PGRST_DB_POOL: String(poolSize),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLogs = "";
  child.stdout?.on("data", (chunk) => { childLogs = `${childLogs}${chunk.toString()}`.slice(-2_000); });
  child.stderr?.on("data", (chunk) => { childLogs = `${childLogs}${chunk.toString()}`.slice(-2_000); });
  try {
    await waitForPort("127.0.0.1", port, child);
  } catch (error) {
    await stopProcess(child);
    throw new Error(`${error.message}${childLogs ? ` ${childLogs.trim()}` : ""}`);
  }
  return { process: child, url: `http://127.0.0.1:${port}` };
}

async function createTokens(jwtSecret, userId, email, role = "authenticated") {
  const key = new TextEncoder().encode(jwtSecret);
  const exp = "365d";
  const access = await new SignJWT({ role, aud: role, email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
  const refresh = await new SignJWT({ purpose: "refresh" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setAudience("desktop-refresh")
    .setExpirationTime(exp)
    .sign(key);
  return { access, refresh };
}

async function issueServiceTokens(jwtSecret) {
  const key = new TextEncoder().encode(jwtSecret);
  const createRoleToken = (role) => new SignJWT({ role, aud: role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(key);
  const [anonJwt, serviceJwt] = await Promise.all([
    createRoleToken("anon"),
    createRoleToken("service_role"),
  ]);
  return { anonJwt, serviceJwt };
}

async function startLocalBackend(config) {
  const jwtSecret = config.jwtSecret;
  const database = await PGlite.create({
    dataDir: databaseDirectory,
    extensions: { pgcrypto, unaccent },
  });
  let socketServer;
  let postgrestProcess;
  try {
    const { rows } = await database.query(`SELECT
      to_regclass('public.roles') AS roles,
      to_regclass('public.profiles') AS profiles,
      to_regclass('auth.users') AS auth_users,
      to_regclass('private.desktop_schema_migrations') AS migration_history,
      to_regclass('private.desktop_runtime') AS runtime_marker,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS table_count`);
    const state = rows[0];
    const isEmpty = !state.roles && !state.profiles && !state.auth_users &&
      !state.migration_history && !state.runtime_marker && Number(state.table_count) === 0;
    if (isEmpty) {
      await database.exec("CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS private; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS unaccent;");
      await bootstrapCompatibility(database, { local: true });
      await runMigrations(database, (progress) => send("migration-progress", progress));
      await bootstrapAdmin(database);
      await setAuthProvider(database, "desktop");
    } else {
      if (!state.roles || !state.profiles) {
        throw new Error("The local database contains unrelated tables or an incomplete ERP schema. Use the database recovery screen.");
      }
      if (!state.migration_history || !state.runtime_marker) {
        throw new Error("The local ERP database has no complete migration history. Use the database recovery screen.");
      }
      const runtime = await database.query("SELECT auth_provider FROM private.desktop_runtime WHERE singleton = true");
      if (runtime.rows[0]?.auth_provider !== "desktop") {
        throw new Error("The local ERP database setup is incomplete or does not belong to this desktop engine. Use the database recovery screen.");
      }
      const pending = await migrationStatus(database);
      if (pending.migrations.length) {
        const backupDirectory = path.join(path.dirname(databaseDirectory), "database-backups");
        await mkdir(backupDirectory, { recursive: true });
        const backupName = `before-migration-${new Date().toISOString().replaceAll(":", "-")}.tar.gz`;
        const backup = await database.dumpDataDir("gzip");
        await writeFile(path.join(backupDirectory, backupName), Buffer.from(await backup.arrayBuffer()));
      }
      await runMigrations(database, (progress) => send("migration-progress", progress));
    }
    const pgPort = await nextPort(43150);
    // Keep spare sockets for engine-side auth/session work alongside PostgREST's pool.
    socketServer = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: pgPort, maxConnections: 16 });
    await socketServer.start();
    const postgrestResult = await startPostgrest({
      connectionString: `postgres://authenticator:desktop-local@127.0.0.1:${pgPort}/postgres?sslmode=disable`,
      jwtSecret,
      preparedStatements: false,
      poolSize: 1,
    });
    postgrestProcess = postgrestResult.process;
    const tokens = await issueServiceTokens(jwtSecret);
    return { database, socketServer, postgrest: postgrestProcess, pgPort, restUrl: postgrestResult.url, ...tokens };
  } catch (error) {
    if (postgrestProcess) await stopProcess(postgrestProcess);
    if (socketServer) await socketServer.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
    throw error;
  }
}

async function schemaStatus(client) {
  const { rows } = await client.query(`
    SELECT to_regclass('public.roles') AS roles,
      to_regclass('public.profiles') AS profiles,
      to_regprocedure('public.current_user_access()') AS access_rpc,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS table_count,
      to_regclass('private.desktop_schema_migrations') AS desktop_migrations,
      to_regclass('private.desktop_runtime') AS desktop_runtime,
      to_regclass('auth.users') AS auth_users
  `);
  const state = rows[0];
  if (state.roles && state.profiles && state.access_rpc) {
    const provider = state.desktop_runtime
      ? await client.query("SELECT auth_provider FROM private.desktop_runtime WHERE singleton = true")
      : { rows: [] };
    return {
      status: "ready",
      authProvider: provider.rows[0]?.auth_provider || null,
      desktopManaged: Boolean(state.desktop_migrations),
    };
  }
  if (Number(state.table_count) === 0) {
    if (!state.auth_users) return { status: "empty", hasAuthUsers: false };
    const users = await client.query("SELECT count(*)::int AS count FROM auth.users");
    return { status: "empty", hasAuthUsers: Number(users.rows[0].count) > 0 };
  }
  return { status: "incompatible", hasAuthUsers: Boolean(state.auth_users) };
}

async function prepareRemote(config, { initialize = false, setSupabaseAuthProvider = false } = {}) {
  const client = new Client({ connectionString: config.connectionString, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    await client.query("SELECT 1");
    const state = await schemaStatus(client);
    if (state.status === "incompatible") {
      throw new Error("This PostgreSQL database contains other tables or an incomplete ERP schema. Choose an empty database or the matching Supabase project.");
    }
    if (state.status === "empty") {
      if (config.mode === "postgres" && state.hasAuthUsers) {
        throw new Error("This database already has Supabase Auth. Choose Supabase mode to preserve its existing accounts.");
      }
      if (config.mode === "supabase" && state.hasAuthUsers) {
        throw new Error("This Supabase project already has Auth users but no ERP schema. Initialization is blocked so existing identities are not changed.");
      }
      if (!initialize) return { client, state: "empty", needsInitialization: true };
      await bootstrapCompatibility(client, { supabase: config.mode === "supabase" });
      await runMigrations(client, (progress) => send("migration-progress", progress));
      if (config.mode === "supabase") {
        await bootstrapSupabaseAdmin(client, config);
        await setAuthProvider(client, "supabase");
      } else {
        await bootstrapAdmin(client);
        await setAuthProvider(client, "desktop");
      }
      return { client, state: "ready", initialized: true };
    }
    if (config.mode === "postgres" && (!state.desktopManaged || state.authProvider !== "desktop")) {
      throw new Error("This ERP database uses Supabase Auth. Choose Supabase mode with its project URL and API keys to keep existing accounts.");
    }
    if (config.mode === "supabase" && state.authProvider === "desktop") {
      throw new Error("This ERP database is configured for standalone desktop authentication. Select PostgreSQL mode to keep its existing accounts.");
    }
    const needsSupabaseAuthMarker = config.mode === "supabase" && state.authProvider !== "supabase";
    if (state.desktopManaged && !state.authProvider && config.mode !== "supabase") {
      throw new Error("The ERP schema has migration records but its desktop database marker is missing. Use the database recovery screen or restore a database backup.");
    }
    const migrations = await migrationStatus(client);
    if (!state.desktopManaged && migrations.source !== "supabase") {
      migrations.migrations = [];
      migrations.source = "untracked";
    }
    if (initialize && migrations.migrations.length) {
      await runMigrations(client, (progress) => send("migration-progress", progress));
      if (config.mode === "supabase" && (migrations.source === "supabase" || setSupabaseAuthProvider)) {
        await setAuthProvider(client, "supabase");
      }
      return {
        client,
        state: state.status,
        pendingMigrations: [],
        migrationSource: migrations.source,
        needsSupabaseAuthMarker,
      };
    }
    if (config.mode === "supabase" && setSupabaseAuthProvider && state.authProvider !== "supabase") {
      await setAuthProvider(client, "supabase");
    }
    return {
      client,
      state: state.status,
      pendingMigrations: migrations.migrations,
      migrationSource: migrations.source,
      needsSupabaseAuthMarker,
    };
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

async function stopCurrent() {
  if (postgrest) {
    const child = postgrest;
    postgrest = null;
    await stopProcess(child);
  }
  if (pgSocket) {
    await pgSocket.stop().catch(() => undefined);
    pgSocket = null;
  }
  if (pgLite) {
    await pgLite.close().catch(() => undefined);
    pgLite = null;
  }
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

async function switchBackend(config, { initialize = false, setSupabaseAuthProvider = false } = {}) {
  if (config.mode === "supabase") {
    await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: config.anonKey },
      signal: AbortSignal.timeout(8_000),
    }).then((response) => {
      if (!response.ok) throw new Error(`Supabase Auth returned ${response.status}.`);
    });
    if (config.connectionString) {
      const remote = await prepareRemote(config, { initialize, setSupabaseAuthProvider });
      if (remote.state === "empty" && remote.needsInitialization) {
        await remote.client.end();
        return { mode: "supabase", status: "empty", needsInitialization: true };
      }
      await remote.client.end();
    }
    await stopCurrent();
    current = { mode: "supabase", restUrl: null, anonJwt: null, serviceJwt: null, dbUrl: null };
    return { mode: current.mode, status: "ready" };
  }
  if (config.mode === "postgres") {
    const remote = await prepareRemote(config, { initialize });
    const status = remote.state;
    await remote.client.end();
    if (status === "empty") return { mode: "postgres", status, needsInitialization: true };
    const started = await startPostgrest({ connectionString: config.connectionString, jwtSecret: config.jwtSecret });
    const tokens = await issueServiceTokens(config.jwtSecret);
    const previousProcess = postgrest;
    postgrest = started.process;
    if (previousProcess) await stopProcess(previousProcess);
    if (pgSocket) {
      await pgSocket.stop().catch(() => undefined);
      pgSocket = null;
    }
    if (pgLite) {
      await pgLite.close().catch(() => undefined);
      pgLite = null;
    }
    remoteConnectionString = config.connectionString;
    current = { mode: "postgres", restUrl: started.url, dbUrl: config.connectionString, ...tokens };
    return { mode: current.mode, status: "ready" };
  }
  await stopCurrent();
  const started = await startLocalBackend(config);
  pgLite = started.database;
  pgSocket = started.socketServer;
  postgrest = started.postgrest;
  remoteConnectionString = null;
  current = { mode: "local", restUrl: started.restUrl, dbUrl: `postgres://postgres:postgres@127.0.0.1:${started.pgPort}/postgres?sslmode=disable`, anonJwt: started.anonJwt, serviceJwt: started.serviceJwt };
  return { mode: current.mode, status: "ready" };
}

function verifyConnectionString(value) {
  if (typeof value !== "string" || !/^postgres(?:ql)?:\/\//i.test(value.trim())) {
    throw new Error("Enter a PostgreSQL connection string starting with postgresql:// or postgres://.");
  }
}

const handleParentMessage = async (data) => {
  if (data.type === "reply") {
    const response = pending.get(data.requestId);
    if (!response) return;
    clearTimeout(response.timer);
    pending.delete(data.requestId);
    if (data.error) response.reject(new Error(data.error));
    else response.resolve(data.result);
    return;
  }
  try {
    if (data.type === "start") {
      const result = await switchBackend(data.config);
      send("backend-ready", { result, restUrl: current.restUrl, dbUrl: current.dbUrl, anonJwt: current.anonJwt, serviceJwt: current.serviceJwt });
    } else if (data.type === "test") {
      if (data.config.mode === "local") {
        send("reply", { requestId: data.requestId, result: { ok: true, status: "ready", message: "Local database is available." } });
      } else if (data.config.mode === "supabase") {
        const health = await fetch(`${data.config.supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
          headers: { apikey: data.config.anonKey },
          signal: AbortSignal.timeout(8_000),
        });
        if (!health.ok) throw new Error(`Supabase Auth returned ${health.status}.`);
        const adminHealth = await fetch(`${data.config.supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=1`, {
          headers: {
            apikey: data.config.serviceRoleKey,
            authorization: `Bearer ${data.config.serviceRoleKey}`,
          },
          signal: AbortSignal.timeout(8_000),
        });
        if (!adminHealth.ok) throw new Error("Supabase service role key was rejected.");
        const remote = await prepareRemote(data.config);
        await remote.client.end();
        send("reply", { requestId: data.requestId, result: {
          ok: true,
          status: remote.state,
          migrations: remote.pendingMigrations || [],
          migrationNote: remote.migrationSource === "untracked" && remote.state === "ready"
            ? "This ERP schema has no desktop or Supabase migration history. Automatic upgrades are disabled until its schema history is available."
            : undefined,
          message: remote.state === "empty"
            ? "Supabase and PostgreSQL are reachable. The project is empty and can be initialized."
            : remote.needsSupabaseAuthMarker
              ? "Supabase and PostgreSQL are reachable. Saving will restore the Supabase Auth marker without changing ERP accounts or records."
              : "Supabase and PostgreSQL are reachable.",
        } });
      } else {
        const remote = await prepareRemote(data.config);
        await remote.client.end();
        send("reply", { requestId: data.requestId, result: {
          ok: true,
          status: remote.state,
          migrations: remote.pendingMigrations || [],
          migrationNote: remote.migrationSource === "untracked" && remote.state === "ready"
            ? "This ERP schema has no desktop migration history. Automatic upgrades are disabled until its schema history is available."
            : undefined,
          message: remote.state === "empty" ? "An empty database is ready for the ERP schema." : "ERP schema is ready.",
        } });
      }
    } else if (data.type === "switch") {
      if (data.config.mode !== "local") verifyConnectionString(data.config.connectionString);
      const result = await switchBackend(data.config, {
        initialize: data.initialize === true,
        setSupabaseAuthProvider: data.setSupabaseAuthProvider === true,
      });
      send("reply", { requestId: data.requestId, result: { ...result, restUrl: current.restUrl, dbUrl: current.dbUrl, anonJwt: current.anonJwt, serviceJwt: current.serviceJwt } });
    } else if (data.type === "shutdown") {
      await stopCurrent();
      send("reply", { requestId: data.requestId, result: true });
    } else if (data.type === "admin-login") {
      const username = data.username?.trim().toLowerCase() || "";
      if (!/^[a-z0-9._-]{3,32}$/.test(username) || typeof data.password !== "string") {
        throw new Error("Tên đăng nhập hoặc mật khẩu chưa chính xác.");
      }
      const client = await openCurrentClient();
      try {
        const { rows } = await client.query(`
          SELECT u.id, u.email, u.encrypted_password, u.raw_app_meta_data,
            u.raw_user_meta_data, p.is_active
          FROM public.profiles p JOIN auth.users u ON u.id = p.id
          WHERE lower(p.username) = lower($1) LIMIT 1
        `, [username]);
        const user = rows[0];
        if (!user || !user.is_active || !(await bcrypt.compare(data.password, user.encrypted_password || ""))) {
          throw new Error("Tên đăng nhập hoặc mật khẩu chưa chính xác.");
        }
        await client.query("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1", [user.id]);
        const tokens = await createTokens(data.jwtSecret, user.id, user.email);
        send("reply", { requestId: data.requestId, result: { access_token: tokens.access, refresh_token: tokens.refresh, user_id: user.id } });
      } finally { await client.end().catch(() => undefined); }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database operation failed.";
    if (data.requestId) send("reply", { requestId: data.requestId, error: message });
    else send("backend-error", { error: message });
  }
};

if (parentPort) parentPort.on("message", ({ data }) => void handleParentMessage(data));
else process.on("message", (data) => void handleParentMessage(data));

async function openCurrentClient() {
  if (current.mode === "local") {
    const client = new Client({ connectionString: current.dbUrl });
    await client.connect();
    return client;
  }
  if (current.mode === "postgres") {
    const client = new Client({ connectionString: remoteConnectionString, connectionTimeoutMillis: 8_000 });
    await client.connect();
    return client;
  }
  throw new Error("Supabase authentication is handled by the hosted Auth service.");
}
