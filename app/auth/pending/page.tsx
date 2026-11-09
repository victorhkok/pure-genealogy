import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";

export default function PendingPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md rounded-lg border p-8 space-y-5">
        <h1 className="text-2xl font-bold">账号待管理员审核</h1>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>你的实名注册已提交，但还没有被管理员启用，暂时不能查看族谱数据。</p>
          <p>
            请联系族谱管理员核对实名信息并启用账号；启用后重新登录即可访问。
            若账号被停用，也会显示在这个页面。
          </p>
        </div>
        <div className="flex gap-2 pt-2">
          <Button asChild variant="outline">
            <Link href="/">返回首页</Link>
          </Button>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
