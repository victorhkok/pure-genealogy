"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildMaskedIdentity,
  maskFreeText,
} from "@/lib/masking";
import { submitVerification, type VerificationRow } from "./actions";
import { VERIFICATION_LABELS } from "@/lib/access-types";
import { formatBeijingTime } from "@/lib/format-date";

const inputCls =
  "w-full rounded-md border px-3 py-2 text-sm bg-background text-foreground";
const labelCls = "block text-sm font-medium mb-1";

export function VerificationForm({
  initial,
  status,
}: {
  initial: VerificationRow | null;
  status: string;
}) {
  const router = useRouter();
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const preview = useMemo(
    () =>
      buildMaskedIdentity({
        realName,
        phone,
        idNumber,
        address,
      }),
    [realName, phone, idNumber, address],
  );

  const formValid =
    realName.trim().length > 0 &&
    /^1[3-9]\d{9}$/.test(phone.replace(/[\s-]/g, "")) &&
    (idNumber.trim() === "" || /^\d{17}[\dXx]$/.test(idNumber.replace(/[\s-]/g, "")));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) {
      setMessage({ text: "请填写姓名与 11 位手机号；证件号如填写需为 18 位。", ok: false });
      return;
    }
    if (initial && !confirmed) {
      setMessage({
        text: "这是重新登记（含换手机号）：提交后实名状态会打回「待核对」，需管理员重新核对。请再点一次「确认提交」。",
        ok: false,
      });
      setConfirmed(true);
      return;
    }
    setBusy(true);
    try {
      // 明文只参与浏览器内的打星计算，不会作为请求参数发出。
      const { error } = await submitVerification(preview);
      setMessage(
        error
          ? { text: error, ok: false }
          : { text: "已提交。资料以星号串保存，等待管理员线下核对。", ok: true },
      );
      setConfirmed(false);
      if (!error) {
        setRealName("");
        setPhone("");
        setIdNumber("");
        setAddress("");
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
        <h2 className="text-lg font-semibold">我的实名资料</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          当前状态：
          <span className="font-medium">{VERIFICATION_LABELS[status as keyof typeof VERIFICATION_LABELS] ?? status}</span>
          {initial ? ` · 第 ${initial.revision} 版 · 提交于 ${formatBeijingTime(initial.submittedAt)}` : ""}
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">隐私与边界说明</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">
          <li>明文姓名、手机号、证件号、住址<b>只在你的浏览器输入框里出现</b>；提交前立即打星，网络与数据库里只有星号串，系统无法还原。</li>
          <li>这是<b>离线实名登记</b>，不是法定实名认证：本机无短信网关与三方核验接口，无法发验证码、也无法核验证件真伪，由管理员线下面对面核对后标记。</li>
          <li>更换手机号：重新填写并提交即可，状态自动打回待核对，管理员重新核对后恢复。</li>
          <li>只有「已实名」且已认领本人记录的用户，才能查看<b>自己分支内</b>（直系祖先 + 全部后代）的脱敏联系资料。</li>
        </ul>
      </div>

      {initial ? (
        <section className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-medium">系统里已保存的资料（星号串）</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["姓名", initial.realNameMasked],
              ["手机号", initial.phoneMasked],
              ["证件号", initial.idNumberMasked || "—"],
              ["联系地址", initial.addressMasked || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {initial.reviewNote ? (
            <p className="mt-3 text-xs text-muted-foreground">管理员备注：{maskFreeText(initial.reviewNote)}</p>
          ) : null}
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">{initial ? "重新登记 / 更换手机号" : "提交实名登记"}</h3>
        <p className="text-xs text-muted-foreground">
          已登记内容无法反推为明文，重新提交时请完整重填。右侧显示提交后将入库的星号串。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="vf-name">真实姓名</label>
            <input id="vf-name" className={inputCls} value={realName} onChange={(e) => setRealName(e.target.value)} placeholder="身份证上的姓名" maxLength={20} />
            <p className="mt-1 font-mono text-xs text-muted-foreground">→ {preview.realNameMasked || "—"}</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="vf-phone">手机号</label>
            <input id="vf-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" inputMode="numeric" maxLength={13} />
            <p className="mt-1 font-mono text-xs text-muted-foreground">→ {preview.phoneMasked || "—"}</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="vf-id">证件号（选填）</label>
            <input id="vf-id" className={inputCls} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="18 位身份证号" maxLength={20} />
            <p className="mt-1 font-mono text-xs text-muted-foreground">→ {preview.idNumberMasked || "—"}</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="vf-addr">联系地址（选填）</label>
            <input id="vf-addr" className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="详细住址" maxLength={80} />
            <p className="mt-1 font-mono text-xs text-muted-foreground">→ {preview.addressMasked || "—"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !formValid}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "提交中…" : confirmed ? "确认提交（会打回待核对）" : initial ? "重新登记" : "提交登记"}
          </button>
          {!formValid ? (
            <span className="text-xs text-muted-foreground">请先正确填写姓名与手机号</span>
          ) : null}
        </div>
        {message ? (
          <p className={"text-sm " + (message.ok ? "text-green-600" : "text-amber-700")}>{message.text}</p>
        ) : null}
      </form>
    </div>
  );
}
