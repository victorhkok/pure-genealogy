"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, guard } from "@/lib/permissions";
import type { UserRole, UserStatus } from "@/lib/access-types";

export interface ProfileRow {
  user_id: string;
  email: string;
  real_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface ClaimRow {
  id: number;
  user_id: string;
  member_id: number;
  member_name: string;
  applicant_email: string;
  real_name: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface AdminData {
  profiles: ProfileRow[];
  claims: ClaimRow[];
  error: string | null;
}

/** 管理后台首屏数据：全部用户档案 + 全部认领申请（仅管理员可读）。 */
export async function fetchAdminData(): Promise<AdminData> {
  const denied = await guard("admin");
  if (denied) return { profiles: [], claims: [], error: denied };

  const supabase = await createClient();
  const { data: profiles, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (profileError) return { profiles: [], claims: [], error: profileError.message };

  const { data: claims, error: claimError } = await supabase
    .from("member_claims")
    .select("*")
    .order("created_at", { ascending: false });
  if (claimError) {
    return { profiles: (profiles ?? []) as ProfileRow[], claims: [], error: claimError.message };
  }

  const rows = (profiles ?? []) as ProfileRow[];
  const emailById = new Map(rows.map((p) => [p.user_id, p.email]));
  const memberIds = Array.from(new Set((claims ?? []).map((c) => Number(c.member_id))));
  const nameById = new Map<number, string>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from("family_members")
      .select("id, name")
      .in("id", memberIds);
    (members ?? []).forEach((m) => nameById.set(Number(m.id), String(m.name)));
  }

  const claimRows: ClaimRow[] = (claims ?? []).map((c) => ({
    id: Number(c.id),
    user_id: String(c.user_id),
    member_id: Number(c.member_id),
    member_name: nameById.get(Number(c.member_id)) ?? `ID ${c.member_id}`,
    applicant_email: emailById.get(String(c.user_id)) ?? String(c.user_id),
    real_name: String(c.real_name ?? ""),
    note: c.note ?? null,
    status: c.status as ClaimRow["status"],
    created_at: String(c.created_at ?? ""),
  }));

  return { profiles: rows, claims: claimRows, error: null };
}

export interface ManagedUserInput {
  email: string;
  password: string;
  realName: string;
  role: UserRole;
}

/** 管理员直接建号：建完即启用，无需走注册审核。 */
export async function createManagedUser(
  input: ManagedUserInput,
): Promise<{ error: string | null; userId?: string }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };

  const email = input.email.trim().toLowerCase();
  const realName = input.realName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "邮箱格式不正确" };
  if (!realName) return { error: "请填写真实姓名" };
  if (!input.password || input.password.length < 6) return { error: "初始密码至少 6 位" };
  if (!["admin", "editor", "member"].includes(input.role)) return { error: "角色不合法" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { real_name: realName },
  });
  if (error || !data.user) return { error: error?.message ?? "创建账号失败" };

  // 触发器会创建 pending/member 档案；用 upsert 兜底并直接设为启用。
  const viewer = await getViewer();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error: upsertError } = await supabase.from("user_profiles").upsert(
    {
      user_id: data.user.id,
      email,
      real_name: realName,
      role: input.role,
      status: "active",
      approved_by: viewer?.userId ?? null,
      approved_at: now,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (upsertError) {
    return { error: `账号已创建，但档案写入失败：${upsertError.message}`, userId: data.user.id };
  }

  revalidatePath("/family-tree/admin");
  return { error: null, userId: data.user.id };
}

/** 启用 / 停用 / 打回待审核。 */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  if (viewer?.userId === userId && status !== "active") {
    return { error: "不能停用自己的账号" };
  }
  if (!["pending", "active", "disabled"].includes(status)) return { error: "状态不合法" };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_profiles")
    .update({
      status,
      approved_by: status === "active" ? viewer?.userId ?? null : undefined,
      approved_at: status === "active" ? now : undefined,
      updated_at: now,
    })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  return { error: null };
}

/** 调整角色：admin / editor / member。 */
export async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  if (viewer?.userId === userId && role !== "admin") {
    return { error: "不能取消自己的管理员角色" };
  }
  if (!["admin", "editor", "member"].includes(role)) return { error: "角色不合法" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  return { error: null };
}

/** 管理员重置某账号的登录密码。 */
export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  if (!password || password.length < 6) return { error: "新密码至少 6 位" };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  return { error: null };
}

/** 审批认领申请。批准前检查一人一条 / 一条一人的约束，给出友好提示。 */
export async function reviewMemberClaim(
  claimId: number,
  approve: boolean,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };

  const supabase = await createClient();
  const viewer = await getViewer();
  const { data: claim, error: readError } = await supabase
    .from("member_claims")
    .select("id, user_id, member_id, status")
    .eq("id", claimId)
    .maybeSingle();
  if (readError || !claim) return { error: readError?.message ?? "申请不存在" };
  if (claim.status !== "pending") return { error: "该申请已处理，不能重复审批" };

  if (approve) {
    const { data: existing } = await supabase
      .from("member_claims")
      .select("id")
      .eq("status", "approved")
      .or(`user_id.eq.${claim.user_id},member_id.eq.${claim.member_id}`)
      .limit(1);
    if (existing && existing.length > 0) {
      return { error: "该用户已有生效认领，或该成员已被他人认领；请先撤销原认领" };
    }
  }

  const { error } = await supabase
    .from("member_claims")
    .update({
      status: approve ? "approved" : "rejected",
      reviewed_by: viewer?.userId ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree");
  return { error: null };
}

/** 撤销一条已生效 / 待审的认领（释放成员占用）。 */
export async function revokeMemberClaim(claimId: number): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase.from("member_claims").delete().eq("id", claimId);
  if (error) return { error: error.message };
  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree");
  return { error: null };
}
