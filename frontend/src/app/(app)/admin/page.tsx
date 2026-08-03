"use client";

import { ShieldAlert } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SitesAdminTable } from "@/components/admin/sites-admin-table";
import { UsersAdminTable } from "@/components/admin/users-admin-table";
import { useAuth } from "@/lib/auth-context";

export default function AdminPage() {
  const { hasRole } = useAuth();

  if (!hasRole("admin")) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <ShieldAlert className="size-8" />
        <p>You need admin access to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Administration</h1>
        <p className="label-caps mt-0.5 text-tiny text-muted-foreground">Fleet configuration &amp; access control</p>
      </div>
      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="sites" className="pt-4">
          <SitesAdminTable />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <UsersAdminTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
