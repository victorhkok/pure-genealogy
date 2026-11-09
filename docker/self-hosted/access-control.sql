-- =============================================================
-- 权限系统：用户档案 / 角色三档 / 成员认领 / 细粒度 RLS
-- -------------------------------------------------------------
-- 角色：admin（全权）、editor（可编辑任意成员，不可增删）、member（只能编辑自己认领的成员）
-- 状态：pending（待审核，禁止访问）、active（正常）、disabled（停用）
-- 本脚本幂等，可重复执行。
--   * 全新自托管安装：由 00-init.sh 在最后一步自动执行。
--   * 已有数据库：手动执行一次（psql -f access-control.sql）。
-- 注意：执行前请先备份数据库。
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. 用户档案
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  real_name   text NOT NULL DEFAULT '',
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'editor', 'member')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  note        text,
  approved_by uuid,
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON public.user_profiles(status);

-- -------------------------------------------------------------
-- 2. 成员认领（一人最多认领一条，一条成员最多被一人认领）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_claims (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id   bigint NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  real_name   text NOT NULL,
  note        text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 兼容旧安装：早期版本在表上建了全状态唯一约束，会让被驳回的申请无法重新提交。
ALTER TABLE public.member_claims
  DROP CONSTRAINT IF EXISTS member_claims_user_member_key;

CREATE INDEX IF NOT EXISTS idx_member_claims_user ON public.member_claims(user_id);
-- 只对「待审 / 生效」生效：被驳回的记录保留可追溯，且允许重新申请同一成员。
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_claims_open_pair
  ON public.member_claims(user_id, member_id)
  WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_claims_one_per_member
  ON public.member_claims(member_id) WHERE status = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_claims_one_per_user
  ON public.member_claims(user_id) WHERE status = 'approved';

-- -------------------------------------------------------------
-- 3. 权限判定函数
--    SECURITY DEFINER：读 user_profiles / member_claims 时绕过 RLS，
--    避免策略里递归引用自身导致 infinite recursion。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.role FROM public.user_profiles p
  WHERE p.user_id = auth.uid() AND p.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.my_role() = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_member(p_member_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.my_role() IN ('admin', 'editor'), false)
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

REVOKE ALL ON FUNCTION public.my_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_member(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_member(bigint) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 4. 新用户自动建档（实名放在 GoTrue 的 raw_user_meta_data.real_name）
--    默认 member / pending，必须管理员启用后才能访问。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, real_name, role, status)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(NEW.raw_user_meta_data ->> 'real_name', ''),
    'member',
    'pending'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 回填已经存在的账号，避免升级后被锁在门外。
-- 现存账号本来就是管理员手工建立的，一律保留访问权；
-- admin@home.local 固定为 admin / active。
INSERT INTO public.user_profiles (user_id, email, real_name, role, status)
SELECT u.id,
       coalesce(u.email, ''),
       coalesce(u.raw_user_meta_data ->> 'real_name', ''),
       CASE WHEN u.email = 'admin@home.local' THEN 'admin' ELSE 'member' END,
       'active'
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.user_profiles p
SET role = 'admin', status = 'active', updated_at = now()
FROM auth.users u
WHERE p.user_id = u.id AND u.email = 'admin@home.local';

-- -------------------------------------------------------------
-- 5. user_profiles 的 RLS
-- -------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.user_profiles;
CREATE POLICY profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_insert_admin ON public.user_profiles;
CREATE POLICY profiles_insert_admin ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS profiles_update_admin ON public.user_profiles;
CREATE POLICY profiles_update_admin ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS profiles_delete_admin ON public.user_profiles;
CREATE POLICY profiles_delete_admin ON public.user_profiles
  FOR DELETE TO authenticated USING (public.is_admin());

-- -------------------------------------------------------------
-- 6. member_claims 的 RLS
-- -------------------------------------------------------------
ALTER TABLE public.member_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_select ON public.member_claims;
CREATE POLICY claims_select ON public.member_claims
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS claims_insert_own ON public.member_claims;
CREATE POLICY claims_insert_own ON public.member_claims
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND public.is_active_user());

DROP POLICY IF EXISTS claims_update_admin ON public.member_claims;
CREATE POLICY claims_update_admin ON public.member_claims
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS claims_withdraw_own ON public.member_claims;
CREATE POLICY claims_withdraw_own ON public.member_claims
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS claims_delete_admin ON public.member_claims;
CREATE POLICY claims_delete_admin ON public.member_claims
  FOR DELETE TO authenticated USING (public.is_admin());

-- -------------------------------------------------------------
-- 7. family_members：收紧原来的「登录即可增删改全部」
-- -------------------------------------------------------------
DROP POLICY IF EXISTS family_members_authenticated ON public.family_members;

DROP POLICY IF EXISTS family_members_select_active ON public.family_members;
CREATE POLICY family_members_select_active ON public.family_members
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS family_members_insert_admin ON public.family_members;
CREATE POLICY family_members_insert_admin ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS family_members_update_limited ON public.family_members;
CREATE POLICY family_members_update_limited ON public.family_members
  FOR UPDATE TO authenticated
  USING (public.can_edit_member(id))
  WITH CHECK (public.can_edit_member(id));

DROP POLICY IF EXISTS family_members_delete_admin ON public.family_members;
CREATE POLICY family_members_delete_admin ON public.family_members
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- 8. site_settings：姓氏只有管理员能改，匿名仍可读
-- -------------------------------------------------------------
DROP POLICY IF EXISTS site_settings_auth_all ON public.site_settings;

DROP POLICY IF EXISTS site_settings_anon_select ON public.site_settings;
CREATE POLICY site_settings_anon_select ON public.site_settings
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS site_settings_auth_select ON public.site_settings;
CREATE POLICY site_settings_auth_select ON public.site_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS site_settings_admin_insert ON public.site_settings;
CREATE POLICY site_settings_admin_insert ON public.site_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS site_settings_admin_update ON public.site_settings;
CREATE POLICY site_settings_admin_update ON public.site_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS site_settings_admin_delete ON public.site_settings;
CREATE POLICY site_settings_admin_delete ON public.site_settings
  FOR DELETE TO authenticated USING (public.is_admin());

-- -------------------------------------------------------------
-- 9. 表级授权（RLS 之后的第二道门）
-- -------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON public.user_profiles FROM anon;
REVOKE ALL ON public.member_claims FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_claims TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.member_claims_id_seq TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
GRANT ALL ON public.member_claims TO service_role;
GRANT ALL ON SEQUENCE public.member_claims_id_seq TO service_role;

COMMIT;

-- 通知 PostgREST 重载 schema cache，否则新建的两张表会返回 PGRST205 / 404。
NOTIFY pgrst, 'reload schema';
