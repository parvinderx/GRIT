import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homePathForRoles } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/start");
  redirect(homePathForRoles(session.roles));
}
