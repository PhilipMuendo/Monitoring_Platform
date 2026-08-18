"use client";

import { ShieldAlert } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertSettingsForm } from "@/components/admin/alert-settings-form";
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="alerts">Alert rules</TabsTrigger>
        </TabsList>
        <TabsContent value="sites" className="pt-4">
          <SitesAdminTable />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <UsersAdminTable />
        </TabsContent>
        <TabsContent value="alerts" className="pt-4">
          <AlertSettingsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
