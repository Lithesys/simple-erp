import { NextResponse, type NextRequest } from "next/server";
import { createRequestClient, createServiceClient } from "@/lib/data/server";
import { matchesSearchQuery } from "@/lib/search";

async function authorize(request: NextRequest) {
  const caller = await createRequestClient(request);
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user)
    return {
      response: NextResponse.json(
        { error: "Chưa đăng nhập." },
        { status: 401 },
      ),
    };
  const { data } = await caller.rpc("user_has_permission", {
    p_permission: "accounts.manage",
  });
  if (!data)
    return {
      response: NextResponse.json(
        { error: "Không có quyền quản lý tài khoản." },
        { status: 403 },
      ),
    };
  return { user };
}

async function wouldRemoveLastAdmin(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  nextRoleId?: string,
  nextActive = true,
) {
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id,role_id,is_active"),
    admin.from("roles").select("id,permissions"),
  ]);
  const roleMap = new Map(
    (roles || []).map((role) => [role.id, role.permissions as string[]]),
  );
  const current = profiles?.find((profile) => profile.id === userId);
  if (
    !current?.is_active ||
    !roleMap.get(current.role_id)?.includes("accounts.manage")
  )
    return false;
  const futureRole = nextRoleId || current.role_id;
  const stillAdmin =
    nextActive && roleMap.get(futureRole)?.includes("accounts.manage");
  if (stillAdmin) return false;
  const otherAdmins =
    profiles?.filter(
      (profile) =>
        profile.id !== userId &&
        profile.is_active &&
        roleMap.get(profile.role_id)?.includes("accounts.manage"),
    ) || [];
  return otherAdmins.length === 0;
}

export async function GET(request: NextRequest) {
  const guard = await authorize(request);
  if ("response" in guard) return guard.response;
  const page = Math.max(
    1,
    Number(request.nextUrl.searchParams.get("page")) || 1,
  );
  const perPage = [20, 50, 100].includes(
    Number(request.nextUrl.searchParams.get("size")),
  )
    ? Number(request.nextUrl.searchParams.get("size"))
    : 20;
  const allowedSorts = ["account", "role", "status", "last_sign_in"] as const;
  const requestedSort = request.nextUrl.searchParams.get("sort");
  const sort = allowedSorts.includes(
    requestedSort as (typeof allowedSorts)[number],
  )
    ? requestedSort!
    : "account";
  const direction =
    request.nextUrl.searchParams.get("dir") === "desc" ? "desc" : "asc";
  const query = request.nextUrl.searchParams.get("q") || "";
  const supabase = createServiceClient();
  const [rolesResult, allAuthUsers] = await Promise.all([
    supabase.from("roles").select("id,name").order("name"),
    (async () => {
      const users = [];
      for (let authPage = 1; ; authPage += 1) {
        const result = await supabase.auth.admin.listUsers({
          page: authPage,
          perPage: 1000,
        });
        if (result.error) return { users: [], error: result.error };
        users.push(...result.data.users);
        if (result.data.users.length < 1000) break;
      }
      return { users, error: null };
    })(),
  ]);
  if (allAuthUsers.error || rolesResult.error)
    return NextResponse.json(
      { error: allAuthUsers.error?.message || rolesResult.error?.message },
      { status: 500 },
    );
  const userIds = allAuthUsers.users.map((user) => user.id);
  const profiles = [];
  for (let start = 0; start < userIds.length; start += 500) {
    const result = await supabase
      .from("profiles")
      .select("id,username,display_name,is_active,role_id,roles(id,name)")
      .in("id", userIds.slice(start, start + 500));
    if (result.error)
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    profiles.push(...(result.data || []));
  }
  const profileMap = new Map(
    profiles.map((profile) => {
      const role = Array.isArray(profile.roles)
        ? (profile.roles[0] ?? null)
        : profile.roles;
      return [profile.id, { ...profile, roles: role }] as const;
    }),
  );
  const users = allAuthUsers.users
    .map((user) => ({
      id: user.id,
      email: user.email || "",
      last_sign_in_at: user.last_sign_in_at || null,
      profile: profileMap.get(user.id) || null,
    }))
    .filter(
      (user) =>
        !query ||
        matchesSearchQuery(
          `${user.email} ${user.profile?.username || ""} ${user.profile?.display_name || ""}`,
          query,
        ),
    );
  const roleName = (profile: { roles?: unknown } | null) => {
    const relation = profile?.roles;
    if (Array.isArray(relation)) return relation[0]?.name || "";
    return relation && typeof relation === "object" && "name" in relation
      ? String(relation.name || "")
      : "";
  };
  users.sort((left, right) => {
    let comparison = 0;
    if (sort === "status") {
      comparison =
        Number(Boolean(left.profile?.is_active)) -
        Number(Boolean(right.profile?.is_active));
    } else if (sort === "last_sign_in") {
      const leftTime = left.last_sign_in_at
        ? Date.parse(left.last_sign_in_at)
        : null;
      const rightTime = right.last_sign_in_at
        ? Date.parse(right.last_sign_in_at)
        : null;
      if (leftTime === null || rightTime === null) {
        if (leftTime === null && rightTime !== null) return 1;
        if (leftTime !== null && rightTime === null) return -1;
      } else {
        comparison = leftTime - rightTime;
      }
    } else {
      const leftValue =
        sort === "role"
          ? roleName(left.profile)
          : left.profile?.username || left.email;
      const rightValue =
        sort === "role"
          ? roleName(right.profile)
          : right.profile?.username || right.email;
      comparison = leftValue.localeCompare(rightValue, "vi", {
        numeric: true,
        sensitivity: "base",
      });
    }
    if (comparison !== 0 && direction === "desc") comparison *= -1;
    return comparison || left.id.localeCompare(right.id);
  });
  const start = (page - 1) * perPage;
  const activeTotal = users.filter((user) => user.profile?.is_active).length;
  return NextResponse.json({
    users: users.slice(start, start + perPage),
    roles: rolesResult.data,
    page,
    size: perPage,
    total: users.length,
    activeTotal,
    hasMore: start + perPage < users.length,
  });
}

export async function POST(request: NextRequest) {
  const guard = await authorize(request);
  if ("response" in guard) return guard.response;
  try {
    const body = (await request.json()) as {
      email?: string;
      username?: string;
      password?: string;
      display_name?: string;
      role_id?: string;
    };
    const email = body.email?.trim().toLowerCase() || "";
    const username = body.username?.trim().toLowerCase() || "";
    const displayName = body.display_name?.trim() || "";
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[a-z0-9._-]{3,32}$/.test(username) ||
      typeof body.password !== "string" ||
      body.password.length < 8 ||
      !body.role_id ||
      (body.display_name !== undefined && typeof body.display_name !== "string")
    )
      return NextResponse.json(
        {
          error:
            "Tên đăng nhập, email, mật khẩu tối thiểu 8 ký tự và vai trò là bắt buộc.",
        },
        { status: 400 },
      );
    const admin = createServiceClient();
    const { data: existingUsername, error: usernameError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (usernameError)
      return NextResponse.json(
        { error: usernameError.message },
        { status: 500 },
      );
    if (existingUsername)
      return NextResponse.json(
        { error: "Tên đăng nhập đã được sử dụng." },
        { status: 409 },
      );
    if (displayName.length > 300)
      return NextResponse.json(
        { error: "Tên hiển thị không được vượt quá 300 ký tự." },
        { status: 400 },
      );
    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("id")
      .eq("id", body.role_id)
      .maybeSingle();
    if (roleError)
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    if (!role)
      return NextResponse.json(
        { error: "Vai trò không còn tồn tại." },
        { status: 400 },
      );
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      app_metadata: { erp_managed: "true" },
      user_metadata: { display_name: displayName },
    });
    if (error || !created.user)
      return NextResponse.json(
        { error: error?.message || "Không tạo được tài khoản." },
        { status: 400 },
      );
    const { error: profileError } = await admin
      .from("profiles")
      .upsert(
        {
          id: created.user.id,
          username,
          display_name: displayName,
          role_id: body.role_id,
          is_active: true,
        },
        { onConflict: "id" },
      )
      .select("id")
      .single();
    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        created.user.id,
      );
      const message = cleanupError
        ? `${profileError.message} Không thể xóa tài khoản Auth vừa tạo: ${cleanupError.message}`
        : profileError.message;
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ id: created.user.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Yêu cầu không hợp lệ.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await authorize(request);
  if ("response" in guard) return guard.response;
  try {
    const body = (await request.json()) as {
      id: string;
      email?: string;
      username?: string;
      password?: string;
      display_name?: string;
      role_id?: string;
      is_active?: boolean;
    };
    if (!body.id)
      return NextResponse.json(
        { error: "Thiếu mã tài khoản." },
        { status: 400 },
      );
    const admin = createServiceClient();
    if (
      body.id === guard.user.id &&
      body.role_id &&
      body.role_id !==
        (
          await createServiceClient()
            .from("profiles")
            .select("role_id")
            .eq("id", body.id)
            .single()
        ).data?.role_id
    )
      return NextResponse.json(
        { error: "Không thể tự đổi vai trò của tài khoản đang đăng nhập." },
        { status: 400 },
      );
    if (
      (body.email !== undefined &&
        (!body.email.trim() ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) ||
      (body.username !== undefined &&
        (typeof body.username !== "string" ||
          !/^[a-zA-Z0-9._-]{3,32}$/.test(body.username.trim()))) ||
      (body.display_name !== undefined &&
        (typeof body.display_name !== "string" ||
          body.display_name.trim().length > 300)) ||
      (body.is_active !== undefined && typeof body.is_active !== "boolean") ||
      (body.password !== undefined && typeof body.password !== "string")
    )
      return NextResponse.json(
        { error: "Thông tin tài khoản không hợp lệ." },
        { status: 400 },
      );
    const { data: currentProfile, error: profileReadError } = await admin
      .from("profiles")
      .select("id,username,display_name,is_active,role_id")
      .eq("id", body.id)
      .maybeSingle();
    if (profileReadError)
      return NextResponse.json(
        { error: profileReadError.message },
        { status: 500 },
      );
    if (!currentProfile)
      return NextResponse.json(
        { error: "Không tìm thấy hồ sơ tài khoản." },
        { status: 404 },
      );
    if (body.role_id) {
      const { data: role, error: roleError } = await admin
        .from("roles")
        .select("id")
        .eq("id", body.role_id)
        .maybeSingle();
      if (roleError)
        return NextResponse.json({ error: roleError.message }, { status: 500 });
      if (!role)
        return NextResponse.json(
          { error: "Vai trò không còn tồn tại." },
          { status: 400 },
        );
    }
    if (body.username !== undefined) {
      const nextUsername = body.username.trim().toLowerCase();
      const { data: existingUsername, error: usernameError } = await admin
        .from("profiles")
        .select("id")
        .eq("username", nextUsername)
        .neq("id", body.id)
        .maybeSingle();
      if (usernameError)
        return NextResponse.json(
          { error: usernameError.message },
          { status: 500 },
        );
      if (existingUsername)
        return NextResponse.json(
          { error: "Tên đăng nhập đã được sử dụng." },
          { status: 409 },
        );
    }
    const userUpdate: {
      email?: string;
      email_confirm?: boolean;
      password?: string;
    } = {};
    if (body.email !== undefined) {
      const { data: authUser, error: authReadError } =
        await admin.auth.admin.getUserById(body.id);
      if (authReadError)
        return NextResponse.json(
          { error: authReadError.message },
          { status: 404 },
        );
      const nextEmail = body.email.trim().toLowerCase();
      if ((authUser.user.email || "").toLowerCase() !== nextEmail) {
        userUpdate.email = nextEmail;
        userUpdate.email_confirm = true;
      }
    }
    if (body.password) {
      if (body.password.length < 8)
        return NextResponse.json(
          { error: "Mật khẩu phải có ít nhất 8 ký tự." },
          { status: 400 },
        );
      userUpdate.password = body.password;
    }
    const profileUpdate: Record<string, unknown> = {};
    if (body.username !== undefined)
      profileUpdate.username = body.username.trim().toLowerCase();
    if (body.display_name !== undefined)
      profileUpdate.display_name = body.display_name.trim();
    if (body.role_id) profileUpdate.role_id = body.role_id;
    if (body.is_active !== undefined) profileUpdate.is_active = body.is_active;
    if (Object.keys(profileUpdate).length) {
      const nextActive = body.is_active ?? currentProfile.is_active;
      const nextRoleId = body.role_id ?? currentProfile.role_id;
      if (await wouldRemoveLastAdmin(admin, body.id, nextRoleId, nextActive))
        return NextResponse.json(
          { error: "Không thể loại bỏ quản trị viên hoạt động cuối cùng." },
          { status: 400 },
        );
      const { error } = await admin
        .from("profiles")
        .update(profileUpdate)
        .eq("id", body.id)
        .select("id")
        .single();
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (Object.keys(userUpdate).length) {
      const { error } = await admin.auth.admin.updateUserById(
        body.id,
        userUpdate,
      );
      if (error) {
        if (Object.keys(profileUpdate).length) {
          const profileRollback = Object.fromEntries(
            Object.keys(profileUpdate).map((key) => [
              key,
              currentProfile[key as keyof typeof currentProfile],
            ]),
          );
          await admin
            .from("profiles")
            .update(profileRollback)
            .eq("id", body.id)
            .match(profileUpdate);
        }
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Yêu cầu không hợp lệ.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await authorize(request);
  if ("response" in guard) return guard.response;
  const id = request.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Thiếu mã tài khoản." }, { status: 400 });
  if (id === guard.user.id)
    return NextResponse.json(
      { error: "Không thể xóa tài khoản đang đăng nhập." },
      { status: 400 },
    );
  const admin = createServiceClient();
  if (await wouldRemoveLastAdmin(admin, id, undefined, false))
    return NextResponse.json(
      { error: "Không thể xóa quản trị viên hoạt động cuối cùng." },
      { status: 400 },
    );
  const { error } = await admin.auth.admin.deleteUser(id);
  return error
    ? NextResponse.json({ error: error.message }, { status: 400 })
    : NextResponse.json({ ok: true });
}
