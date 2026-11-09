-- =============================================================
-- 房支管理员（按房支子树划分管辖范围）
-- -------------------------------------------------------------
-- 角色矩阵（在 access-control.sql 的 admin / editor / member 基础上扩展）：
--   admin        总管理员：全族 CRUD + 用户管理 + 改姓氏 + 实名核对 + 审批所有认领
--   branch_admin 房支管理员：本房支（房祖向下的整棵子树）增删改 + 审批本支认领
--                         + 查看本支成员敏感资料；不能改姓氏 / 管理账号 / 提权
--   editor       认证贡献者：编辑任意成员（不能增删）
--   member       普通用户：仅编辑本人认领记录
-- 房支 = 房祖成员向下的全部后代，用 family_members.father_id 向上回溯推导，
--       不新增成员字段、不补历史数据。
-- 本脚本幂等，可重复执行；执行前请先备份数据库。
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. user_profiles：角色约束扩展 + 房支管辖范围
-- -------------------------------------------------------------
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'editor', 'member', 'branch_admin'));

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS branch_scope bigint REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_scope
  ON public.user_profiles(branch_scope);

-- -------------------------------------------------------------
-- 2. 房支判定函数（SECURITY DEFINER 绕过 RLS，避免递归）
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_branch_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.my_role() = 'branch_admin', false);
$$;

-- 成员 id 是否落在以 p_root_id 为房祖的子树内（向上回溯 father 链，命中房祖即 true）。
CREATE OR REPLACE FUNCTION public.member_in_branch_root(p_member_id bigint, p_root_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT id, father_id FROM public.family_members WHERE id = p_member_id
    UNION
    SELECT m.id, m.father_id
    FROM public.family_members m JOIN chain c ON m.id = c.father_id
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE id = p_root_id);
$$;

-- 当前房支管理员是否可管理该成员（房祖为空则无管辖范围）。
CREATE OR REPLACE FUNCTION public.is_branch_admin_for(p_member_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_branch_admin() AND EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid()
      AND p.branch_scope IS NOT NULL
      AND public.member_in_branch_root(p_member_id, p.branch_scope)
  );
$$;

-- 房支管理员可插入的成员：父亲必须落在房支内（禁止房支管理员凭空创建新根）。
CREATE OR REPLACE FUNCTION public.branch_allows_insert(p_father_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_branch_admin() AND p_father_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid()
      AND p.branch_scope IS NOT NULL
      AND public.member_in_branch_root(p_father_id, p.branch_scope)
  );
$$;

-- 房支管理员可管理的用户：该用户有已批准认领落在管理员房支内。
CREATE OR REPLACE FUNCTION public.user_in_my_branch(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_branch_admin() AND EXISTS (
    SELECT 1 FROM public.member_claims c
    JOIN public.user_profiles p ON p.user_id = auth.uid()
    WHERE c.user_id = p_user_id
      AND c.status = 'approved'
      AND p.branch_scope IS NOT NULL
      AND public.member_in_branch_root(c.member_id, p.branch_scope)
  );
$$;

REVOKE ALL ON FUNCTION public.is_branch_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_in_branch_root(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_branch_admin_for(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.branch_allows_insert(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_in_my_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_branch_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_in_branch_root(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_branch_admin_for(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.branch_allows_insert(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_in_my_branch(uuid) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 3. 重写 can_edit_member：纳入房支管理员（本支内可编辑）
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_member(p_member_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.my_role() IN ('admin', 'editor'), false)
      OR public.is_branch_admin_for(p_member_id)
      OR (
        public.is_active_user()
        AND EXISTS (
          SELECT 1 FROM public.member_claims c
          WHERE c.user_id = auth.uid()
            AND c.member_id = p_member_id
            AND c.status = 'approved'
        )
      );
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_member(bigint) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 4. family_members：增删改纳入房支管理员（仅本支）
--    access-control.sql 已建 family_members_insert_admin / _update_limited / _delete_admin，
--    此处用「可叠加的宽松策略」追加房支维度（多条策略之间为 OR 语义）。
-- -------------------------------------------------------------
DROP POLICY IF EXISTS family_members_insert_branch ON public.family_members;
CREATE POLICY family_members_insert_branch ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (public.branch_allows_insert(NEW.father_id));

DROP POLICY IF EXISTS family_members_delete_branch ON public.family_members;
CREATE POLICY family_members_delete_branch ON public.family_members
  FOR DELETE TO authenticated
  USING (public.is_branch_admin_for(id));

-- UPDATE 策略仍引用 can_edit_member()，上面已重写，自动生效，无需重建。

-- -------------------------------------------------------------
-- 5. member_claims：审批纳入房支管理员（仅本支）
-- -------------------------------------------------------------
DROP POLICY IF EXISTS claims_review_branch ON public.member_claims;
CREATE POLICY claims_review_branch ON public.member_claims
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_branch_admin_for(member_id))
  WITH CHECK (public.is_admin() OR public.is_branch_admin_for(member_id));

DROP POLICY IF EXISTS claims_review_delete_branch ON public.member_claims;
CREATE POLICY claims_review_delete_branch ON public.member_claims
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_branch_admin_for(member_id));

-- -------------------------------------------------------------
-- 6. member_private_profiles：房支管理员可查看本支敏感资料
-- -------------------------------------------------------------
DROP POLICY IF EXISTS private_select_branch_admin ON public.member_private_profiles;
CREATE POLICY private_select_branch_admin ON public.member_private_profiles
  FOR SELECT TO authenticated
  USING (public.is_branch_admin_for(member_id));

DROP POLICY IF EXISTS private_write_branch_admin ON public.member_private_profiles;
CREATE POLICY private_write_branch_admin ON public.member_private_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_branch_admin_for(member_id));
DROP POLICY IF EXISTS private_update_branch_admin ON public.member_private_profiles;
CREATE POLICY private_update_branch_admin ON public.member_private_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_branch_admin_for(member_id))
  WITH CHECK (public.is_admin() OR public.is_branch_admin_for(member_id));
DROP POLICY IF EXISTS private_delete_branch_admin ON public.member_private_profiles;
CREATE POLICY private_delete_branch_admin ON public.member_private_profiles
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_branch_admin_for(member_id));

-- -------------------------------------------------------------
-- 7. user_profiles：房支管理员可启用/停用本支用户（但不能改角色 / 动自己）
-- -------------------------------------------------------------
DROP POLICY IF EXISTS profiles_status_branch ON public.user_profiles;
CREATE POLICY profiles_status_branch ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.user_in_my_branch(user_id))
  WITH CHECK (
    public.is_admin()
    OR (
      public.user_in_my_branch(user_id)
      AND user_id <> auth.uid()
      AND NEW.role = OLD.role          -- 房支管理员不能改角色（防提权）
      AND NEW.user_id = OLD.user_id
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
