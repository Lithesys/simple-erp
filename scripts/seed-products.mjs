// Preview by default. Exact source-row IDs allow recovery without duplicate products.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const [input, mode] = process.argv.slice(2);
assert(
  input && (!mode || ["--execute", "--verify"].includes(mode)),
  "Usage: node --env-file=.env.local scripts/seed-products.mjs input.json [--execute|--verify]",
);
const seed = JSON.parse(await readFile(input, "utf8"));
assert(/^[a-f0-9]{64}$/.test(seed.sha256) && seed.products.length > 0);
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
assert(expectedProjectRef, "Set EXPECTED_SUPABASE_PROJECT_REF to the intended Supabase project before running this script.");
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  `${expectedProjectRef}.supabase.co`,
  "Unexpected target project",
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
async function result(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
const lists = await result(
  db.from("price_lists").select("id,name").eq("is_active", true),
);
assert.deepEqual(
  lists.map((l) => l.name).sort(),
  ["Chở đi", "Giá chung", "Giá sĩ"].sort(),
);
const expected = seed.products.map((p) => {
  assert(Number.isInteger(p.row) && p.row >= 2 && p.name && p.unit);
  assert(Number.isFinite(p.stock) && Number.isFinite(p.cost) && p.cost >= 0);
  assert(
    lists.every(
      (l) => Number.isFinite(p.prices[l.name]) && p.prices[l.name] >= 0,
    ),
  );
  const hash = createHash("sha256")
    .update(`${seed.sha256}:${p.row}`)
    .digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { ...p, id };
});
assert.equal(new Set(expected.map((p) => p.id)).size, expected.length);
const ids = new Set(expected.map((p) => p.id));
async function readProducts() {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const page = await result(
      db
        .from("products")
        .select(
          "id,sku,name,unit,stock,is_active,product_costs(cost),product_prices(price,price_list_id)",
        )
        .order("id")
        .range(offset, offset + 499),
    );
    all.push(...page);
    if (page.length < 500) return all;
  }
}
const before = await readProducts();
const existing = new Map(before.map((p) => [p.id, p]));
assert(
  !before.some(
    (p) =>
      !ids.has(p.id) &&
      expected.some(
        (e) =>
          e.name.toLocaleLowerCase("vi") === p.name.toLocaleLowerCase("vi"),
      ),
  ),
  "Existing matching names outside this import require review",
);
for (const p of expected) {
  const old = existing.get(p.id);
  if (old)
    for (const key of ["name", "unit", "stock"])
      assert.equal(
        old[key],
        p[key],
        `Existing ${key} changed for source row ${p.row}; refusing overwrite`,
      );
}
const summary = {
  source: seed.source,
  sha256: seed.sha256,
  rows: expected.length,
  newProducts: expected.filter((p) => !existing.has(p.id)).length,
  existingProducts: existing.size,
  negativeStock: expected.filter((p) => p.stock < 0).length,
};
console.log(JSON.stringify(summary));
if (!mode) process.exit(0);
if (mode === "--execute") {
  await writeFile(`${input}.before.json`, JSON.stringify(before, null, 2), {
    flag: "wx",
  }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  for (let offset = 0; offset < expected.length; offset += 50) {
    const batch = expected.slice(offset, offset + 50);
    const fresh = batch
      .filter((p) => !existing.has(p.id))
      .map(({ id, name, unit, stock }) => ({ id, name, unit, stock }));
    if (fresh.length) await result(db.from("products").insert(fresh));
    // Only fill absent/zero seed defaults; never overwrite differing populated values.
    for (const p of batch) {
      const old = existing.get(p.id);
      const cost = old?.product_costs?.cost;
      assert(
        cost == null || cost === 0 || cost === p.cost,
        `Cost conflict: row ${p.row}`,
      );
      for (const list of lists) {
        const price = old?.product_prices?.find(
          (item) => item.price_list_id === list.id,
        )?.price;
        assert(
          price == null || price === p.prices[list.name],
          `Price conflict: row ${p.row}`,
        );
      }
    }
    await result(
      db.from("product_costs").upsert(
        batch.map((p) => ({ product_id: p.id, cost: p.cost })),
        { onConflict: "product_id" },
      ),
    );
    await result(
      db.from("product_prices").upsert(
        batch.flatMap((p) =>
          lists.map((l) => ({
            product_id: p.id,
            price_list_id: l.id,
            price: p.prices[l.name],
          })),
        ),
        { onConflict: "product_id,price_list_id" },
      ),
    );
    console.log(
      `Saved ${Math.min(offset + 50, expected.length)}/${expected.length}`,
    );
  }
}
const after = await readProducts();
for (const p of expected) {
  const actual = after.find((a) => a.id === p.id);
  assert(actual, `Missing row ${p.row}`);
  for (const key of ["name", "unit", "stock"])
    assert.equal(actual[key], p[key], `Mismatch ${key}: row ${p.row}`);
  assert.equal(actual.is_active, true);
  assert.equal(actual.product_costs?.cost, p.cost);
  for (const list of lists)
    assert.equal(
      actual.product_prices.find((a) => a.price_list_id === list.id)?.price,
      p.prices[list.name],
      `Price mismatch: row ${p.row}`,
    );
}
const report = {
  ...summary,
  verifiedProducts: expected.length,
  verifiedPrices: expected.length * lists.length,
  verifiedCosts: expected.length,
  verifiedAt: new Date().toISOString(),
};
await writeFile(`${input}.result.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
