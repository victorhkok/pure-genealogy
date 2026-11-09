import { fetchFamilyMembers } from "./actions";
import { FamilyMembersTable } from "./family-members-table";
import { getViewer } from "@/lib/permissions";
import { buildPermissions } from "@/lib/access-types";

interface FamilyMembersLoaderProps {
  page: number;
  pageSize: number;
  search: string;
}

export async function FamilyMembersLoader({
  page,
  pageSize,
  search,
}: FamilyMembersLoaderProps) {
  // getViewer 与 fetchFamilyMembers 里的 guard 共用 React cache，同一请求只查一次库。
  const [{ data, count, error }, viewer] = await Promise.all([
    fetchFamilyMembers(page, pageSize, search),
    getViewer(),
  ]);
  const permissions = buildPermissions(viewer);

  if (error) {
    return (
      <div className="bg-destructive/10 text-destructive p-4 rounded-lg">
        <p>加载数据失败: {error}</p>
      </div>
    );
  }

  return (
    <FamilyMembersTable
      initialData={data}
      totalCount={count}
      currentPage={page}
      pageSize={pageSize}
      searchQuery={search}
      permissions={permissions}
    />
  );
}
