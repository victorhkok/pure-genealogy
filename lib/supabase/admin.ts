// GoTrue Admin API 专用客户端（仅服务端）。
// 使用 service_role key 建号 / 重置密码；绝不能把 key 或本模块暴露给客户端。
import { createClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "@/lib/runtime-config";

export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 未配置，无法使用管理员功能。");
  }
  const config = getServerSupabaseConfig();
  return createClient(config.internalUrl ?? config.supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
