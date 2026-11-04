import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.",
  );

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Set ADMIN_EMAIL to the initial administrator email in .env.local.");
let user = null;
for (let page = 1; !user; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw error;
  user = data.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );
  if (user || data.users.length < 1000) break;
}

if (!user) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("Set a unique ADMIN_PASSWORD of at least 12 characters in .env.local.");
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { erp_managed: "true" },
    user_metadata: { display_name: "Quản trị viên" },
  });
  if (error) throw error;
  user = data.user;
  console.log(
    "Created the first admin account. Change its temporary password after signing in.",
  );
} else {
  console.log(
    "Admin account already exists; its current password was not changed.",
  );
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, erp_managed: "true" },
  });
  if (error) throw error;
}

const { data: role, error: roleError } = await supabase
  .from("roles")
  .select("id")
  .eq("name", "Admin")
  .single();
if (roleError) throw roleError;
const { error: profileError } = await supabase.from("profiles").upsert(
  {
    id: user.id,
    display_name: user.user_metadata?.display_name || "Quản trị viên",
    role_id: role.id,
    is_active: true,
  },
  { onConflict: "id" },
);
if (profileError) throw profileError;
console.log("Admin profile is ready.");
