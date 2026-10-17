import HomeClient from "@/components/HomeClient";
import { getCurrentUser, publicUser } from "@/lib/auth";

// The page renders the booking UI or the auth panel depending on the session
// cookie, so it cannot be prerendered as a static shell.
export const instant = false;

export default async function Home() {
  const user = await getCurrentUser("CUSTOMER");

  return <HomeClient initialUser={user ? publicUser(user) : null} />;
}