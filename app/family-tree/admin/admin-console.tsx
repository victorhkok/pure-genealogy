"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBeijingTime } from "@/lib/format-date";
import {
  ROLE_LABELS,
  STATUS_LABELS,
  BADGE_TIER_LABELS,
  VERIFICATION_LABELS,
  type UserRole,
  type UserStatus,
  type BadgeTier,
} from "@/lib/access-types";
import {
  createManagedUser,
  setUserRole,
  setUserStatus,
  setUserBranchScope,
  resetUserPassword,
  reviewMemberClaim,
  revokeMemberClaim,
  setContributorBadge,
  reviewVerification,
  type ProfileRow,
  type ClaimRow,
  type VerificationReviewRow,
  type MemberOption,
} from "./actions";

const ROLE_OPTIONS: UserRole[] = ["member", "editor", "branch_admin", "admin"];

interface Props {
  initialProfiles: ProfileRow[];
  initialClaims: ClaimRow[];
  initialVerifications: VerificationReviewRow[];
  initialMembers: MemberOption[];
  initialIsBranchAdminView: boolean;
  initialError: string | null;
}

const inputCls =
  "w-full rounded-md border px-3 py-2 text-sm bg-background text-foreground";
const btnCls =
  "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const primaryCls =
  "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

function fmt(ts: string): string {
  return formatBeijingTime(ts);
}

export function AdminConsole({
  initialProfiles,
  initialClaims,
  initialVerifications,
  initialMembers,
  initialIsBranchAdminView,
  initialError,
}: Props) {
  const router = useRouter();
  const isBranchAdminView = initialIsBranchAdminView;
  const memberName = (id: number | null | undefined) =>
    id == null ? "" : (initialMembers.find((m) => m.id === id)?.name ?? `#${id}`);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    initialError ? { text: initialError, ok: false } : null,
  );
  const [busy, setBusy] = useState(false);

  // 新建用户表单
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [realName, setRealName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");
  const [branchScope, setBranchScope] = useState<number | null>(null);

  // 行内改密
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // 贡献者认证（大 V 式徽章 + 贡献备注）
  const [badgeTarget, setBadgeTarget] = useState<string | null>(null);
  const [badgeOn, setBadgeOn] = useState(false);
  const [badgeLabel, setBadgeLabel] = useState("");
  const [badgeTier, setBadgeTier] = useState<BadgeTier>("gold");
  const [badgeNote, setBadgeNote] = useState("");
  const [verifyNote, setVerifyNote] = useState("");

  function openBadge(p: ProfileRow) {
    setBadgeTarget(badgeTarget === p.user_id ? null : p.user_id);
    setBadgeOn(Boolean(p.is_contributor));
    setBadgeLabel(p.badge_label ?? "");
    setBadgeTier(p.badge_tier ?? "none");
    setBadgeNote(p.contribution_note ?? "");
  }

  async function saveBadge(userId: string) {
    await run(
      () =>
        setContributorBadge(userId, {
          isContributor: badgeOn,
          badgeLabel,
          badgeTier: badgeOn ? badgeTier : "none",
          contributionNote: badgeNote,
        }),
      "贡献者认证已更新。",
    );
    setBadgeTarget(null);
  }

  function report(error: string | null, okText: string) {
    setMessage(error ? { text: error, ok: false } : { text: okText, ok: true });
  }

  async function run(fn: () => Promise<{ error: string | null }>, okText: string) {
    setBusy(true);
    try {
      const { error } = await fn();
      report(error, okText);
      if (!error) router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : String(e), "");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await createManagedUser({
        email,
        password,
        realName,
        role: newRole,
        branchScope: newRole === "branch_admin" ? branchScope : null,
      });
      report(error, `账号 ${email} 已创建并启用。`);
      if (!error) {
        setEmail("");
        setPassword("");
        setRealName("");
        setNewRole("member");
        setBranchScope(null);
        router.refresh();
      }
    } catch (err) {
      report(err instanceof Error ? err.message : String(err), "");
    } finally {
      setBusy(false);
    }
  }

  const roleBadge = (r: UserRole) => (
    <span className="inline-block rounded px-2 py-0.5 text-xs border">
      {ROLE_LABELS[r] ?? r}
    </span>
  );
  const statusBadge = (s: UserStatus) => (
    <span
      className={
        "inline-block rounded px-2 py-0.5 text-xs border " +
        (s === "active"
          ? "border-green-500 text-green-600"
          : s === "pending"
            ? "border-amber-500 text-amber-600"
            : "border-muted-foreground text-muted-foreground")
      }
    >
      {STATUS_LABELS[s] ?? s}
    </span>
  );

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">用户与权限管理</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          角色说明（两级管理）：<b>总管理员</b>全权，可建号、改角色、划定房支范围、核对实名；
          <b>房支管理员</b>仅管辖所选「房祖」向下的整条房支子树（含全部后代），可在本支内增删改成员、启用/停用本支用户、审批本支认领，
          但不能改他人角色、不能改房支范围、不能重置密码、不能做实名核对；
          <b>认证贡献者</b>可编辑任意成员但不能增删，并可授予徽章与贡献备注（如理事会职务、捐资纪录），在贡献者名录公开展示；
          <b>普通用户</b>只能认领自己的那条记录，审批通过后方可编辑。
          实名资料一律以星号串保存，管理员线下核对证件后标记「已实名」。
        </p>
      </div>

      {isBranchAdminView ? (
        <div className="rounded-md border border-blue-500 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          你当前以「房支管理员」身份查看，仅显示你管辖房支内的用户、认领与实名记录；建号、改角色、划房支、重置密码、实名核对等操作仅总管理员可用。
        </div>
      ) : null}

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

      {/* 新建用户（仅总管理员可建号） */}
      {!isBranchAdminView ? (
        <section className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold mb-4">新增用户（建号即启用）</h2>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
            <label className="block text-sm">
              <span className="block mb-1">邮箱</span>
              <input
                className={inputCls}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">初始密码</span>
              <input
                className={inputCls}
                type="text"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">真实姓名</span>
              <input
                className={inputCls}
                required
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                placeholder="身份证姓名"
              />
            </label>
            <div className="block text-sm">
              <span className="block mb-1">角色</span>
              <select
                className={inputCls}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {newRole === "branch_admin" ? (
                <div className="mt-2">
                  <span className="block mb-1 text-xs">管辖房祖</span>
                  <select
                    className={inputCls + " text-xs"}
                    value={branchScope ?? ""}
                    required
                    onChange={(e) => setBranchScope(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">请选择房祖</option>
                    {initialMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} #{m.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <button type="submit" className={primaryCls} disabled={busy}>
              {busy ? "处理中…" : "创建用户"}
            </button>
          </form>
        </section>
      ) : null}

      {/* 用户列表 */}
      <section className="rounded-lg border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">用户列表（{initialProfiles.length}）</h2>
          <button className={btnCls} onClick={() => router.refresh()} disabled={busy}>
            刷新
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">邮箱</th>
                <th className="py-2 pr-3">实名</th>
                <th className="py-2 pr-3">认证徽章</th>
                <th className="py-2 pr-3">角色</th>
                <th className="py-2 pr-3">管辖房祖</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">注册时间</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {initialProfiles.map((p) => (
                <tr key={p.user_id} className="border-b align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{p.email}</td>
                  <td className="py-2 pr-3">{p.real_name || <span className="text-muted-foreground">未填</span>}</td>
                  <td className="py-2 pr-3 min-w-[210px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.is_contributor ? (
                        <span
                          className={
                            "inline-block rounded border px-2 py-0.5 text-xs font-medium " +
                            (p.badge_tier === "gold"
                              ? "border-amber-500 bg-amber-50 text-amber-700"
                              : p.badge_tier === "silver"
                                ? "border-slate-400 bg-slate-50 text-slate-600"
                                : "border-orange-400 bg-orange-50 text-orange-700")
                          }
                        >
                          ★ {p.badge_label || "认证贡献者"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      <button className={btnCls} disabled={busy} onClick={() => openBadge(p)}>
                        认证
                      </button>
                    </div>
                    {p.contribution_note ? (
                      <p className="mt-1 max-w-[210px] truncate text-xs text-muted-foreground" title={p.contribution_note}>
                        {p.contribution_note}
                      </p>
                    ) : null}
                    {badgeTarget === p.user_id ? (
                      <div className="mt-2 space-y-1.5 rounded border bg-muted/30 p-2">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={badgeOn}
                            onChange={(e) => setBadgeOn(e.target.checked)}
                          />
                          授予贡献者认证
                        </label>
                        <input
                          className={inputCls + " text-xs"}
                          value={badgeLabel}
                          onChange={(e) => setBadgeLabel(e.target.value)}
                          placeholder="徽章文字，如：理事会 / 捐资"
                          maxLength={30}
                        />
                        <select
                          className={inputCls + " text-xs"}
                          value={badgeTier}
                          onChange={(e) => setBadgeTier(e.target.value as BadgeTier)}
                        >
                          {(["gold", "silver", "bronze"] as BadgeTier[]).map((t) => (
                            <option key={t} value={t}>
                              {BADGE_TIER_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <textarea
                          className={inputCls + " text-xs"}
                          rows={2}
                          value={badgeNote}
                          onChange={(e) => setBadgeNote(e.target.value)}
                          placeholder="贡献备注：如「十二公宗亲理事会 副会长」「2018 年捐资一万元」"
                          maxLength={300}
                        />
                        <div className="flex gap-1.5">
                          <button className={primaryCls} disabled={busy} onClick={() => saveBadge(p.user_id)}>
                            保存
                          </button>
                          <button className={btnCls} onClick={() => setBadgeTarget(null)}>
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="rounded border px-2 py-1 text-xs bg-background"
                      value={p.role}
                      disabled={busy || isBranchAdminView}
                      onChange={(e) =>
                        run(
                          () => setUserRole(p.user_id, e.target.value as UserRole),
                          `已将 ${p.email} 设为${ROLE_LABELS[e.target.value as UserRole]}。`,
                        )
                      }
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3 min-w-[160px]">
                    {p.role === "branch_admin" ? (
                      isBranchAdminView ? (
                        <span className="text-xs">
                          {memberName(p.branch_scope) || "未设置"}
                        </span>
                      ) : (
                        <select
                          className="rounded border px-2 py-1 text-xs bg-background"
                          value={p.branch_scope ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            run(
                              () =>
                                setUserBranchScope(
                                  p.user_id,
                                  e.target.value ? Number(e.target.value) : null,
                                ),
                              `已更新 ${p.email} 的管辖房祖。`,
                            )
                          }
                        >
                          <option value="">未设置</option>
                          {initialMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} #{m.id}
                            </option>
                          ))}
                        </select>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{statusBadge(p.status)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{fmt(p.created_at)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.status !== "active" ? (
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() => run(() => setUserStatus(p.user_id, "active"), `已启用 ${p.email}。`)}
                        >
                          启用
                        </button>
                      ) : (
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() => run(() => setUserStatus(p.user_id, "disabled"), `已停用 ${p.email}。`)}
                        >
                          停用
                        </button>
                      )}
                      {!isBranchAdminView ? (
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() => {
                            setResetTarget(resetTarget === p.user_id ? null : p.user_id);
                            setNewPassword("");
                          }}
                        >
                          改密
                        </button>
                      ) : null}
                    </div>
                    {resetTarget === p.user_id ? (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          className="rounded border px-2 py-1 text-xs w-32"
                          type="text"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="新密码 ≥6 位"
                        />
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => resetUserPassword(p.user_id, newPassword),
                              `已重置 ${p.email} 的密码。`,
                            ).then(() => setResetTarget(null))
                          }
                        >
                          保存
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {initialProfiles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted-foreground">
                    暂无用户
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* 离线实名核对 */}
      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">
          实名资料核对（{initialVerifications.length}）
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          系统只保存星号串，看不到完整姓名 / 手机号 / 证件号。请线下面对面核对证件后，再在此标记「已实名」；
          用户换手机号重新提交会自动打回待核对（版本号递增）。
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className={inputCls + " max-w-xs"}
            value={verifyNote}
            onChange={(e) => setVerifyNote(e.target.value)}
            placeholder="核对备注（可选，如核对日期 / 凭证尾号）"
            maxLength={120}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">账号</th>
                <th className="py-2 pr-3">姓名</th>
                <th className="py-2 pr-3">手机号</th>
                <th className="py-2 pr-3">证件号</th>
                <th className="py-2 pr-3">联系地址</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">版本</th>
                <th className="py-2 pr-3">提交时间</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {initialVerifications.map((v) => (
                <tr key={v.user_id} className="border-b align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{v.email}</td>
                  <td className="py-2 pr-3">{v.real_name_masked}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{v.phone_masked}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{v.id_number_masked || "-"}</td>
                  <td className="py-2 pr-3 max-w-[180px] truncate" title={v.address_masked}>
                    {v.address_masked || "-"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        "inline-block rounded border px-2 py-0.5 text-xs " +
                        (v.status === "verified"
                          ? "border-green-500 text-green-600"
                          : v.status === "pending"
                            ? "border-amber-500 text-amber-600"
                            : "border-muted-foreground text-muted-foreground")
                      }
                    >
                      {VERIFICATION_LABELS[v.status] ?? v.status}
                    </span>
                    {v.review_note ? (
                      <p className="mt-1 max-w-[160px] truncate text-xs text-muted-foreground" title={v.review_note}>
                        {v.review_note}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">v{v.revision}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{fmt(v.submitted_at)}</td>
                  <td className="py-2 pr-3">
                    {!isBranchAdminView ? (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className={primaryCls}
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => reviewVerification(v.user_id, true, verifyNote),
                              `已标记 ${v.email} 为已实名。`,
                            ).then(() => setVerifyNote(""))
                          }
                        >
                          核对通过
                        </button>
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => reviewVerification(v.user_id, false, verifyNote),
                              `已驳回 ${v.email} 的实名申请。`,
                            ).then(() => setVerifyNote(""))
                          }
                        >
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">仅总管理员可核对</span>
                    )}
                  </td>
                </tr>
              ))}
              {initialVerifications.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted-foreground">
                    暂无实名登记
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* 认领审批 */}
      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">成员认领审批（{initialClaims.length}）</h2>
        <p className="text-xs text-muted-foreground mb-4">
          一名用户最多认领一条记录，一条成员记录也只能被一人认领；批准后才获得该记录的编辑权。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">申请人</th>
                <th className="py-2 pr-3">实名</th>
                <th className="py-2 pr-3">认领成员</th>
                <th className="py-2 pr-3">说明</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">提交时间</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {initialClaims.map((c) => (
                <tr key={c.id} className="border-b align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{c.applicant_email}</td>
                  <td className="py-2 pr-3">{c.real_name}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {c.member_name} <span className="text-muted-foreground">#{c.member_id}</span>
                  </td>
                  <td className="py-2 pr-3 max-w-[220px]">{c.note || "-"}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        "inline-block rounded border px-2 py-0.5 text-xs " +
                        (c.status === "approved"
                          ? "border-green-500 text-green-600"
                          : c.status === "pending"
                            ? "border-amber-500 text-amber-600"
                            : "border-muted-foreground text-muted-foreground")
                      }
                    >
                      {c.status === "approved" ? "已批准" : c.status === "pending" ? "待审批" : "已驳回"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{fmt(c.created_at)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {c.status === "pending" ? (
                        <>
                          <button
                            className={primaryCls}
                            disabled={busy}
                            onClick={() =>
                              run(() => reviewMemberClaim(c.id, true), `已批准 ${c.real_name} 的认领。`)
                            }
                          >
                            批准
                          </button>
                          <button
                            className={btnCls}
                            disabled={busy}
                            onClick={() =>
                              run(() => reviewMemberClaim(c.id, false), `已驳回 ${c.real_name} 的认领。`)
                            }
                          >
                            驳回
                          </button>
                        </>
                      ) : null}
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() =>
                          run(() => revokeMemberClaim(c.id), "已撤销该认领。")
                        }
                      >
                        撤销
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {initialClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    暂无认领申请
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
