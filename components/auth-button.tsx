import Link from "next/link";
import { Button } from "./ui/button";
import { LogoutButton } from "./logout-button";
import { getViewer } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/access-types";

export async function AuthButton() {
  const viewer = await getViewer();
  const active = viewer?.status === "active";

  return viewer ? (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 w-full md:w-auto">
      <span className="text-sm font-medium truncate max-w-[200px] md:max-w-none mb-2 md:mb-0">
        {viewer.realName
          ? `${viewer.realName}（${ROLE_LABELS[viewer.role]}）`
          : viewer.email}
        {!active ? " · 待审核" : ""}
      </span>
      <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
        {active ? (
          <>
            <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
              <Link href="/family-tree">数据维护</Link>
            </Button>
            {viewer.role === "admin" ? (
              <>
                <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
                  <Link href="/family-tree/admin">用户管理</Link>
                </Button>
                <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
                  <Link href="/family-tree/settings">设置</Link>
                </Button>
              </>
            ) : null}
            {viewer.role === "member" ? (
              <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
                <Link href="/family-tree/my-claims">我的认领</Link>
              </Button>
            ) : null}
          </>
        ) : (
          <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
            <Link href="/auth/pending">账号待审核</Link>
          </Button>
        )}
        <LogoutButton className="w-full md:w-auto" />
      </div>
    </div>
  ) : (
    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
      <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
        <Link href="/auth/login">登录</Link>
      </Button>
      <Button asChild size="sm" variant={"default"} className="w-full md:w-auto">
        <Link href="/auth/sign-up">注册</Link>
      </Button>
    </div>
  );
}
