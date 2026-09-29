import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { AppProvider } from "@/components/app-context";
import { AppShell } from "@/components/app-shell";

/** Every signed-in screen: session check once here, then the shared shell (tab bar / sidebar). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <AppProvider user={{ id: session.user.id, name: session.user.name ?? "Plandit 사용자", email: session.user.email ?? "" }}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
