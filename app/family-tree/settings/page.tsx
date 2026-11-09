import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, VERIFICATION_LABELS } from "@/lib/access-types";
import { fetchAdminData } from "@/app/family-tree/admin/actions";
import {
  fetchMyVerification,
  fetchPrivateRecords,
  fetchContributors,
} from "./actions";
import { SettingsClient } from "./settings-client";

export default async function FamilySettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/login");
  if (viewer.status !== "active") redirect("/auth/pending");

  const isAdmin = viewer.role === "admin";
  const [verification, privateData, contributors, adminData] = await Promise.all([
    fetchMyVerification(),
    fetchPrivateRecords(),
    fetchContributors(),
    isAdmin ? fetchAdminData() : Promise.resolve(null),
  ]);

  let members: { id: number; name: string }[] = [];
  if (isAdmin) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("family_members")
      .select("id, name")
      .order("id", { ascending: true })
      .limit(1000);
    members = (data ?? []).map((m) => ({ id: Number(m.id), name: String(m.name) }));
  }

  return (
    <SettingsClient
      isAdmin={isAdmin}
      roleLabel={ROLE_LABELS[viewer.role]}
      verificationStatus={VERIFICATION_LABELS[viewer.verification]}
      verificationData={verification.data}
      privateRows={privateData.rows}
      canViewPrivate={privateData.canView}
      privateError={privateData.error}
      hasClaim={viewer.approvedClaimIds.length > 0}
      members={members}
      adminData={adminData}
      contributors={contributors.rows}
    />
  );
}
