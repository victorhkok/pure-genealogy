import Link from "next/link";
import { getWechatLoginConfig } from "@/lib/auth/wechat";

/**
 * 微信登录回调「骨架」。功能开关未打开时只显示接入说明，
 * 不读取 code、不调用任何外部接口、不创建账号或会话。
 * 接入步骤见 lib/auth/wechat.ts 顶部注释。
 */
export default function WechatCallbackPage() {
  const config = getWechatLoginConfig();
  const ready = config.enabled && Boolean(config.appId);

  return (
    <div className="container mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold">微信登录</h1>
      {ready ? (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">回调适配层尚未实现</p>
          <p className="mt-2 text-xs leading-relaxed">
            功能开关已打开，但自建 GoTrue 不提供微信 provider。需要实现
            code → access_token / openid → GoTrue Admin API 建号或登录 → 写回会话 cookie，
            并用一次性 state nonce 防 CSRF。在此之前不会创建任何会话。
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3 rounded-lg border p-5 text-sm">
          <p className="font-medium">微信登录暂未启用</p>
          <p className="text-muted-foreground">
            当前部署是局域网 HTTP 自托管，缺少微信登录的三项前置条件：
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>企业认证主体与微信开放平台 AppID / AppSecret（个人主体无法申请）</li>
            <li>已备案的公网 HTTPS 域名作为 OAuth 回调地址</li>
            <li>GoTrue 微信 OAuth 适配层（微信授权不是标准 OIDC）</li>
          </ul>
          <p className="text-muted-foreground">
            系统已预留配置开关与回调骨架；现阶段请使用邮箱登录，手机号与实名资料在
            「设置 → 我的实名资料」中离线登记，由管理员线下核对。
          </p>
        </div>
      )}
      <Link href="/auth/login" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← 返回登录
      </Link>
    </div>
  );
}
