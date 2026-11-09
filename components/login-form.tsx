"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getWechatLoginConfig, buildWechatAuthorizeUrl } from "@/lib/auth/wechat";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const prefillEmail = process.env.NEXT_PUBLIC_LOGIN_EMAIL ?? "";
  const prefillPassword = process.env.NEXT_PUBLIC_LOGIN_PASSWORD ?? "";
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState(prefillPassword);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const wechat = getWechatLoginConfig();

  function onWechatLogin() {
    if (!wechat.enabled || !wechat.appId) {
      setError(
        "微信登录暂未启用：需要企业认证主体、备案 HTTPS 域名与微信开放平台 AppID。当前请先用邮箱登录，再到「设置 → 我的实名资料」登记手机号。",
      );
      return;
    }
    const url = buildWechatAuthorizeUrl({
      appId: wechat.appId,
      redirectUri: `${window.location.origin}/auth/wechat/callback`,
      state: Math.random().toString(36).slice(2) + Date.now().toString(36),
    });
    window.location.href = url;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // 登录成功后重定向到族谱关系图页面
      router.push("/family-tree/graph");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">登录</CardTitle>
          <CardDescription>
            请输入您的邮箱登录账户
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">密码</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    忘记密码？
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "登录中..." : "登录"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              还没有账户？{" "}
              <Link
                href="/auth/sign-up"
                className="underline underline-offset-4"
              >
                注册
              </Link>
            </div>
          </form>

          {/* 微信登录预留入口：默认关闭，不做任何外部请求 */}
          <div className="mt-4 rounded-md border border-dashed p-3 text-center">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!wechat.enabled || !wechat.appId}
              onClick={onWechatLogin}
            >
              微信登录{!wechat.enabled || !wechat.appId ? "（暂未启用）" : ""}
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              当前是局域网自托管（HTTP + 内网地址），微信登录需企业认证主体、备案 HTTPS 域名与
              微信开放平台资质，已预留配置位与回调骨架。手机号请在登录后到「设置 → 我的实名资料」登记。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
