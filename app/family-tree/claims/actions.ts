"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer, guard } from "@/lib/permissions";

export interface MyClaimRow {
  id: number;
  member_id: number;
  member_name: string;
  real_name: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface MemberOption {
  id: number;
  name: string;
  generation: number | null;
}

export async function searchMembersForClaim(
  keyword: string,
): Promise<{ members: MemberOption[]; error: string | null }> {
  const denied = await guard("active");
  if (denied) return { members: [], error: denied };
  const q = keyword.trim();
  if (!q) return { members: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_members")
    .select("id, name, generation")
    .ilike("name", `%${q}%`)
    .order("id", { ascending: true })
    .limit(20);
  if (error) return { members: [], error: error.message };
  return {
    members: (data ?? []).map((m) => ({
      id: Number(m.id),
      name: String(m.name),
      generation: m.generation === null ? null : Number(m.generation),
    })),
    error: null,
  };
}

export async function submitMemberClaim(input: {
  memberId: number;
  realName: string;
  note: string;
}): Promise<{ error: string | null }> {
  const denied = await guard("active");
  if (denied) return { error: denied };
  const viewer = await getViewer();
  if (!viewer) return { error: "会话已失效，请重新登录" };
  if (viewer.role !== "member") {
    return { error: "管理员与编辑者本身已有编辑权限，无需认领成员。" };
  }

  const realName = input.realName.trim();
  if (!realName) return { error: "请填写真实姓名" };
  const memberId = Number(input.memberId);
  if (!Number.isInteger(memberId) || memberId <= 0) return { error: "请选择要认领的成员" };

  const supabase = await createClient();
  const { data: existing, error: existError } = await supabase
    .from("member_claims")
    .select("id, status")
    .eq("user_id", viewer.userId)
    .in("status", ["pending", "approved"]);
  if (existError) return { error: existError.message };
  if (existing && existing.length > 0) {
    return { error: "你已有待审核或生效中的认领，请先撤回或联系管理员处理。" };
  }

  const { error } = await supabase.from("member_claims").insert({
    user_id: viewer.userId,
    member_id: memberId,
    real_name: realName,
    note: input.note.trim() || null,
    status: "pending",
  });
  if (error) {
    if (String(error.code) === "23505") {
      return { error: "该成员已被其他用户认领，请核对后选择本人记录。" };
    }
    return { error: error.message };
  }

  revalidatePath("/family-tree/my-claims");
  revalidatePath("/family-tree/admin");
  return { error: null };
}

export async function fetchMyClaims(): Promise<{
  claims: MyClaimRow[];
  error: string | null;
}> {
  const denied = await guard("active");
  if (denied) return { claims: [], error: denied };
  const viewer = await getViewer();
  if (!viewer) return { claims: [], error: "会话已失效，请重新登录" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_claims")
    .select("*")
    .eq("user_id", viewer.userId)
    .order("created_at", { ascending: false });
  if (error) return { claims: [], error: error.message };

  const ids = Array.from(new Set((data ?? []).map((c) => Number(c.member_id))));
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: members } = await supabase
      .from("family_members")
      .select("id, name")
      .in("id", ids);
    (members ?? []).forEach((m) => nameById.set(Number(m.id), String(m.name)));
  }

  return {
    claims: (data ?? []).map((c) => ({
      id: Number(c.id),
      member_id: Number(c.member_id),
      member_name: nameById.get(Number(c.member_id)) ?? `ID ${c.member_id}`,
      real_name: String(c.real_name ?? ""),
      note: c.note ?? null,
      status: c.status as MyClaimRow["status"],
      created_at: String(c.created_at ?? ""),
    })),
    error: null,
  };
}

export async function withdrawMemberClaim(claimId: number): Promise<{ error: string | null }> {
  const denied = await guard("active");
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_claims")
    .delete()
    .eq("id", claimId)
    .eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/family-tree/my-claims");
  revalidatePath("/family-tree/admin");
  return { error: null };
}
