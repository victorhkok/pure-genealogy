"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer, guard } from "@/lib/permissions";
import {
  assertMasked,
  looksMaskedPhone,
  looksMaskedIdCard,
  type MaskedIdentity,
} from "@/lib/masking";
import type { VerificationStatus, BadgeTier } from "@/lib/access-types";

export interface VerificationRow {
  realNameMasked: string;
  phoneMasked: string;
  idNumberMasked: string;
  addressMasked: string;
  status: VerificationStatus;
  reviewNote: string | null;
  revision: number;
  submittedAt: string;
  verifiedAt: string | null;
}

export interface PrivateRecordRow {
  memberId: number;
  memberName: string;
  contactNameMasked: string;
  phoneMasked: string;
  idNumberMasked: string;
  addressMasked: string;
  note: string;
  updatedAt: string;
}

export interface ContributorRow {
  userId: string;
  realName: string;
  badgeLabel: string;
  badgeTier: BadgeTier;
  contributionNote: string;
  since: string | null;
}

/** 我的实名登记状态。明文永不入库，这里返回的已经是星号串。 */
export async function fetchMyVerification(): Promise<{
  data: VerificationRow | null;
  error: string | null;
}> {
  const viewer = await getViewer();
  if (!viewer) return { data: null, error: "未登录或会话已失效" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_verifications")
    .select("real_name_masked, phone_masked, id_number_masked, address_masked, status, review_note, revision, submitted_at, verified_at")
    .eq("user_id", viewer.userId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };
  return {
    data: {
      realNameMasked: String(data.real_name_masked ?? ""),
      phoneMasked: String(data.phone_masked ?? ""),
      idNumberMasked: String(data.id_number_masked ?? ""),
      addressMasked: String(data.address_masked ?? ""),
      status: data.status as VerificationStatus,
      reviewNote: data.review_note ?? null,
      revision: Number(data.revision ?? 1),
      submittedAt: String(data.submitted_at ?? ""),
      verifiedAt: data.verified_at ? String(data.verified_at) : null,
    },
    error: null,
  };
}

/**
 * 提交 / 重新提交实名资料。参数必须是浏览器端已打星的串；
 * 服务端再次 assertMasked，杜绝绕过前端直接 POST 明文。
 * 重新提交（含换手机号）会被数据库触发器打回 pending，需管理员重新核对。
 */
export async function submitVerification(
  input: MaskedIdentity,
): Promise<{ error: string | null }> {
  const denied = await guard("active");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  if (!viewer) return { error: "未登录或会话已失效" };

  try {
    assertMasked({
      姓名: input.realNameMasked,
      手机号: input.phoneMasked,
      证件号: input.idNumberMasked,
      联系地址: input.addressMasked,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "资料格式不正确" };
  }
  if (!input.realNameMasked || !input.phoneMasked) {
    return { error: "请填写姓名与手机号" };
  }
  if (!looksMaskedPhone(input.phoneMasked)) {
    return { error: "手机号脱敏格式不正确，应为 138****5678 形式" };
  }
  if (!looksMaskedIdCard(input.idNumberMasked)) {
    return { error: "证件号脱敏格式不正确，应为 110101********1234 形式" };
  }

  const supabase = await createClient();
  const payload = {
    real_name_masked: input.realNameMasked,
    phone_masked: input.phoneMasked,
    id_number_masked: input.idNumberMasked,
    address_masked: input.addressMasked,
    submitted_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from("user_verifications")
    .select("user_id")
    .eq("user_id", viewer.userId)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("user_verifications").update(payload).eq("user_id", viewer.userId)
    : await supabase.from("user_verifications").insert({ user_id: viewer.userId, ...payload });
  if (error) return { error: error.message };

  revalidatePath("/family-tree/settings");
  revalidatePath("/family-tree/admin");
  return { error: null };
}

/** 我这一分支内可见的成员联系资料（RLS 自动过滤：已实名 + 直系祖先/全部后代）。 */
export async function fetchPrivateRecords(): Promise<{
  rows: PrivateRecordRow[];
  error: string | null;
  canView: boolean;
}> {
  const denied = await guard("active");
  if (denied) return { rows: [], error: denied, canView: false };
  const viewer = await getViewer();
  const canView =
    viewer?.role === "admin" ||
    (viewer?.verification === "verified" && (viewer.approvedClaimIds?.length ?? 0) > 0);
  if (!canView) return { rows: [], error: null, canView: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_private_profiles")
    .select("member_id, contact_name_masked, phone_masked, id_number_masked, address_masked, note, updated_at")
    .order("member_id");
  if (error) return { rows: [], error: error.message, canView };
  const ids = (data ?? []).map((r) => Number(r.member_id));
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: members } = await supabase
      .from("family_members")
      .select("id, name")
      .in("id", ids);
    (members ?? []).forEach((m) => nameById.set(Number(m.id), String(m.name)));
  }
  return {
    canView,
    error: null,
    rows: (data ?? []).map((r) => ({
      memberId: Number(r.member_id),
      memberName: nameById.get(Number(r.member_id)) ?? `ID ${r.member_id}`,
      contactNameMasked: String(r.contact_name_masked ?? ""),
      phoneMasked: String(r.phone_masked ?? ""),
      idNumberMasked: String(r.id_number_masked ?? ""),
      addressMasked: String(r.address_masked ?? ""),
      note: String(r.note ?? ""),
      updatedAt: String(r.updated_at ?? ""),
    })),
  };
}

/** 管理员维护成员联系资料（同样只存脱敏串）。 */
export async function savePrivateRecord(input: {
  memberId: number;
  contactNameMasked: string;
  phoneMasked: string;
  idNumberMasked: string;
  addressMasked: string;
  note: string;
}): Promise<{ error: string | null }> {
  const denied = await guard("admin");
  if (denied) return { error: denied };
  try {
    assertMasked({
      联系人: input.contactNameMasked,
      手机号: input.phoneMasked,
      证件号: input.idNumberMasked,
      联系地址: input.addressMasked,
      备注: input.note,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "资料格式不正确" };
  }
  if (!Number.isInteger(input.memberId) || input.memberId <= 0) {
    return { error: "请选择有效的族谱成员" };
  }
  const viewer = await getViewer();
  const supabase = await createClient();
  const { error } = await supabase.from("member_private_profiles").upsert(
    {
      member_id: input.memberId,
      contact_name_masked: input.contactNameMasked,
      phone_masked: input.phoneMasked,
      id_number_masked: input.idNumberMasked,
      address_masked: input.addressMasked,
      note: input.note,
      updated_by: viewer?.userId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/family-tree/settings");
  return { error: null };
}

/** 贡献者名录（视图只暴露脱敏实名与贡献信息）。 */
export async function fetchContributors(): Promise<{
  rows: ContributorRow[];
  error: string | null;
}> {
  const denied = await guard("active");
  if (denied) return { rows: [], error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contributor_directory")
    .select("user_id, real_name, badge_label, badge_tier, contribution_note, contributor_since")
    .order("contributor_since", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return {
    error: null,
    rows: (data ?? []).map((r) => ({
      userId: String(r.user_id),
      realName: String(r.real_name ?? ""),
      badgeLabel: String(r.badge_label ?? ""),
      badgeTier: (r.badge_tier as BadgeTier) ?? "none",
      contributionNote: String(r.contribution_note ?? ""),
      since: r.contributor_since ? String(r.contributor_since) : null,
    })),
  };
}
