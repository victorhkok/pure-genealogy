"use server";

import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { fetchMemberNamesByIds } from "./member-queries";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  importMemberKey,
  normalizeImportMembers,
  resolveImportFathers,
  type ImportFatherCandidate,
  type ImportFatherMatch,
  type ImportMemberInput,
} from "./member-import";

export type { ImportMemberInput } from "./member-import";

export interface FamilyMember {
  id: number;
  name: string;
  generation: number | null;
  sibling_order: number | null;
  father_id: number | null;
  father_name: string | null;
  gender: "男" | "女" | null;
  official_position: string | null;
  is_alive: boolean;
  spouse: string | null;
  remarks: string | null;
  birthday: string | null;
  death_date: string | null;
  residence_place: string | null;
  updated_at: string;
}

export interface FetchMembersResult {
  data: FamilyMember[];
  count: number;
  error: string | null;
}

export async function fetchFamilyMembers(
  page: number = 1,
  pageSize: number = 50,
  searchQuery: string = ""
): Promise<FetchMembersResult> {
  const supabase = await createClient();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("family_members")
    .select("*", { count: "exact" });

  if (searchQuery.trim()) {
    query = query.ilike("name", `%${searchQuery.trim()}%`);
  }

  const { data, count, error } = await query
    .order("generation", { ascending: true })
    .order("sibling_order", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  if (error) {
    return { data: [], count: 0, error: error.message };
  }

  // 获取所有父亲 ID
  const fatherIds = (data || [])
    .map((item) => item.father_id)
    .filter((id): id is number => id !== null);

  const { data: fathers, error: fatherError } = await fetchMemberNamesByIds(supabase, fatherIds);
  if (fatherError) return { data: [], count: 0, error: fatherError };
  const fatherMap: Record<number, string> = Object.fromEntries(fathers.map((father) => [father.id, father.name]));

  // 转换数据格式，添加 father_name
  const transformedData: FamilyMember[] = (data || []).map((item) => ({
    ...item,
    father_name: item.father_id ? fatherMap[item.father_id] || null : null,
  }));

  return { data: transformedData, count: count || 0, error: null };
}

export interface CreateMemberInput {
  name: string;
  generation?: number | null;
  sibling_order?: number | null;
  father_id?: number | null;
  gender?: "男" | "女" | null;
  official_position?: string | null;
  is_alive?: boolean;
  spouse?: string | null;
  remarks?: string | null;
  birthday?: string | null;
  death_date?: string | null;
  residence_place?: string | null;
}

export async function createFamilyMember(
  input: CreateMemberInput
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();

  const { error } = await supabase.from("family_members").insert({
    name: input.name,
    generation: input.generation,
    sibling_order: input.sibling_order,
    father_id: input.father_id,
    gender: input.gender,
    official_position: input.official_position,
    is_alive: input.is_alive ?? true,
    spouse: input.spouse,
    remarks: input.remarks,
    birthday: input.birthday,
    death_date: input.death_date,
    residence_place: input.residence_place,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

export async function deleteFamilyMembers(
  ids: number[]
): Promise<{ success: boolean; error: string | null }> {
  if (ids.length === 0) {
    return { success: false, error: "没有选择要删除的成员" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("family_members")
    .delete()
    .in("id", ids);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

// 获取所有成员用于父亲选择下拉框
export async function fetchAllMembersForSelect(): Promise<{
  data: { id: number; name: string; generation: number | null }[];
  error: string | null;
}> {
  const supabase = await createClient();
  return fetchAllRows<Pick<FamilyMember, "id" | "name" | "generation">>((from, to) =>
    supabase.from("family_members")
      .select("id, name, generation", { count: "exact" })
      .order("generation", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}

export interface UpdateMemberInput extends CreateMemberInput {
  id: number;
}

// 根据 ID 获取单个成员
export async function fetchMemberById(
  id: number
): Promise<FamilyMember | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error fetching member by id:", error);
    return null;
  }

  // 如果有父亲ID，查询父亲姓名
  let father_name: string | null = null;
  if (data.father_id) {
    const { data: father } = await supabase
      .from("family_members")
      .select("name")
      .eq("id", data.father_id)
      .single();
    father_name = father?.name || null;
  }

  return {
    ...data,
    father_name,
  } as FamilyMember;
}

export async function updateFamilyMember(
  input: UpdateMemberInput
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("family_members")
    .update({
      name: input.name,
      generation: input.generation,
      sibling_order: input.sibling_order,
      father_id: input.father_id,
      gender: input.gender,
      official_position: input.official_position,
      is_alive: input.is_alive ?? true,
      spouse: input.spouse,
      remarks: input.remarks,
      birthday: input.birthday,
      death_date: input.death_date,
      residence_place: input.residence_place,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

/** 批量编辑允许的字段白名单；姓名、生平事迹、ID、updated_at 不允许批量修改。 */
const BATCH_EDITABLE_KEYS = [
  "generation",
  "sibling_order",
  "father_id",
  "gender",
  "is_alive",
  "birthday",
  "death_date",
  "residence_place",
  "official_position",
  "spouse",
] as const;

type BatchEditableKey = (typeof BATCH_EDITABLE_KEYS)[number];

const BATCH_FIELD_LABELS: Record<BatchEditableKey, string> = {
  generation: "世代",
  sibling_order: "排行",
  father_id: "父亲",
  gender: "性别",
  is_alive: "在世",
  birthday: "生日",
  death_date: "卒年",
  residence_place: "居住地",
  official_position: "官职",
  spouse: "配偶",
};

export interface BatchUpdateResult {
  success: boolean;
  count: number;
  error: string | null;
}

/**
 * 批量更新成员：只有 changes 中出现的字段会被修改，其余字段保持原值；
 * 值为 null 表示把该字段清空。客户端输入不可信，全部在服务端按白名单与类型重新校验。
 */
export async function batchUpdateFamilyMembers(
  ids: number[],
  changes: Record<string, string | number | boolean | null>
): Promise<BatchUpdateResult> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => Number.isInteger(id) && id > 0))
  );
  const fail = (error: string): BatchUpdateResult => ({
    success: false,
    count: 0,
    error,
  });

  if (uniqueIds.length === 0) return fail("没有选择要修改的成员");
  if (uniqueIds.length > 500) return fail("单次最多修改 500 位成员，请分批处理");
  if (!changes || typeof changes !== "object") return fail("修改内容格式不正确");

  const allowed = new Set<string>(BATCH_EDITABLE_KEYS);
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) return fail(`不支持批量修改字段：${key}`);
  }

  const has = (key: BatchEditableKey) =>
    Object.prototype.hasOwnProperty.call(changes, key);

  const payload: {
    generation?: number | null;
    sibling_order?: number | null;
    father_id?: number | null;
    gender?: "男" | "女" | null;
    is_alive?: boolean;
    birthday?: string | null;
    death_date?: string | null;
    residence_place?: string | null;
    official_position?: string | null;
    spouse?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  const parseOptionalInt = (
    raw: string | number | boolean | null | undefined,
    label: string
  ): { value: number | null } | { error: string } => {
    if (raw === null || raw === undefined || raw === "") return { value: null };
    if (typeof raw === "boolean") return { error: `${label} 必须是整数` };
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return { error: `${label} 必须是不小于 0 的整数` };
    }
    return { value: numeric };
  };

  for (const key of ["generation", "sibling_order"] as const) {
    if (!has(key)) continue;
    const parsed = parseOptionalInt(changes[key], BATCH_FIELD_LABELS[key]);
    if ("error" in parsed) return fail(parsed.error);
    payload[key] = parsed.value;
  }

  if (has("father_id")) {
    const parsed = parseOptionalInt(changes.father_id, "父亲");
    if ("error" in parsed) return fail(parsed.error);
    const fatherId = parsed.value;
    if (fatherId !== null && uniqueIds.includes(fatherId)) {
      return fail("父亲不能是本次勾选的成员，会造成自引用");
    }
    payload.father_id = fatherId;
  }

  if (has("gender")) {
    const raw = changes.gender;
    if (raw === null || raw === "") payload.gender = null;
    else if (raw === "男" || raw === "女") payload.gender = raw;
    else return fail("性别只能是「男」「女」或清空");
  }

  if (has("is_alive")) {
    const raw = changes.is_alive;
    if (typeof raw === "boolean") payload.is_alive = raw;
    else if (raw === "true" || raw === "false") payload.is_alive = raw === "true";
    else return fail("在世状态只能是「是」或「否」");
  }

  for (const key of [
    "birthday",
    "death_date",
    "residence_place",
    "official_position",
    "spouse",
  ] as const) {
    if (!has(key)) continue;
    const raw = changes[key];
    if (raw === null || raw === "") {
      payload[key] = null;
      continue;
    }
    if (typeof raw !== "string") return fail(`${BATCH_FIELD_LABELS[key]} 格式不正确`);
    const value = raw.trim();
    if (value === "") {
      payload[key] = null;
      continue;
    }
    if (
      (key === "birthday" || key === "death_date") &&
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return fail(`${BATCH_FIELD_LABELS[key]} 需要是 YYYY-MM-DD 格式`);
    }
    payload[key] = value;
  }

  const changedKeys = Object.keys(payload).filter((key) => key !== "updated_at");
  if (changedKeys.length === 0) return fail("没有需要修改的字段");

  const supabase = await createClient();

  // 与单条编辑保持一致：只改父亲时，自动把世代设为所选父亲的世代 + 1。
  if (
    changedKeys.includes("father_id") &&
    payload.father_id !== null &&
    !changedKeys.includes("generation")
  ) {
    const { data: father, error: fatherError } = await supabase
      .from("family_members")
      .select("id, generation")
      .eq("id", payload.father_id)
      .maybeSingle();
    if (fatherError) return fail(`查询父亲失败：${fatherError.message}`);
    if (!father) return fail("所选父亲不存在或无权访问");
    if (father.generation !== null) {
      payload.generation = father.generation + 1;
    }
  }

  const { data, error } = await supabase
    .from("family_members")
    .update(payload)
    .in("id", uniqueIds)
    .select("id");

  if (error) return fail(error.message);

  const count = data?.length ?? 0;
  if (count !== uniqueIds.length) {
    return {
      success: false,
      count,
      error: `预计修改 ${uniqueIds.length} 条，实际更新 ${count} 条；请检查权限或记录是否已被删除`,
    };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, count, error: null };
}

async function prepareMemberImport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: ImportMemberInput[]
) {
  const members = normalizeImportMembers(input);
  const fatherNames = Array.from(
    new Set(members.map((member) => member.father_name).filter((name): name is string => !!name))
  );
  const existingMembers: ImportFatherCandidate[] = [];

  // 分批、分页读取，避免 URL 过长或查询行数上限漏掉同名候选人。
  for (let offset = 0; offset < fatherNames.length; offset += 100) {
    for (let from = 0; ;) {
      const { data, count, error } = await supabase
        .from("family_members")
        .select("id, name, generation", { count: "exact" })
        .in("name", fatherNames.slice(offset, offset + 100))
        .order("id", { ascending: true })
        .range(from, from + 199);

      if (error) throw new Error(`查询父亲信息失败：${error.message}`);
      if (count === null || !data || (data.length === 0 && from < count)) {
        throw new Error("未能读取完整的父亲候选信息，请重试");
      }
      existingMembers.push(...(data || []));
      from += data.length;
      if (from >= count) break;
    }
  }

  return { members, fathers: resolveImportFathers(members, existingMembers) };
}

// 上传后即检查父亲关联；真正导入前再次查询，避免使用过期的预览结果。
export async function previewFamilyMembersImport(
  members: ImportMemberInput[]
): Promise<{ fathers: ImportFatherMatch[]; error: string | null }> {
  try {
    const supabase = await createClient();
    const prepared = await prepareMemberImport(supabase, members);
    return { fathers: prepared.fathers, error: null };
  } catch (error) {
    return { fathers: [], error: error instanceof Error ? error.message : "检查父亲关联失败" };
  }
}

export async function batchCreateFamilyMembers(
  input: ImportMemberInput[]
): Promise<{ success: boolean; count: number; error: string | null }> {
  const supabase = await createClient();
  const insertedBatches: number[][] = [];
  let untrackedCount = 0;

  try {
    const { members, fathers } = await prepareMemberImport(supabase, input);
    const generations = new Map<number, number[]>();
    const importedIds = new Map<string, number>();

    members.forEach((member, index) => {
      const generation = member.generation ?? 0;
      const indices = generations.get(generation) || [];
      indices.push(index);
      generations.set(generation, indices);
    });

    // 先插入父辈并读取真实 ID，再写入子女；不依赖模板行顺序或数据库返回顺序。
    for (const generation of Array.from(generations.keys()).sort((a, b) => a - b)) {
      const indices = generations.get(generation)!;
      for (let offset = 0; offset < indices.length; offset += 200) {
        const payload = indices.slice(offset, offset + 200).map((index) => {
          const member = members[index];
          const father = fathers[index];
          let fatherId: number | null = null;
          if (father?.source === "existing") {
            fatherId = father.id;
          } else if (father?.source === "import") {
            const importedFather = members[father.index];
            const id = importedIds.get(importMemberKey(importedFather.name, importedFather.generation));
            if (id === undefined) throw new Error(`未取得「${member.father_name}」的父亲 ID，导入已停止`);
            fatherId = id;
          }

          return {
            name: member.name,
            generation: member.generation,
            sibling_order: member.sibling_order,
            father_id: fatherId,
            gender: member.gender,
            official_position: member.official_position,
            is_alive: member.is_alive ?? true,
            spouse: member.spouse,
            remarks: member.remarks,
            birthday: member.birthday,
            residence_place: member.residence_place,
          };
        });

        const { data, error } = await supabase
          .from("family_members")
          .insert(payload)
          .select("id, name, generation");

        if (error) throw new Error(error.message);
        insertedBatches.push((data || []).map((member) => member.id));
        if (!data || data.length !== payload.length) {
          untrackedCount += Math.max(0, payload.length - (data?.length ?? 0));
          throw new Error("未能取得全部新成员 ID，请检查数据库返回条数限制");
        }
        for (const member of data) {
          importedIds.set(importMemberKey(member.name, member.generation), member.id);
        }
      }
    }

    revalidatePath("/family-tree", "layout");
    return { success: true, count: members.length, error: null };
  } catch (error) {
    // 多代导入发生错误时，按子女到父辈的顺序清理本次新增数据。
    let remainingCount = untrackedCount;
    for (const ids of insertedBatches.reverse()) {
      if (ids.length === 0) continue;
      try {
        const { data, count, error: rollbackError } = await supabase
          .from("family_members")
          .delete({ count: "exact" })
          .in("id", ids)
          .select("id");
        remainingCount += rollbackError ? ids.length : Math.max(0, ids.length - (count ?? data?.length ?? 0));
      } catch {
        remainingCount += ids.length;
      }
    }
    if (insertedBatches.length > 0) revalidatePath("/family-tree", "layout");
    const message = error instanceof Error ? error.message : "导入失败，请稍后重试";
    return {
      success: false,
      count: remainingCount,
      error: remainingCount > 0 ? `${message}；仍有 ${remainingCount} 条本次新增记录未能撤销，请核对后再导入` : message,
    };
  }
}

export async function fetchMembersForTimeline(): Promise<{
  data: { id: number; name: string; birthday: string | null; death_date: string | null; generation: number | null }[];
  error: string | null;
}> {
  const supabase = await createClient();
  return fetchAllRows<Pick<FamilyMember, "id" | "name" | "birthday" | "death_date" | "generation">>((from, to) =>
    supabase.from("family_members")
      .select("id, name, birthday, death_date, generation", { count: "exact" })
      .order("birthday", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}
