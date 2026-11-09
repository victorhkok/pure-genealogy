import { fetchContributors } from "@/app/family-tree/settings/actions";
import { ContributorDirectory } from "./contributor-directory";

export default async function ContributorsPage() {
  const { rows, error } = await fetchContributors();
  return (
    <div className="container mx-auto px-4 py-10">
      <a href="/family-tree" className="text-sm text-primary hover:underline">
        ← 返回成员列表
      </a>
      <div className="mt-6">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <ContributorDirectory rows={rows} />
        )}
      </div>
    </div>
  );
}
