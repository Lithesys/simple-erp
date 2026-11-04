import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const [input, mode] = process.argv.slice(2);
assert(
  input && (!mode || ["--execute", "--verify"].includes(mode)),
  "Usage: node --env-file=.env.local scripts/seed-customers.mjs seed.json [--execute|--verify]",
);
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
assert(expectedProjectRef, "Set EXPECTED_SUPABASE_PROJECT_REF to the intended Supabase project before running this script.");
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  `${expectedProjectRef}.supabase.co`,
  "Unexpected target",
);
const seed = JSON.parse(await readFile(input, "utf8"));
assert(/^[a-f0-9]{64}$/.test(seed.sha256) && seed.customers.length > 0);
const expected = seed.customers.map((c) => {
  assert(Number.isInteger(c.row) && c.row >= 2);
  assert(typeof c.name === "string" && c.name.trim() && c.name.length <= 300);
  assert(
    typeof c.phone === "string" &&
      c.phone.length <= 100 &&
      typeof c.address === "string" &&
      c.address.length <= 1000,
  );
  const h = createHash("sha256")
    .update(`customers:${seed.sha256}:${c.row}`)
    .digest("hex");
  return {
    id: `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`,
    name: c.name,
    phone: c.phone,
    address: c.address,
  };
});
assert.equal(new Set(expected.map((c) => c.id)).size, expected.length);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
async function readAll() {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("customers")
      .select("id,name,phone,address")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
const before = await readAll();
const existing = new Map(before.map((c) => [c.id, c]));
const ids = new Set(expected.map((c) => c.id));
const key = (c) => JSON.stringify([c.name, c.phone, c.address]);
const sourceKeys = new Set(expected.map(key));
assert(
  !before.some((c) => !ids.has(c.id) && sourceKeys.has(key(c))),
  "Matching customer outside this import; review before proceeding",
);
for (const c of expected)
  if (existing.has(c.id))
    assert.deepEqual(
      existing.get(c.id),
      c,
      "Existing imported customer changed; refusing overwrite",
    );
const fresh = expected.filter((c) => !existing.has(c.id));
const summary = {
  source: seed.source,
  sha256: seed.sha256,
  rows: expected.length,
  newCustomers: fresh.length,
  existingCustomers: before.length,
};
console.log(JSON.stringify(summary));
if (mode) {
  if (mode === "--execute") {
    await writeFile(`${input}.before.json`, JSON.stringify(before), {
      flag: "wx",
    }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    for (let offset = 0; offset < fresh.length; offset += 100) {
      const { error } = await db
        .from("customers")
        .insert(fresh.slice(offset, offset + 100));
      if (error) throw error;
      console.log(
        `Saved ${Math.min(offset + 100, fresh.length)}/${fresh.length}`,
      );
    }
  }
  const after = new Map((await readAll()).map((c) => [c.id, c]));
  for (const c of expected)
    assert.deepEqual(after.get(c.id), c, "Imported fields do not match source");
  for (const c of before)
    assert.deepEqual(after.get(c.id), c, "Pre-existing customer changed");
  const report = {
    ...summary,
    verified: expected.length,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(`${input}.result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
