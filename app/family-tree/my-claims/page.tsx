import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchMyClaims, type MemberOption } from "../claims/actions";
import { MyClaimsClient } from "./my-claims-client";

interface PageProps {
  searchParams: Promise<{ member?: string }>;
}

export default async function MyClaimsPage({ searchParams }: PageProps) {
  const viewer = await requireViewer();
  if (!viewer) redirect("/auth/pending");

  const params = await searchParams;
  const presetId = Number(params.member);
  let preset: MemberOption | null = null;
  if (Number.isInteger(presetId) && presetId > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("family_members")
      .select("id, name, generation")
      .eq("id", presetId)
      .maybeSingle();
    if (data) {
      preset = {
        id: Number(data.id),
        name: String(data.name),
        generation: data.generation === null ? null : Number(data.generation),
      };
    }
  }

  const { claims } = await fetchMyClaims();
  return (
    <MyClaimsClient
      realName={viewer.realName}
      role={viewer.role}
      approvedClaimIds={viewer.approvedClaimIds}
      initialClaims={claims}
      preset={preset}
    />
  );
}
