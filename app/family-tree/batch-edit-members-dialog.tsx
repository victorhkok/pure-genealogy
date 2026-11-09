"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, Pencil, RotateCcw } from "lucide-react";
import { batchUpdateFamilyMembers, fetchAllMembersForSelect } from "./actions";

type FieldKey =
  | "generation"
  | "sibling_order"
  | "father_id"
  | "gender"
  | "is_alive"
  | "birthday"
  | "death_date"
  | "residence_place"
  | "official_position"
  | "spouse";

type FieldValue = string | number | boolean | null;

interface FieldDef {
  key: FieldKey;
  label: string;
  kind: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  /** 是否允许把该字段批量清空为 NULL */
  allowClear?: boolean;
}

const FIELDS: FieldDef[] = [
  { key: "generation", label: "世代", kind: "number", allowClear: true },
  { key: "sibling_order", label: "排行", kind: "number", allowClear: true },
  { key: "father_id", label: "父亲", kind: "select", allowClear: true },
  {
    key: "gender",
    label: "性别",
    kind: "select",
    allowClear: true,
    options: [
      { value: "男", label: "男" },
      { value: "女", label: "女" },
    ],
  },
  {
    key: "is_alive",
    label: "在世",
    kind: "select",
    options: [
      { value: "true", label: "是" },
      { value: "false", label: "否" },
    ],
  },
  { key: "birthday", label: "生日", kind: "date", allowClear: true },
  { key: "death_date", label: "卒年", kind: "date", allowClear: true },
  { key: "residence_place", label: "居住地", kind: "text", allowClear: true },
  { key: "official_position", label: "官职", kind: "text", allowClear: true },
  { key: "spouse", label: "配偶", kind: "text", allowClear: true },
];

const LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<
  FieldKey,
  string
>;

const KEEP = "__keep__";
const CLEAR = "__clear__";

interface BatchEditMembersDialogProps {
  selectedIds: number[];
  onSuccess?: () => void;
}

export function BatchEditMembersDialog({
  selectedIds,
  onSuccess,
}: BatchEditMembersDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Partial<Record<FieldKey, string>>>({});
  const [cleared, setCleared] = React.useState<Partial<Record<FieldKey, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [parentOptions, setParentOptions] = React.useState<
    { id: number; name: string; generation: number | null }[]
  >([]);
  const [isLoadingParents, setIsLoadingParents] = React.useState(false);
  const [parentError, setParentError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoadingParents(true);
    setParentError(null);
    fetchAllMembersForSelect()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        setParentOptions(fetchError ? [] : data);
        setParentError(fetchError);
      })
      .catch(() => {
        if (cancelled) return;
        setParentOptions([]);
        setParentError("父亲列表加载失败，请关闭后重新打开弹窗重试");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingParents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setValues({});
    setCleared({});
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setIsSubmitting(false);
    }
  };

  const setValue = (key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setCleared((prev) => ({ ...prev, [key]: false }));
    setError(null);
  };

  const toggleClear = (key: FieldKey) => {
    setCleared((prev) => ({ ...prev, [key]: !prev[key] }));
    setValues((prev) => ({ ...prev, [key]: "" }));
    setError(null);
  };

  const optionsFor = (field: FieldDef) => {
    if (field.key === "father_id") {
      return parentOptions.map((p) => ({
        value: String(p.id),
        label: `${p.name}（ID ${p.id}${p.generation !== null ? ` · 第 ${p.generation} 世` : ""}）`,
      }));
    }
    return field.options ?? [];
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;

    const changes: Record<string, FieldValue> = {};
    for (const field of FIELDS) {
      const raw = values[field.key] ?? "";

      if (field.kind === "select") {
        if (!raw || raw === KEEP) continue;
        if (raw === CLEAR) {
          changes[field.key] = null;
          continue;
        }
        if (field.key === "father_id") changes[field.key] = Number(raw);
        else if (field.key === "is_alive") changes[field.key] = raw === "true";
        else changes[field.key] = raw;
        continue;
      }

      if (cleared[field.key]) {
        changes[field.key] = null;
        continue;
      }
      const value = raw.trim();
      if (!value) continue;
      if (field.kind === "number") {
        const numeric = Number(value);
        if (!Number.isInteger(numeric) || numeric < 0) {
          setError(`${field.label} 必须是不小于 0 的整数`);
          return;
        }
        changes[field.key] = numeric;
      } else if (field.kind === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          setError(`${field.label} 需要是 YYYY-MM-DD 格式`);
          return;
        }
        changes[field.key] = value;
      } else {
        changes[field.key] = value;
      }
    }

    if (Object.keys(changes).length === 0) {
      setError("请至少填写一个要修改的字段，或选择一个「清空」操作");
      return;
    }

    const summary = Object.entries(changes)
      .map(([key, value]) => {
        const label = LABELS[key as FieldKey] ?? key;
        const display = value === null ? "清空" : String(value);
        return `${label} → ${display}`;
      })
      .join("\n");

    const confirmed = window.confirm(
      `确定把选中的 ${selectedIds.length} 位成员统一修改为：\n\n${summary}\n\n未列出的字段保持不变，此操作会同时更新「更新时间」。`
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await batchUpdateFamilyMembers(selectedIds, changes);
      if (result.success) {
        setOpen(false);
        reset();
        onSuccess?.();
      } else {
        setError(`批量修改失败：${result.error}`);
      }
    } catch (e) {
      setError(`批量修改失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={selectedIds.length === 0}
      >
        <Pencil className="h-4 w-4 mr-2" />
        批量修改 {selectedIds.length > 0 && `(${selectedIds.length})`}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[560px] max-h-[88vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle>批量编辑成员</DialogTitle>
            <DialogDescription>
              只修改下方填写的字段，留空或选择「不修改」的字段保持原值。
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
              <span className="font-medium">已选 {selectedIds.length} 位成员</span>
              <span className="text-muted-foreground">· 未列出的字段不会被改动</span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              提示：仅修改「父亲」时会自动把世代设为父世代 + 1；不能把本次勾选的成员设为父亲。姓名、生平事迹、ID 请逐条编辑。
            </p>

            <div className="space-y-2">
              {FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="grid grid-cols-[110px_1fr] items-center gap-3"
                >
                  <Label className="text-right text-sm text-muted-foreground whitespace-nowrap">
                    {field.label}修改为
                  </Label>

                  {field.kind === "select" ? (
                    <Select
                      value={values[field.key] || KEEP}
                      onValueChange={(value) =>
                        setValue(field.key, value === KEEP ? "" : value)
                      }
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="不修改" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={KEEP}>不修改</SelectItem>
                        {field.allowClear && (
                          <SelectItem value={CLEAR}>清空此字段</SelectItem>
                        )}
                        {optionsFor(field).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type={
                          field.kind === "number"
                            ? "number"
                            : field.kind === "date"
                              ? "date"
                              : "text"
                        }
                        min={field.kind === "number" ? 0 : undefined}
                        value={cleared[field.key] ? "" : (values[field.key] ?? "")}
                        disabled={!!cleared[field.key]}
                        placeholder={
                          cleared[field.key] ? "将清空该字段" : "留空则不修改"
                        }
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className="h-9"
                      />
                      {field.allowClear && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 px-2 shrink-0 text-xs"
                          onClick={() => toggleClear(field.key)}
                        >
                          {cleared[field.key] ? (
                            <>
                              <RotateCcw className="h-3 w-3 mr-1" />
                              撤销
                            </>
                          ) : (
                            "清空"
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {fieldHint(parentError, isLoadingParents)}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "保存中..." : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function fieldHint(parentError: string | null, isLoadingParents: boolean) {
  if (isLoadingParents) {
    return (
      <p className="text-xs text-muted-foreground">
        正在加载父亲候选列表...
      </p>
    );
  }
  if (parentError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        父亲列表加载失败：{parentError}
      </p>
    );
  }
  return null;
}
