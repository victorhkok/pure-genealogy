"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildMaskedIdentity,
  maskFreeText,
  maskPersonName,
} from "@/lib/masking";
import { savePrivateRecord, type PrivateRecordRow } from "./actions";

const inputCls =
  "w-full rounded-md border px-3 py-2 text-sm bg-background text-foreground";

export function PrivateRecordsForm({
  rows,
  canView,
  isAdmin,
  verification,
  hasClaim,
  members,
}: {
  rows: PrivateRecordRow[];
  canView: boolean;
  isAdmin: boolean;
  verification: string;
  hasClaim: boolean;
  members: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [memberId, setMemberId] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");

  const preview = useMemo(
    () => buildMaskedIdentity({ realName: contactName, phone, idNumber, address }),
    [contactName, phone, idNumber, address],
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(memberId);
    if (!Number.isInteger(id) || id <= 0) {
      setMessage({ text: "请选择要维护的族谱成员", ok: false });
      return;
    }
    setBusy(true);
    try {
      const { error } = await savePrivateRecord({
        memberId: id,
        contactNameMasked: preview.realNameMasked,
        phoneMasked: preview.phoneMasked,
        idNumberMasked: preview.idNumberMasked,
        addressMasked: preview.addressMasked,
        note: maskFreeText(note),
      });
      setMessage(error ? { text: error, ok: false } : { text: "已保存（仅星号串入库）。", ok: true });
      if (!error) {
        setContactName("");
        setPhone("");
        setIdNumber("");
        setAddress("");
        setNote("");
        router.refresh();
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">族谱联系资料</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          这里只展示脱敏后的联系方式。可见范围由数据库行级策略控制：
          <b>已实名</b>且<b>已认领本人记录</b>的用户，只能看到自己这一分支 —— 直系祖先（父亲、祖父…）与全部后代。
        </p>
      </div>

      {!canView ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-medium">当前暂无查看权限</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>实名状态：{verification === "verified" ? "已实名" : "未通过实名核对"}</li>
            <li>成员认领：{hasClaim ? "已获批" : "尚未认领本人记录或未被批准"}</li>
          </ul>
          <p className="mt-2 text-xs">
            请先在「我的实名资料」提交登记、由管理员核对，并在「我的认领」获批后刷新本页。
          </p>
        </div>
      ) : (
        <section className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-medium">我这一分支内可见的资料（{rows.length}）</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无记录。管理员可在下方为族谱成员录入脱敏联系资料。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">成员</th>
                    <th className="py-2 pr-3">联系人</th>
                    <th className="py-2 pr-3">手机号</th>
                    <th className="py-2 pr-3">证件号</th>
                    <th className="py-2 pr-3">联系地址</th>
                    <th className="py-2 pr-3">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.memberId} className="border-b align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.memberName} <span className="text-muted-foreground">#{r.memberId}</span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{r.contactNameMasked || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{r.phoneMasked || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{r.idNumberMasked || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{r.addressMasked || "—"}</td>
                      <td className="py-2 pr-3 max-w-[200px] break-words">{r.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin ? (
        <form onSubmit={onSave} className="space-y-4 rounded-lg border p-4">
          <h3 className="text-sm font-medium">管理员：录入 / 更新成员联系资料</h3>
          <p className="text-xs text-muted-foreground">
            明文同样只在浏览器里打星后提交；族谱成员姓名保持明文，其余一律星号串。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block">族谱成员</span>
              <select className={inputCls} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">请选择成员</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}（#{m.id}）
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">联系人姓名</span>
              <input className={inputCls} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="真实姓名" />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">→ {preview.realNameMasked || maskPersonName(contactName) || "—"}</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">手机号</span>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" inputMode="numeric" />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">→ {preview.phoneMasked || "—"}</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">证件号</span>
              <input className={inputCls} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="18 位身份证号" />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">→ {preview.idNumberMasked || "—"}</span>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block">联系地址</span>
              <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="详细住址" />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">→ {preview.addressMasked || "—"}</span>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block">备注（选填）</span>
              <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="任何号码都会被自动打星" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存脱敏资料"}
            </button>
            {message ? (
              <span className={"text-sm " + (message.ok ? "text-green-600" : "text-red-600")}>{message.text}</span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
