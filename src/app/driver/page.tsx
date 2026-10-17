import DriverDashboard from "@/components/DriverDashboard";
import { getCurrentUser, publicUser } from "@/lib/auth";

export const instant = false;

export default async function DriverPage() {
  const user = await getCurrentUser("DRIVER");

  return <DriverDashboard initialUser={user ? publicUser(user) : null} />;
}