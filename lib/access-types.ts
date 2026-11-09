// 权限类型与纯函数：客户端 / 服务端共用，不依赖任何服务端模块。

export type UserRole = "admin" | "editor" | "member";
export type UserStatus = "pending" | "active" | "disabled";

export interface Viewer {
  userId: string;
  email: string;
  realName: string;
  role: UserRole;
  status: UserStatus;
  approvedClaimIds: number[];
}

/** 传给前端表格的权限快照。仅用于界面展示，真正的拦截在服务端 action + RLS。 */
export interface ViewerPermissions {
  role: UserRole | null;
  canCreate: boolean;
  canDelete: boolean;
  canBatch: boolean;
  canImport: boolean;
  canChangeSettings: boolean;
  canEditAny: boolean;
  editableIds: number[];
  canClaim: boolean;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  editor: "编辑者",
  member: "普通用户",
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "待审核",
  active: "已启用",
  disabled: "已停用",
};

export const GUEST_PERMISSIONS: ViewerPermissions = {
  role: null,
  canCreate: false,
  canDelete: false,
  canBatch: false,
  canImport: false,
  canChangeSettings: false,
  canEditAny: false,
  editableIds: [],
  canClaim: false,
};

export function buildPermissions(viewer: Viewer | null): ViewerPermissions {
  if (!viewer || viewer.status !== "active") return GUEST_PERMISSIONS;
  const isAdmin = viewer.role === "admin";
  const isEditor = viewer.role === "editor";
  return {
    role: viewer.role,
    canCreate: isAdmin,
    canDelete: isAdmin,
    canBatch: isAdmin,
    canImport: isAdmin,
    canChangeSettings: isAdmin,
    canEditAny: isAdmin || isEditor,
    editableIds: viewer.approvedClaimIds,
    // 普通用户只能认领一次；已有生效认领后不再显示认领入口。
    canClaim: viewer.role === "member" && viewer.approvedClaimIds.length === 0,
  };
}

export function canEditMember(permissions: ViewerPermissions, memberId: number): boolean {
  return permissions.canEditAny || permissions.editableIds.includes(memberId);
}
