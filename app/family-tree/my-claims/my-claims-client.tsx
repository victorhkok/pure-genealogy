"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBeijingTime } from "@/lib/format-date";
import { ROLE_LABELS, type UserRole } from "@/lib/access-types";
import {
  submitMemberClaim,
  withdrawMemberClaim,
  searchMembersForClaim,
  type MyClaimRow,
  type MemberOption,
} from "../claims/actions";

interface Props {
  realName: string;
  role: UserRole;
  approvedClaimIds: number[];
  initialClaims: MyClaimRow[];
  preset: MemberOption | null;
}

const inputCls =
  "w-full rounded-md border px-3 py-2 text-sm bg-background text-foreground";
const btnCls =
  "rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const primaryCls =
  "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

export function MyClaimsClient({
  realName,
  role,
  approvedClaimIds,
  initialClaims,
  preset,
}: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(preset?.name ?? "");
  const [options, setOptions] = useState<MemberOption[]>(preset ? [preset] : []);
  const [selected, setSelected] = useState<MemberOption | null>(preset);
  const [claimRealName, setClaimRealName] = useState(realName);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const hasApproved = approvedClaimIds.length > 0;
  const hasOpen = initialClaims.some((c) => c.status === "pending" || c.status === "approved");

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { members, error } = await searchMembersForClaim(keyword);
      if (error) {
        setMessage({ text: error, ok: false });
      } else {
        setOptions(members);
        setMessage(
          members.length === 0
            ? { text: "没有找到同名成员，请换一个关键词。", ok: false }
            : null,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setMessage({ text: "请先在搜索结果中选择要认领的成员。", ok: false });
      return;
    }
    setBusy(true);
    try {
      const { error } = await submitMemberClaim({
        memberId: selected.id,
        realName: claimRealName,
        note,
      });
      setMessage(error ? { text: error, ok: false } : { text: "认领申请已提交，等待管理员审核。", ok: true });
      if (!error) {
        setNote("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw(id: number) {
    setBusy(true);
    try {
      const { error } = await withdrawMemberClaim(id);
      setMessage(error ? { text: error, ok: false } : { text: "已撤回申请。", ok: true });
      if (!error) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">我的认领</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          当前身份：{realName || "未填写实名"}（{ROLE_LABELS[role]}）。
          普通用户只能认领一条属于自己的族谱记录；管理员审核通过后，才可以在成员列表中编辑这一条。
        </p>
      </div>

      {message ? (
        <div
          className={
            "rounded-md border px-4 py-3 text-sm " +
            (message.ok
              ? "border-green-500 bg-green-50 text-green-700"
              : "border-red-500 bg-red-50 text-red-700")
          }
        >
          {message.text}
        </div>
      ) : null}

      {hasApproved ? (
        <div className="rounded-md border border-green-500 bg-green-50 px-4 py-3 text-sm text-green-700">
          你的认领已生效（成员 #{approvedClaimIds[0]}）。现在可以
          <Link href="/family-tree" className="mx-1 underline font-medium">
            回到成员列表
          </Link>
          编辑这条记录；其他记录仍为只读。
        </div>
      ) : null}

      {role !== "member" ? (
        <div className="rounded-md border px-4 py-3 text-sm">
          你是{ROLE_LABELS[role]}，本身已有编辑权限，无需认领成员。
        </div>
      ) : (
        <section className="rounded-lg border p-5 space-y-4">
          <h2 className="text-lg font-semibold">提交认领申请</h2>
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              className={inputCls}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入姓名搜索族谱成员"
            />
            <button type="submit" className={btnCls} disabled={busy}>
              搜索
            </button>
          </form>

          {options.length > 0 ? (
            <div className="rounded-md border divide-y">
              {options.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelected(m)}
                  className={
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted " +
                    (selected?.id === m.id ? "bg-primary/10 font-medium" : "")
                  }
                >
                  {m.name}
                  <span className="ml-2 text-muted-foreground">
                    #{m.id}{m.generation ? ` · 第 ${m.generation} 世` : ""}
                  </span>
                  {selected?.id === m.id ? <span className="float-right">已选</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="block mb-1">目标成员</span>
              <input
                className={inputCls + " bg-muted"}
                readOnly
                value={selected ? `${selected.name}（#${selected.id}）` : "尚未选择"}
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">真实姓名</span>
              <input
                className={inputCls}
                required
                value={claimRealName}
                onChange={(e) => setClaimRealName(e.target.value)}
                placeholder="与族谱记录对应的本人姓名"
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">说明（选填）</span>
              <input
                className={inputCls}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：父亲为 XXX，便于管理员核对"
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={primaryCls} disabled={busy || hasOpen || !selected}>
                {hasOpen ? "已有待审核或生效中的认领" : "提交认领申请"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-4">我的申请记录</h2>
        {initialClaims.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有提交过认领申请。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">成员</th>
                  <th className="py-2 pr-3">实名</th>
                  <th className="py-2 pr-3">说明</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">提交时间</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {initialClaims.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 pr-3">
                      {c.member_name} <span className="text-muted-foreground">#{c.member_id}</span>
                    </td>
                    <td className="py-2 pr-3">{c.real_name}</td>
                    <td className="py-2 pr-3">{c.note || "-"}</td>
                    <td className="py-2 pr-3">
                      {c.status === "approved" ? "已批准" : c.status === "pending" ? "待审批" : "已驳回"}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {formatBeijingTime(c.created_at)}
                    </td>
                    <td className="py-2 pr-3">
                      {c.status === "pending" ? (
                        <button className={btnCls} disabled={busy} onClick={() => onWithdraw(c.id)}>
                          撤回
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Link href="/family-tree" className="inline-block text-sm underline">
        ← 返回成员列表
      </Link>
    </div>
  );
}
