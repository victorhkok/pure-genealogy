import { redirect } from "next/navigation";
import { isAdminViewer } from "@/lib/permissions";
import { fetchAdminData } from "./actions";
import { AdminConsole } from "./admin-console";

export default async function AdminPage() {
  // 服务端硬闸门：非管理员直接回列表页；真正的写操作在 action 里还会再校验一次。
  if (!(await isAdminViewer())) redirect("/family-tree");
  const data = await fetchAdminData();
  return (
    <AdminConsole
      initialProfiles={data.profiles}
      initialClaims={data.claims}
      initialVerifications={data.verifications}
      initialMembers={data.members}
      initialIsBranchAdminView={data.isBranchAdminView}
      initialError={data.error}
    />
  );
}
