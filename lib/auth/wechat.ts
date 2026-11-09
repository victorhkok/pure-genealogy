// 微信登录「预留接口」——默认关闭，不产生任何外部请求。
//
// 为什么现在不能用（局域网自托管环境）：
//   1. 微信登录只对企业认证主体开放（个人主体申请不到），需要 AppID/AppSecret；
//   2. 回调域名必须备案 + HTTPS，当前 SITE_URL 是 http://192.168.31.6:3000；
//   3. supabase/gotrue v2.196 不内置微信 provider，微信 OAuth 也不是标准 OIDC
//      （openid/unionid、无 id_token），必须自研适配层把 code 换成本地会话。
//
// 将来满足条件后的接入顺序：
//   a. 在 .env.self-hosted 配 WECHAT_LOGIN_ENABLED=true、WECHAT_APP_ID、
//      WECHAT_APP_SECRET、WECHAT_REDIRECT_URI（服务端专用，勿加 NEXT_PUBLIC_）；
//   b. 实现 /api/auth/wechat/callback：code → access_token/openid →
//      GoTrue Admin API 建号或登录 → 写回会话 cookie；
//   c. 把 state 做成一次性 nonce 存服务端，防 CSRF；
//   d. 在 compose 的 app 环境变量里放行上述服务端变量。
// 在此之前按钮隐藏，回调页只显示说明，不会创建任何账号或会话。

export interface WechatLoginConfig {
  enabled: boolean;
  appId: string;
}

export function getWechatLoginConfig(): WechatLoginConfig {
  return {
    enabled: process.env.NEXT_PUBLIC_WECHAT_LOGIN_ENABLED === "true",
    appId: process.env.NEXT_PUBLIC_WECHAT_APP_ID ?? "",
  };
}

/** 构造微信开放平台扫码授权 URL（仅在功能开关打开时才会被调用）。 */
export function buildWechatAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL("https://open.weixin.qq.com/connect/qrconnect");
  u.searchParams.set("appid", params.appId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "snsapi_login");
  u.searchParams.set("state", params.state);
  return `${u.toString()}#wechat_redirect`;
}
