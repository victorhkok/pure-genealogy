"use client";

import { useState } from "react";
import Link from "next/link";
import { AppearanceForm } from "./appearance-form";
import { VerificationForm } from "./verification-form";
import { PrivateRecordsForm } from "./private-records-form";
import { SettingsForm } from "./settings-form";
import { AdminConsole } from "@/app/family-tree/admin/admin-console";
import { ContributorDirectory } from "@/app/family-tree/contributors/contributor-directory";
import type { VerificationRow, PrivateRecordRow, ContributorRow } from "./actions";
import type { AdminData } from "@/app/family-tree/admin/actions";

type TabKey =
  | "appearance"
  | "verification"
  | "private"
  | "contributors"
  | "users"
  | "family";

interface TabDef {
  key: TabKey;
  label: string;
  hint: string;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { key: "appearance", label: "显示与易用", hint: "字号 / 主题 / 长辈模式" },
  { key: "verification", label: "我的实名资料", hint: "离线实名登记与换号" },
  { key: "private", label: "族谱联系资料", hint: "按分支可见的脱敏资料" },
  { key: "contributors", label: "贡献者名录", hint: "理事会 / 捐资 / 编修" },
  { key: "users", label: "用户与权限", hint: "账号、徽章、实名核对", adminOnly: true },
  { key: "family", label: "家族设置", hint: "全站姓氏", adminOnly: true },
];

export function SettingsClient(props: {
  isAdmin: boolean;
  roleLabel: string;
  verificationStatus: string;
  verificationData: VerificationRow | null;
  privateRows: PrivateRecordRow[];
  canViewPrivate: boolean;
  privateError: string | null;
  hasClaim: boolean;
  members: { id: number; name: string }[];
  adminData: AdminData | null;
  contributors: ContributorRow[];
}) {
  const [active, setActive] = useState<TabKey>("appearance");
  const tabs = TABS.filter((t) => !t.adminOnly || props.isAdmin);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          当前身份：{props.roleLabel} · 实名状态：{props.verificationStatus}。所有个性化设置仅保存在本机浏览器。
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* 侧边菜单 */}
        <nav className="flex gap-2 overflow-x-auto pb-2 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "shrink-0 rounded-md border px-3 py-2 text-left text-sm transition-colors lg:w-full " +
                (active === t.key
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted")
              }
            >
              <span className="block whitespace-nowrap">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.hint}</span>
            </button>
          ))}
          <div className="hidden lg:mt-2 lg:block">
            <Link href="/family-tree/contributors" className="text-xs text-primary hover:underline">
              打开独立贡献者名录页 ↗
            </Link>
          </div>
        </nav>

        {/* 内容区 */}
        <div className="min-w-0 flex-1">
          {active === "appearance" ? <AppearanceForm /> : null}

          {active === "verification" ? (
            <VerificationForm initial={props.verificationData} status={props.verificationStatus} />
          ) : null}

          {active === "private" ? (
            <PrivateRecordsForm
              rows={props.privateRows}
              canView={props.canViewPrivate}
              isAdmin={props.isAdmin}
              verification={props.verificationStatus}
              hasClaim={props.hasClaim}
              members={props.members}
            />
          ) : null}

          {active === "contributors" ? (
            <ContributorDirectory rows={props.contributors} />
          ) : null}

          {active === "users" && props.isAdmin && props.adminData ? (
            <AdminConsole
              initialProfiles={props.adminData.profiles}
              initialClaims={props.adminData.claims}
              initialVerifications={props.adminData.verifications}
              initialError={props.adminData.error}
            />
          ) : null}

          {active === "family" && props.isAdmin ? <SettingsForm /> : null}

          {props.privateError && active === "private" ? (
            <p className="mt-3 text-sm text-red-600">{props.privateError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
