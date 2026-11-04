import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, copyFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build");
const runtimeDirectory = path.join(buildDirectory, "postgrest-runtime");
const postgrestArchive = path.join(buildDirectory, "postgrest-v14.18-windows-x86-64.zip");
const postgrestExtracted = path.join(buildDirectory, "postgrest-v14.18");
const postgresArchive = path.join(buildDirectory, "postgresql-17.11-1-windows-x64-binaries.zip");
const postgresExtracted = path.join(buildDirectory, "postgresql-runtime");
const postgrestSha256 = "f24ca175b34d1ec0f3fc6d4c778f279f70577f6b3784b19aaa321e22bc3959b9";
const postgresSha256 = "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3";
const downloads = [
  {
    url: "https://github.com/PostgREST/postgrest/releases/download/v14.18/postgrest-v14.18-windows-x86-64.zip",
    output: postgrestArchive,
    sha256: postgrestSha256,
    label: "PostgREST v14.18",
  },
  {
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip",
    output: postgresArchive,
    sha256: postgresSha256,
    label: "PostgreSQL 17.11 Windows client libraries",
  },
];

await mkdir(buildDirectory, { recursive: true });
await mkdir(runtimeDirectory, { recursive: true });

async function downloadVerified({ url, output, sha256, label }) {
  try {
    await stat(output);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(output)) hash.update(chunk);
    if (hash.digest("hex") === sha256) return;
    await rm(output, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`Could not download ${label} (${response.status}).`);
  const hash = createHash("sha256");
  const checksumStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), checksumStream, createWriteStream(output));
  if (hash.digest("hex") !== sha256) {
    await rm(output, { force: true });
    throw new Error(`${label} failed its SHA-256 check.`);
  }
}

function extract(archive, directory, members = []) {
  const args = ["-xf", archive, "-C", directory, ...members];
  const result = spawnSync("tar.exe", args, { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not extract ${path.basename(archive)}.`);
}

await downloadVerified(downloads[0]);
await mkdir(postgrestExtracted, { recursive: true });
extract(postgrestArchive, postgrestExtracted);
const postgrestCandidates = [
  path.join(postgrestExtracted, "postgrest.exe"),
  path.join(postgrestExtracted, "postgrest", "postgrest.exe"),
];
let postgrestExecutable;
for (const candidate of postgrestCandidates) {
  try {
    await readFile(candidate);
    postgrestExecutable = candidate;
    break;
  } catch {
    // Check the other archive layout.
  }
}
if (!postgrestExecutable) throw new Error("The PostgREST archive did not contain postgrest.exe.");
await copyFile(postgrestExecutable, path.join(runtimeDirectory, "postgrest.exe"));
await rm(postgrestExtracted, { recursive: true, force: true });

await downloadVerified(downloads[1]);
const postgresClientFiles = [
  ["pgsql/bin/libpq.dll", "libpq.dll"],
  ["pgsql/bin/libcrypto-3-x64.dll", "libcrypto-3-x64.dll"],
  ["pgsql/bin/libssl-3-x64.dll", "libssl-3-x64.dll"],
  ["pgsql/bin/libintl-9.dll", "libintl-9.dll"],
  ["pgsql/bin/libiconv-2.dll", "libiconv-2.dll"],
  ["pgsql/bin/libwinpthread-1.dll", "libwinpthread-1.dll"],
  ["pgsql/bin/zlib1.dll", "zlib1.dll"],
  ["pgsql/pgAdmin 4/python/vcruntime140.dll", "vcruntime140.dll"],
  ["pgsql/pgAdmin 4/python/vcruntime140_1.dll", "vcruntime140_1.dll"],
];
await mkdir(postgresExtracted, { recursive: true });
extract(
  postgresArchive,
  postgresExtracted,
  postgresClientFiles.map(([member]) => member),
);
for (const [member, name] of postgresClientFiles) {
  const source = path.join(postgresExtracted, ...member.split("/"));
  await readFile(source);
  await copyFile(source, path.join(runtimeDirectory, name));
}
await rm(postgresExtracted, { recursive: true, force: true });
