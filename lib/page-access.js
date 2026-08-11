import { redirect } from "next/navigation";

import { getCurrentUser } from "./access";
import { getConfigurationStatus } from "./env";

export async function requirePageUser() {
  const configuration = getConfigurationStatus();
  if (!configuration.database || !configuration.githubAuth) redirect("/login");

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "ACTIVE") redirect("/login?error=AccessDenied");
  return user;
}

export async function requirePageAdmin() {
  const user = await requirePageUser();
  if (user.globalRole !== "ADMIN") redirect("/");
  return user;
}
