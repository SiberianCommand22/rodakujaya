import { redirect } from "next/navigation";
import ProfileClient from "@/components/ProfileClient";
import { getCurrentUser, publicUser } from "@/lib/auth";

export const instant = false;

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  return <ProfileClient initialUser={publicUser(user)} />;
}
