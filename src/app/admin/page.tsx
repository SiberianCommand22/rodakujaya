import AdminDashboard from "@/components/AdminDashboard";
import { getCurrentUser, publicUser } from "@/lib/auth";

export const instant = false;

export default async function AdminPage() {
  const user = await getCurrentUser("ADMIN");
  return <AdminDashboard initialUser={user ? publicUser(user) : null} />;
}
