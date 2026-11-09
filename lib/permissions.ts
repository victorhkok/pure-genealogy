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
      "user_id, email, real_name, role, status, is_contributor, badge_label, badge_tier, contribution_note",
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
  };
});

/**
 * 服务端 action 的统一闸门，返回 null 表示放行，否则返回可直接展示给用户的错误文案。
 * 这只是第一道检查；数据库 RLS 是最终边界，防止绕过前端直接调 PostgREST。
 */
export async function guard(
  kind: "active" | "admin" | "edit" | "verified",
  memberId?: number,
): Promise<string | null> {
  const viewer = await getViewer();
  if (!viewer) return "未登录或会话已失效，请重新登录。";
  if (viewer.status !== "active") {
    return "账号尚未通过管理员审核，或已被停用，暂无访问权限。";
  }
  if (kind === "admin" && viewer.role !== "admin") {
    return "只有管理员可以执行此操作。";
  }
  if (kind === "verified" && viewer.verification !== "verified" && viewer.role !== "admin") {
    return "请先完成实名登记并通过管理员核对，再查看联系资料。";
  }
  if (kind === "edit" && typeof memberId === "number") {
    if (!buildPermissions(viewer).canEditAny && !viewer.approvedClaimIds.includes(memberId)) {
      return "你没有编辑该成员的权限。普通用户需先认领自己的记录，并由管理员批准。";
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
