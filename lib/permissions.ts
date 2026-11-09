// 服务端权限查询。请勿在客户端组件中导入本文件。
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  buildPermissions,
  type Viewer,
  type UserRole,
  type UserStatus,
  type BadgeTier,
  type VerificationStatus,
} from "@/lib/access-types";

/** 同一请求内只查一次库。返回 null 表示未登录或档案缺失。 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return null;

  const userId = userData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select(
      "user_id, email, real_name, role, status, is_contributor, badge_label, badge_tier, contribution_note, branch_scope",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile) return null;

  const { data: claims } = await supabase
    .from("member_claims")
    .select("member_id")
    .eq("user_id", userId)
    .eq("status", "approved");

  // 实名登记状态：表不存在时降级为 none，避免迁移窗口期整站报错。
  const { data: verification } = await supabase
    .from("user_verifications")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    userId,
    email: profile.email || userData.user.email || "",
    realName: profile.real_name || "",
    role: profile.role as UserRole,
    status: profile.status as UserStatus,
    approvedClaimIds: (claims ?? []).map((row) => Number(row.member_id)),
    verification: (verification?.status as VerificationStatus) ?? "none",
    isContributor: Boolean(profile.is_contributor),
    badgeLabel: profile.badge_label ?? "",
    badgeTier: (profile.badge_tier as BadgeTier) ?? "none",
    contributionNote: profile.contribution_note ?? "",
    branchScope:
      typeof profile.branch_scope === "number" ? profile.branch_scope : null,
  };
});

/**
 * 服务端 action 的统一闸门，返回 null 表示放行，否则返回可直接展示给用户的错误文案。
 * 这只是第一道检查；数据库 RLS 是最终边界，防止绕过前端直接调 PostgREST。
 */
/**
 * 房支管理员是否可管理该成员（本支内）。仅当 viewer 为房支管理员且该成员在房支子树内。
 * 用于 action 内的二次校验；真正的边界仍是数据库 RLS。
 */
export async function canBranchAdminManage(memberId?: number): Promise<boolean> {
  const viewer = await getViewer();
  if (!viewer || viewer.status !== "active" || viewer.role !== "branch_admin") {
    return false;
  }
  if (typeof memberId !== "number") return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_branch_admin_for", {
    p_member_id: memberId,
  });
  if (error) return false;
  return Boolean(data);
}

export async function guard(
  kind: "active" | "admin" | "edit" | "write" | "verified",
  memberId?: number,
): Promise<string | null> {
  const viewer = await getViewer();
  if (!viewer) return "未登录或会话已失效，请重新登录。";
  if (viewer.status !== "active") {
    return "账号尚未通过管理员审核，或已被停用，暂无访问权限。";
  }
  if (kind === "admin" && viewer.role !== "admin") {
    return "只有总管理员可以执行此操作。";
  }
  if (kind === "verified" && viewer.verification !== "verified" && viewer.role !== "admin") {
    return "请先完成实名登记并通过管理员核对，再查看联系资料。";
  }
  if (kind === "write") {
    // 增删 / 批量 / 导入：总管理员或房支管理员（具体范围由 RLS 限定）。
    if (viewer.role !== "admin" && viewer.role !== "branch_admin") {
      return "只有总管理员或房支管理员可以执行此操作。";
    }
    if (viewer.role === "branch_admin" && typeof memberId === "number") {
      const ok = await canBranchAdminManage(memberId);
      if (!ok) return "该成员不在你管辖的房支范围内，无权操作。";
    }
  }
  if (kind === "edit" && typeof memberId === "number") {
    if (!buildPermissions(viewer).canEditAny && !viewer.approvedClaimIds.includes(memberId)) {
      if (viewer.role === "branch_admin") {
        const ok = await canBranchAdminManage(memberId);
        if (!ok) return "该成员不在你管辖的房支范围内，无权编辑。";
      } else {
        return "你没有编辑该成员的权限。普通用户需先认领自己的记录，并由管理员批准。";
      }
    }
  }
  return null;
}

export async function requireViewer(): Promise<Viewer | null> {
  const viewer = await getViewer();
  if (!viewer || viewer.status !== "active") return null;
  return viewer;
}

export async function isAdminViewer(): Promise<boolean> {
  const viewer = await getViewer();
  return !!viewer && viewer.status === "active" && viewer.role === "admin";
}
