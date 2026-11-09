import { isAdminViewer } from "@/lib/permissions";
import { SettingsForm } from "./settings-form";

export default async function FamilySettingsPage() {
  // 站点姓氏属于全局配置，只有管理员可以修改（RLS 里也做了同一限制）。
  if (!(await isAdminViewer())) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-lg">
        <h1 className="text-2xl font-bold mb-4">家族设置</h1>
        <p className="text-sm text-muted-foreground">
          只有管理员可以修改家族姓氏。如需变更，请联系族谱管理员。
        </p>
      </div>
    );
  }
  return <SettingsForm />;
}
