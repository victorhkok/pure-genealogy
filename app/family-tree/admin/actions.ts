"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, guard } from "@/lib/permissions";
import { maskPersonName } from "@/lib/masking";
import type { UserRole, UserStatus, BadgeTier, VerificationStatus } from "@/lib/access-types";

export interface ProfileRow {
  user_id: string;
  email: string;
  real_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  is_contributor: boolean;
  badge_label: string | null;
  badge_tier: BadgeTier;
  contribution_note: string | null;
  branch_scope: number | null;
}

export interface MemberOption {
  id: number;
  name: string;
}

export interface VerificationReviewRow {
  user_id: string;
  email: string;
  real_name_masked: string;
  phone_masked: string;
  id_number_masked: string;
  address_masked: string;
  status: VerificationStatus;
  review_note: string | null;
  revision: number;
  submitted_at: string;
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
  verifications: VerificationReviewRow[];
  /** 全部成员（房支管理员选房祖用）。 */
  members: MemberOption[];
  /** 当前操作者是否为房支管理员（前端据此收窄界面）。 */
  isBranchAdminView: boolean;
  error: string | null;
}

/** 计算以 rootId 为房祖的子树（含自身及全部后代）。 */
function collectBranch(
  members: { id: number; father_id: number | null }[],
  rootId: number,
): Set<number> {
  const childrenMap = new Map<number, number[]>();
  for (const m of members) {
    if (m.father_id != null) {
      const arr = childrenMap.get(m.father_id) ?? [];
      arr.push(m.id);
      childrenMap.set(m.father_id, arr);
    }
  }
  const result = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    if (result.has(cur)) continue;
    result.add(cur);
    for (const child of childrenMap.get(cur) ?? []) stack.push(child);
  }
  return result;
}

/** 管理后台首屏数据。总管理员看全部；房支管理员只看本支范围内的用户 / 认领 / 实名。 */
export async function fetchAdminData(): Promise<AdminData> {
  const viewer = await getViewer();
  if (!viewer || viewer.status !== "active") {
    return { profiles: [], claims: [], verifications: [], members: [], isBranchAdminView: false, error: "未登录或会话已失效。" };
  }
  const isAdmin = viewer.role === "admin";
  const isBranchAdmin = viewer.role === "branch_admin";

  const supabase = await createClient();
  const { data: profiles, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (profileError)
    return { profiles: [], claims: [], verifications: [], members: [], isBranchAdminView: isBranchAdmin, error: profileError.message };

  const { data: allClaims, error: claimError } = await supabase
    .from("member_claims")
    .select("*")
    .order("created_at", { ascending: false });
  if (claimError) {
    return {
      profiles: (profiles ?? []) as ProfileRow[],
      claims: [],
      verifications: [],
      members: [],
      isBranchAdminView: isBranchAdmin,
      error: claimError.message,
    };
  }

  const rows = (profiles ?? []) as ProfileRow[];
  const emailById = new Map(rows.map((p) => [p.user_id, p.email]));

  // 成员列表（选房祖用）。房支管理员仅需要本支成员，但为简化给全部。
  const { data: membersRaw } = await supabase
    .from("family_members")
    .select("id, name, father_id")
    .order("id");
  const members: MemberOption[] = (membersRaw ?? []).map((m) => ({
    id: Number(m.id),
    name: String(m.name ?? ""),
  }));
  const memberFathers = (membersRaw ?? []).map((m) => ({
    id: Number(m.id),
    father_id: m.father_id == null ? null : Number(m.father_id),
  }));

  // 房支子树：房支管理员仅能看本支范围内数据。
  let branchSet: Set<number> | null = null;
  if (isBranchAdmin && viewer.branchScope != null) {
    branchSet = collectBranch(memberFathers, viewer.branchScope);
  }

  // 认领：过滤出与本支相关的（成员在子树内）。
  const claimsAll = allClaims ?? [];
  const claimsVisible = branchSet
    ? claimsAll.filter((c) => branchSet!.has(Number(c.member_id)))
    : claimsAll;
  const memberIds = Array.from(new Set(claimsVisible.map((c) => Number(c.member_id))));
  const nameById = new Map<number, string>();
  if (memberIds.length > 0) {
    const { data: membersForNames } = await supabase
      .from("family_members")
      .select("id, name")
      .in("id", memberIds);
    (membersForNames ?? []).forEach((m) => nameById.set(Number(m.id), String(m.name)));
  }
  const claimRows: ClaimRow[] = claimsVisible.map((c) => ({
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

  // 可见用户集合：房支管理员 = 本支认领的申请者 + 自己；总管理员 = 全部。
  let visibleUserIds: Set<string>;
  if (branchSet) {
    visibleUserIds = new Set<string>([
      viewer.userId,
      ...claimsVisible.map((c) => String(c.user_id)),
    ]);
  } else {
    visibleUserIds = new Set(rows.map((p) => p.user_id));
  }
  const profilesVisible = rows.filter((p) => visibleUserIds.has(p.user_id));

  // 实名核对：总管理员看全部；房支管理员只看本支可见用户。
  const { data: verifications } = await supabase
    .from("user_verifications")
    .select("user_id, real_name_masked, phone_masked, id_number_masked, address_masked, status, review_note, revision, submitted_at")
    .in("user_id", Array.from(visibleUserIds))
    .order("submitted_at", { ascending: false });
  const verificationRows: VerificationReviewRow[] = (verifications ?? []).map((v) => ({
    user_id: String(v.user_id),
    email: emailById.get(String(v.user_id)) ?? String(v.user_id),
    real_name_masked: String(v.real_name_masked ?? ""),
    phone_masked: String(v.phone_masked ?? ""),
    id_number_masked: String(v.id_number_masked ?? ""),
    address_masked: String(v.address_masked ?? ""),
    status: v.status as VerificationStatus,
    review_note: v.review_note ?? null,
    revision: Number(v.revision ?? 1),
    submitted_at: String(v.submitted_at ?? ""),
  }));

  return {
    profiles: profilesVisible,
    claims: claimRows,
    verifications: verificationRows,
    members,
    isBranchAdminView: isBranchAdmin,
    error: null,
  };
}

/** 设置 / 取消「认证贡献者」徽章与贡献备注（大 V 式标记）。 */
export async function setContributorBadge(
  userId: string,
  input: {
    isContributor: boolean;
    badgeLabel: string;
    badgeTier: BadgeTier;
    contributionNote: string;
  },
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  if (!["none", "gold", "silver", "bronze"].includes(input.badgeTier)) {
    return { error: "徽章等级不合法" };
  }
  if (input.badgeLabel.length > 30 || input.contributionNote.length > 300) {
    return { error: "徽章文字最多 30 字，贡献备注最多 300 字" };
  }
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_profiles")
    .update({
      is_contributor: input.isContributor,
      badge_label: input.badgeLabel.trim() || null,
      badge_tier: input.isContributor ? input.badgeTier : "none",
      contribution_note: input.contributionNote.trim() || null,
      contributor_since: input.isContributor ? now : null,
      updated_at: now,
    })
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree/settings");
  revalidatePath("/family-tree/contributors");
  return { error: null };
}

/**
 * 离线实名核对：管理员线下核对证件后，把状态标为已实名 / 驳回。
 * 系统里只有星号串，明文姓名手机号证件号从未入库，也无法在这里看到。
 */
export async function reviewVerification(
  userId: string,
  approve: boolean,
  note: string,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_verifications")
    .update({
      status: approve ? "verified" : "rejected",
      review_note: note.trim() || null,
      verified_by: viewer?.userId ?? null,
      verified_at: now,
    })
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree/settings");
  return { error: null };
}

export interface ManagedUserInput {
  email: string;
  password: string;
  realName: string;
  role: UserRole;
  /** 房支管理员管辖的房祖成员 ID；非房支管理员传 null。 */
  branchScope?: number | null;
}

/** 管理员直接建号：建完即启用，无需走注册审核。 */
export async function createManagedUser(
  input: ManagedUserInput,
): Promise<{ error: string | null; userId?: string }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };

  const email = input.email.trim().toLowerCase();
  // 明文姓名不入库：建号时即转为星号串（王振业 → 王*业）。
  const realName = maskPersonName(input.realName);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "邮箱格式不正确" };
  if (!realName) return { error: "请填写真实姓名" };
  if (!input.password || input.password.length < 6) return { error: "初始密码至少 6 位" };
  if (!["admin", "branch_admin", "editor", "member"].includes(input.role)) {
    return { error: "角色不合法" };
  }
  if (input.role === "branch_admin") {
    if (typeof input.branchScope !== "number") return { error: "房支管理员必须选择管辖房祖" };
  }

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
      branch_scope: input.role === "branch_admin" ? (input.branchScope ?? null) : null,
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
  const viewer = await getViewer();
  // 总管理员可改任意账号；房支管理员只能改本支用户。
  if (!viewer || viewer.status !== "active") return { error: "未登录或会话已失效。" };
  const isAdmin = viewer.role === "admin";
  if (!isAdmin) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("user_in_my_branch", { p_user_id: userId });
    if (!Boolean(data)) return { error: "你只能操作本房支内的用户。" };
  }
  if (viewer.userId === userId && status !== "active") {
    return { error: "不能停用自己的账号" };
  }
  if (!["pending", "active", "disabled"].includes(status)) return { error: "状态不合法" };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_profiles")
    .update({
      status,
      approved_by: status === "active" ? viewer.userId ?? null : undefined,
      approved_at: status === "active" ? now : undefined,
      updated_at: now,
    })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  return { error: null };
}

/** 调整角色：admin / branch_admin / editor / member（仅总管理员）。 */
export async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  if (viewer?.userId === userId && role !== "admin") {
    return { error: "不能取消自己的总管理员角色" };
  }
  if (!["admin", "branch_admin", "editor", "member"].includes(role)) {
    return { error: "角色不合法" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  return { error: null };
}

/** 设置房支管理员的管辖房祖（仅总管理员）。 */
export async function setUserBranchScope(
  userId: string,
  memberId: number | null,
): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ branch_scope: memberId ?? null, updated_at: new Date().toISOString() })
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

/** 审批认领申请。批准前检查一人一条 / 一条一人的约束，给出友好提示。
 *  总管理员可审全部；房支管理员仅可审本支成员。 */
export async function reviewMemberClaim(
  claimId: number,
  approve: boolean,
): Promise<{ error: string | null }> {
  const viewer = await getViewer();
  if (!viewer || viewer.status !== "active") return { error: "未登录或会话已失效。" };
  const isAdmin = viewer.role === "admin";
  const supabase = await createClient();

  const { data: claim, error: readError } = await supabase
    .from("member_claims")
    .select("id, user_id, member_id, status")
    .eq("id", claimId)
    .maybeSingle();
  if (readError || !claim) return { error: readError?.message ?? "申请不存在" };
  if (claim.status !== "pending") return { error: "该申请已处理，不能重复审批" };

  if (!isAdmin) {
    const { data: branchOk } = await supabase.rpc("is_branch_admin_for", {
      p_member_id: Number(claim.member_id),
    });
    if (!Boolean(branchOk)) return { error: "该认领不在你管辖的房支范围内。" };
  }

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
      reviewed_by: viewer.userId ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) return { error: error.message };

  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree");
  return { error: null };
}

/** 撤销一条已生效 / 待审的认领（释放成员占用）。
 *  总管理员可撤全部；房支管理员仅可撤本支成员的认领。 */
export async function revokeMemberClaim(claimId: number): Promise<{ error: string | null }> {
  const viewer = await getViewer();
  if (!viewer || viewer.status !== "active") return { error: "未登录或会话已失效。" };
  const isAdmin = viewer.role === "admin";
  const supabase = await createClient();
  const { data: claim, error: readError } = await supabase
    .from("member_claims")
    .select("member_id")
    .eq("id", claimId)
    .maybeSingle();
  if (readError || !claim) return { error: readError?.message ?? "申请不存在" };
  if (!isAdmin) {
    const { data: branchOk } = await supabase.rpc("is_branch_admin_for", {
      p_member_id: Number(claim.member_id),
    });
    if (!Boolean(branchOk)) return { error: "该认领不在你管辖的房支范围内。" };
  }
  const { error } = await supabase.from("member_claims").delete().eq("id", claimId);
  if (error) return { error: error.message };
  revalidatePath("/family-tree/admin");
  revalidatePath("/family-tree");
  return { error: null };
}
