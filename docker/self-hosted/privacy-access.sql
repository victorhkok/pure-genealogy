-- =============================================================
-- 贡献者认证 / 离线实名登记 / 敏感资料脱敏 / 分支可见性
-- -------------------------------------------------------------
-- 设计要点：
--   * 明文个人信息永不入库：浏览器提交前即打星，服务端只校验并保存脱敏串。
--   * 族谱成员 name 保留明文（谱系主标识）；手机号 / 证件号 / 详细地址
--     在写入时由触发器自动清洗，并对已有数据做一次性幂等改写。
--   * 敏感资料表 member_private_profiles 只对「已实名 + 自己分支内」开放，
--     分支 = 本人认领成员的直系祖先链 ∪ 全部后代；管理员豁免以便审核。
--   * 籍贯类粗粒度地名（如「山东济宁」）不属于个人隐私，不改写。
-- 本脚本幂等，可重复执行。执行前请先备份数据库。
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. user_profiles：贡献者认证（大 V 式徽章 + 贡献备注）
--    角色值 editor 保持不变（避免破坏既有 RLS），仅改变展示语义。
-- -------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_contributor   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_label      text,
  ADD COLUMN IF NOT EXISTS badge_tier       text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS contribution_note text,
  ADD COLUMN IF NOT EXISTS contributor_since timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_badge_tier_check' AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_badge_tier_check
      CHECK (badge_tier IN ('none', 'gold', 'silver', 'bronze'));
  END IF;
END $$;

-- -------------------------------------------------------------
-- 2. 用户实名登记：只存脱敏串
--    revision 记录「换手机号后重新登记」的次数。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_verifications (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  real_name_masked  text NOT NULL,
  phone_masked      text NOT NULL,
  id_number_masked  text NOT NULL DEFAULT '',
  address_masked    text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note       text,
  revision          integer NOT NULL DEFAULT 1,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  verified_by       uuid,
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- 3. 成员敏感资料：只存脱敏串，按分支可见
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_private_profiles (
  member_id          bigint PRIMARY KEY REFERENCES public.family_members(id) ON DELETE CASCADE,
  contact_name_masked text NOT NULL DEFAULT '',
  phone_masked       text NOT NULL DEFAULT '',
  id_number_masked   text NOT NULL DEFAULT '',
  address_masked     text NOT NULL DEFAULT '',
  note               text NOT NULL DEFAULT '',
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- 4. 脱敏清洗函数（写入时自动生效）
--    身份证 18 位 → 前 6 后 4；手机号 11 位 → 前 3 后 4。
--    只匹配结构化号码，不会误伤「一五四三年」等谱书汉字数字。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scrub_text(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
           regexp_replace(
             p_text,
             '([0-9]{6})[0-9]{8}([0-9]{3}[0-9Xx])', '\1********\2', 'g'
           ),
           '(1[3-9][0-9])[0-9]{4}([0-9]{4})', '\1****\2', 'g'
         );
$$;

REVOKE ALL ON FUNCTION public.scrub_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scrub_text(text) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 5. family_members 写入触发器：任何来源（前端 / PostgREST / 导入）
--    写进来的敏感号码都会先被打星，明文无法落库。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scrub_member_before_write()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.residence_place  := public.scrub_text(NEW.residence_place);
  NEW.remarks          := public.scrub_text(NEW.remarks);
  NEW.spouse           := public.scrub_text(NEW.spouse);
  NEW.official_position := public.scrub_text(NEW.official_position);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scrub_member ON public.family_members;
CREATE TRIGGER trg_scrub_member
  BEFORE INSERT OR UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.scrub_member_before_write();

-- 一次性改写已有数据（幂等：无号码则不动，籍贯与谱书文字保持原样）。
UPDATE public.family_members
SET residence_place   = public.scrub_text(residence_place),
    remarks           = public.scrub_text(remarks),
    spouse            = public.scrub_text(spouse),
    official_position = public.scrub_text(official_position)
WHERE residence_place   IS DISTINCT FROM public.scrub_text(residence_place)
   OR remarks           IS DISTINCT FROM public.scrub_text(remarks)
   OR spouse            IS DISTINCT FROM public.scrub_text(spouse)
   OR official_position IS DISTINCT FROM public.scrub_text(official_position);

-- -------------------------------------------------------------
-- 6. 权限判定函数
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_verified_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_verifications v
    WHERE v.user_id = auth.uid() AND v.status = 'verified'
  );
$$;

-- 分支 = 本人已批准认领的那条成员 + 其全部直系祖先 + 其全部后代。
-- 两个递归 CTE 都用 UNION（非 ALL）去重，防止数据成环时无限递归。
CREATE OR REPLACE FUNCTION public.member_in_my_branch(p_member_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE anchors AS (
    SELECT c.member_id AS id
    FROM public.member_claims c
    WHERE c.user_id = auth.uid() AND c.status = 'approved'
  ),
  up AS (
    SELECT f.id, f.father_id
    FROM public.family_members f JOIN anchors a ON f.id = a.id
    UNION
    SELECT p.id, p.father_id
    FROM public.family_members p JOIN up u ON p.id = u.father_id
  ),
  down AS (
    SELECT f.id
    FROM public.family_members f JOIN anchors a ON f.id = a.id
    UNION
    SELECT c.id
    FROM public.family_members c JOIN down d ON c.father_id = d.id
  )
  SELECT EXISTS (
    SELECT 1 FROM (SELECT id FROM up UNION SELECT id FROM down) t
    WHERE t.id = p_member_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_verified_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_in_my_branch(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_in_my_branch(bigint) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 7. 实名登记防提权：普通用户不能把自己的 status 改成 verified
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_verification_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT coalesce(public.is_admin(), false) THEN
      NEW.status := 'pending';
      NEW.verified_by := NULL;
      NEW.verified_at := NULL;
      NEW.review_note := NULL;
    END IF;
  ELSE
    IF NOT coalesce(public.is_admin(), false) THEN
      -- 换手机号 / 重新登记一律打回待核对，且永远不能自己改成 verified。
      NEW.user_id      := OLD.user_id;
      NEW.status       := 'pending';
      NEW.verified_by  := NULL;
      NEW.verified_at  := NULL;
      NEW.review_note  := NULL;
      NEW.created_at   := OLD.created_at;
      NEW.revision     := OLD.revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_verification ON public.user_verifications;
CREATE TRIGGER trg_guard_verification
  BEFORE INSERT OR UPDATE ON public.user_verifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_write();

-- -------------------------------------------------------------
-- 8. user_verifications 的 RLS
-- -------------------------------------------------------------
ALTER TABLE public.user_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_select ON public.user_verifications;
CREATE POLICY verification_select ON public.user_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS verification_insert_own ON public.user_verifications;
CREATE POLICY verification_insert_own ON public.user_verifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS verification_update_own ON public.user_verifications;
CREATE POLICY verification_update_own ON public.user_verifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- -------------------------------------------------------------
-- 9. member_private_profiles 的 RLS：已实名 + 自己分支内，管理员豁免
-- -------------------------------------------------------------
ALTER TABLE public.member_private_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS private_select_branch ON public.member_private_profiles;
CREATE POLICY private_select_branch ON public.member_private_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_active_user()
        AND public.is_verified_user()
        AND public.member_in_my_branch(member_id))
  );

DROP POLICY IF EXISTS private_insert_admin ON public.member_private_profiles;
CREATE POLICY private_insert_admin ON public.member_private_profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS private_update_admin ON public.member_private_profiles;
CREATE POLICY private_update_admin ON public.member_private_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS private_delete_admin ON public.member_private_profiles;
CREATE POLICY private_delete_admin ON public.member_private_profiles
  FOR DELETE TO authenticated USING (public.is_admin());

-- -------------------------------------------------------------
-- 10. 姓名类明文一次性改写（幂等）
--     族谱成员 name 保留；账号实名 / 认领实名 / GoTrue metadata 打星。
--     已含星号的记录视为已脱敏，不会重复打星。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_name(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF p_text IS NULL OR p_text = '' OR position('*' in p_text) > 0 THEN
    RETURN p_text;
  END IF;
  n := char_length(p_text);
  IF n = 1 THEN RETURN p_text; END IF;
  IF n = 2 THEN RETURN left(p_text, 1) || '*'; END IF;
  RETURN left(p_text, 1) || repeat('*', n - 2) || right(p_text, 1);
END;
$$;

UPDATE public.user_profiles
SET real_name = public.mask_name(real_name)
WHERE real_name IS NOT NULL AND real_name <> '' AND real_name NOT LIKE '%*%';

UPDATE public.member_claims
SET real_name = public.mask_name(real_name)
WHERE real_name IS NOT NULL AND real_name <> '' AND real_name NOT LIKE '%*%';

UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
      raw_user_meta_data, '{real_name}',
      to_jsonb(public.mask_name(raw_user_meta_data ->> 'real_name'))
    )
WHERE raw_user_meta_data ? 'real_name'
  AND coalesce(raw_user_meta_data ->> 'real_name', '') <> ''
  AND (raw_user_meta_data ->> 'real_name') NOT LIKE '%*%';

-- 写入路径强制脱敏：无论从注册触发器、PostgREST 还是管理后台写入，
-- 明文姓名都会在落库前被打星。这是「库内不存明文」的最终保证。
CREATE OR REPLACE FUNCTION public.scrub_profile_name()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.real_name := public.mask_name(NEW.real_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scrub_profile_name ON public.user_profiles;
CREATE TRIGGER trg_scrub_profile_name
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.scrub_profile_name();

DROP TRIGGER IF EXISTS trg_scrub_claim_name ON public.member_claims;
CREATE TRIGGER trg_scrub_claim_name
  BEFORE INSERT OR UPDATE ON public.member_claims
  FOR EACH ROW EXECUTE FUNCTION public.scrub_profile_name();

-- 地址脱敏（保留首 2 末 2，数字一律打星）；已含星号则视为已脱敏，保证幂等。
CREATE OR REPLACE FUNCTION public.mask_address(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE n integer; s text;
BEGIN
  IF p_text IS NULL OR p_text = '' THEN RETURN p_text; END IF;
  n := char_length(p_text);
  IF position('*' in p_text) > 0 THEN s := p_text;
  ELSIF n <= 2 THEN s := left(p_text, 1) || '*';
  ELSIF n <= 4 THEN s := left(p_text, 1) || repeat('*', n - 2) || right(p_text, 1);
  ELSE s := left(p_text, 2) || '****' || right(p_text, 2);
  END IF;
  RETURN regexp_replace(s, '[0-9]+', '****', 'g');
END;
$$;

-- 两张敏感表的写入兜底：即使有人绕过前端直接 POST 明文，
-- 落库前也会被强制打星，数据库里永远查不到完整号码 / 姓名 / 地址。
CREATE OR REPLACE FUNCTION public.scrub_sensitive_write()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_verifications' THEN
    NEW.real_name_masked := public.mask_name(NEW.real_name_masked);
    NEW.phone_masked     := public.scrub_text(NEW.phone_masked);
    NEW.id_number_masked := public.scrub_text(NEW.id_number_masked);
    NEW.address_masked   := public.mask_address(NEW.address_masked);
  ELSE
    NEW.contact_name_masked := public.mask_name(NEW.contact_name_masked);
    NEW.phone_masked        := public.scrub_text(NEW.phone_masked);
    NEW.id_number_masked    := public.scrub_text(NEW.id_number_masked);
    NEW.address_masked      := public.mask_address(NEW.address_masked);
    NEW.note                := public.scrub_text(NEW.note);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scrub_verification ON public.user_verifications;
CREATE TRIGGER trg_scrub_verification
  BEFORE INSERT OR UPDATE ON public.user_verifications
  FOR EACH ROW EXECUTE FUNCTION public.scrub_sensitive_write();

DROP TRIGGER IF EXISTS trg_scrub_private ON public.member_private_profiles;
CREATE TRIGGER trg_scrub_private
  BEFORE INSERT OR UPDATE ON public.member_private_profiles
  FOR EACH ROW EXECUTE FUNCTION public.scrub_sensitive_write();

-- -------------------------------------------------------------
-- 11. 贡献者名录视图
--     只暴露展示所需列（实名已脱敏、徽章、贡献备注），不暴露邮箱/角色/状态。
--     视图默认以创建者权限运行，绕过 user_profiles 的行级 RLS，
--     让普通用户也能看到「谁对宗谱有贡献」；security_barrier 防越权推断。
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.contributor_directory
WITH (security_barrier = true) AS
  SELECT p.user_id,
         p.real_name,
         p.badge_label,
         p.badge_tier,
         p.contribution_note,
         p.contributor_since
  FROM public.user_profiles p
  WHERE p.is_contributor = true AND p.status = 'active';

-- -------------------------------------------------------------
-- 12. 表级授权
-- -------------------------------------------------------------
REVOKE ALL ON public.user_verifications FROM anon;
REVOKE ALL ON public.member_private_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_private_profiles TO authenticated;
GRANT ALL ON public.user_verifications TO service_role;
GRANT ALL ON public.member_private_profiles TO service_role;
REVOKE ALL ON public.contributor_directory FROM anon;
GRANT SELECT ON public.contributor_directory TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
