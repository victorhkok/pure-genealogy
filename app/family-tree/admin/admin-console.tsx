"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBeijingTime } from "@/lib/format-date";
import {
  ROLE_LABELS,
  STATUS_LABELS,
  type UserRole,
  type UserStatus,
} from "@/lib/access-types";
import {
  createManagedUser,
  setUserRole,
  setUserStatus,
  resetUserPassword,
  reviewMemberClaim,
  revokeMemberClaim,
  type ProfileRow,
  type ClaimRow,
} from "./actions";

interface Props {
  initialProfiles: ProfileRow[];
  initialClaims: ClaimRow[];
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

export function AdminConsole({ initialProfiles, initialClaims, initialError }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    initialError ? { text: initialError, ok: false } : null,
  );
  const [busy, setBusy] = useState(false);

  // 新建用户表单
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [realName, setRealName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");

  // 行内改密
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

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
      const { error } = await createManagedUser({ email, password, realName, role: newRole });
      report(error, `账号 ${email} 已创建并启用。`);
      if (!error) {
        setEmail("");
        setPassword("");
        setRealName("");
        setNewRole("member");
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
          角色说明：管理员可增删改成员、批量操作、管理用户与审批认领；编辑者可编辑任意成员但不能新增删除；
          普通用户只能认领自己的那条记录，审批通过后方可编辑。
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

      {/* 新建用户 */}
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
          <label className="block text-sm">
            <span className="block mb-1">角色</span>
            <select
              className={inputCls}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
            >
              <option value="member">普通用户</option>
              <option value="editor">编辑者</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button type="submit" className={primaryCls} disabled={busy}>
            {busy ? "处理中…" : "创建用户"}
          </button>
        </form>
      </section>

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
                <th className="py-2 pr-3">角色</th>
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
                  <td className="py-2 pr-3">
                    <select
                      className="rounded border px-2 py-1 text-xs bg-background"
                      value={p.role}
                      disabled={busy}
                      onChange={(e) =>
                        run(
                          () => setUserRole(p.user_id, e.target.value as UserRole),
                          `已将 ${p.email} 设为${ROLE_LABELS[e.target.value as UserRole]}。`,
                        )
                      }
                    >
                      <option value="member">普通用户</option>
                      <option value="editor">编辑者</option>
                      <option value="admin">管理员</option>
                    </select>
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
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    暂无用户
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
