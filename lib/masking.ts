// 敏感信息脱敏：浏览器端与服务端共用，不依赖任何运行时专有 API。
//
// 隐私约定：明文只在浏览器输入框里存在，提交前就变成星号串；
// 网络传输、server action 参数、数据库里全部只有星号串，无法反推。
// 服务端会再用 assertMasked() 复核，防止有人绕过前端直接 POST 明文。

const PHONE_RE = /(1[3-9]\d)\d{4}(\d{4})/g;
const IDCARD_RE = /(\d{6})\d{8}(\d{3}[\dXx])/g;
const PLAIN_PHONE_RE = /(^|[^\d])1[3-9]\d{9}([^\d]|$)/;
const PLAIN_IDCARD_RE = /(^|[^\d])\d{17}[\dXx]([^\d]|$)/;

/** 手机号 13812345678 → 138****5678 */
export function maskPhone(value: string): string {
  const v = value.replace(/[\s-]/g, "");
  if (!v) return "";
  return v.replace(PHONE_RE, "$1****$2");
}

/** 身份证 110101199001011234 → 110101********1234 */
export function maskIdCard(value: string): string {
  const v = value.replace(/[\s-]/g, "").toUpperCase();
  if (!v) return "";
  return v.replace(IDCARD_RE, "$1********$2");
}

/** 姓名：保留首尾，中间打星。王振业 → 王*业；王二 → 王* */
export function maskPersonName(value: string): string {
  const v = value.trim().replace(/\s+/g, "");
  if (!v) return "";
  if (v.includes("*")) return v;
  const chars = Array.from(v);
  if (chars.length === 1) return v;
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 联系地址：保留首 2 字与末 2 字，中间固定 4 星；门牌数字一律打星 */
export function maskAddress(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.includes("*")) {
    return v.replace(/\d+/g, (m) => "*".repeat(m.length));
  }
  const chars = Array.from(v);
  let out: string;
  if (chars.length <= 2) out = `${chars[0]}*`;
  else if (chars.length <= 4) out = `${chars[0]}${"*".repeat(Math.max(1, chars.length - 2))}${chars[chars.length - 1]}`;
  else out = `${chars.slice(0, 2).join("")}****${chars.slice(-2).join("")}`;
  // 门牌 / 楼栋等数字一律打星，避免详细住址残留。
  return out.replace(/\d+/g, (m) => "*".repeat(m.length));
}

/** 自由文本：只替换其中结构化的手机号 / 证件号，不动谱书汉字数字 */
export function maskFreeText(value: string): string {
  if (!value) return "";
  return value.replace(IDCARD_RE, "$1********$2").replace(PHONE_RE, "$1****$2");
}

/** 服务端闸门：只要还含有未脱敏的手机号或证件号就拒绝入库 */
export function assertMasked(fields: Record<string, string | null | undefined>): void {
  for (const [key, raw] of Object.entries(fields)) {
    const v = String(raw ?? "");
    if (!v) continue;
    if (PLAIN_PHONE_RE.test(v) || PLAIN_IDCARD_RE.test(v)) {
      throw new Error(`${key} 含未脱敏的完整号码，已拒绝保存。请通过页面表单提交。`);
    }
  }
}

/** 星号串格式校验：避免把乱填的内容当成脱敏资料 */
export function looksMaskedPhone(value: string): boolean {
  return value === "" || /^1[3-9]\d\*{4}\d{4}$/.test(value);
}
export function looksMaskedIdCard(value: string): boolean {
  return value === "" || /^\d{6}\*{8}\d{3}[\dX]$/.test(value);
}

export interface MaskedIdentity {
  realNameMasked: string;
  phoneMasked: string;
  idNumberMasked: string;
  addressMasked: string;
}

/** 浏览器端一次性把表单明文转成脱敏串 */
export function buildMaskedIdentity(input: {
  realName: string;
  phone: string;
  idNumber: string;
  address: string;
}): MaskedIdentity {
  return {
    realNameMasked: maskPersonName(input.realName),
    phoneMasked: maskPhone(input.phone),
    idNumberMasked: maskIdCard(input.idNumber),
    addressMasked: maskAddress(input.address),
  };
}
