// 权限类型与纯函数：客户端 / 服务端共用，不依赖任何服务端模块。

export type UserRole = "admin" | "editor" | "member";
export type UserStatus = "pending" | "active" | "disabled";
export type BadgeTier = "none" | "gold" | "silver" | "bronze";
export type VerificationStatus = "none" | "pending" | "verified" | "rejected";

export interface Viewer {
  userId: string;
  email: string;
  realName: string;
  role: UserRole;
  status: UserStatus;
  approvedClaimIds: number[];
  /** 离线实名登记是否已由管理员核对通过 */
  verification: VerificationStatus;
  /** 贡献者认证 */
  isContributor: boolean;
  badgeLabel: string;
  badgeTier: BadgeTier;
  contributionNote: string;
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
  canManageUsers: boolean;
  canVerifyUsers: boolean;
  canEditPrivateRecords: boolean;
  /** 已实名且在已认领分支内的用户可查看成员敏感资料 */
  canViewPrivate: boolean;
}

/** editor 保留角色值以兼容 RLS，但对外展示为「认证贡献者」。 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  editor: "认证贡献者",
  member: "普通用户",
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "待审核",
  active: "已启用",
  disabled: "已停用",
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  none: "未登记",
  pending: "待核对",
  verified: "已实名",
  rejected: "已驳回",
};

export const BADGE_TIER_LABELS: Record<BadgeTier, string> = {
  none: "无",
  gold: "金徽章",
  silver: "银徽章",
  bronze: "铜徽章",
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
  canManageUsers: false,
  canVerifyUsers: false,
  canEditPrivateRecords: false,
  canViewPrivate: false,
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
    canManageUsers: isAdmin,
    canVerifyUsers: isAdmin,
    canEditPrivateRecords: isAdmin,
    canViewPrivate:
      isAdmin ||
      (viewer.verification === "verified" && viewer.approvedClaimIds.length > 0),
  };
}

export function canEditMember(permissions: ViewerPermissions, memberId: number): boolean {
  return permissions.canEditAny || permissions.editableIds.includes(memberId);
}
