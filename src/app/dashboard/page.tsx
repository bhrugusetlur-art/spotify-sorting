import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getCurrentAccount } from "@/lib/auth/current-user";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/");

  return <Dashboard account={{ displayName: account.displayName, imageUrl: account.imageUrl }} />;
}
