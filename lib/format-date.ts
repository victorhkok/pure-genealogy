// 固定时区的时间格式化。
// 客户端组件也会被 SSR 预渲染；直接 toLocaleString() 会因 Node(UTC) 与浏览器(本地时区)
// 输出不同而触发 React #418 hydration mismatch。这里显式指定 Asia/Shanghai 并用
// formatToParts 拼接，保证服务端与浏览器得到完全相同的字符串。
export function formatBeijingTime(ts: string): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
