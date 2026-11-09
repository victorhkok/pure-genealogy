import { BADGE_TIER_LABELS, type BadgeTier } from "@/lib/access-types";
import { formatBeijingTime } from "@/lib/format-date";
import type { ContributorRow } from "@/app/family-tree/settings/actions";

const TIER_STYLE: Record<BadgeTier, string> = {
  none: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
  gold: "border-amber-500 bg-amber-50 text-amber-800",
  silver: "border-slate-400 bg-slate-50 text-slate-700",
  bronze: "border-orange-400 bg-orange-50 text-orange-800",
};

const TIER_ORDER: Record<BadgeTier, number> = { gold: 0, silver: 1, bronze: 2, none: 3 };

export function ContributorDirectory({ rows }: { rows: ContributorRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => TIER_ORDER[a.badgeTier] - TIER_ORDER[b.badgeTier],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">贡献者名录</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          致敬为宗谱编修、理事会事务与捐资出力的宗亲。认证由管理员授予，姓名以星号串展示以保护隐私。
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          暂无认证贡献者。管理员可在「用户与权限」中授予徽章并填写贡献备注。
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => (
            <article key={c.userId} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-base font-semibold">{c.realName || "宗亲"}</div>
                <span
                  className={
                    "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium " +
                    TIER_STYLE[c.badgeTier]
                  }
                >
                  ★ {c.badgeLabel || "认证贡献者"}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {BADGE_TIER_LABELS[c.badgeTier]}
                {c.since ? ` · 认证于 ${formatBeijingTime(c.since)}` : ""}
              </div>
              {c.contributionNote ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {c.contributionNote}
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">暂未填写贡献说明</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
