"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { useUsers } from "@/hooks/use-admin";
import { formatRelativeTime } from "@/lib/format";

export function UsersAdminTable() {
  const { data: users, isLoading } = useUsers();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="label-caps text-xs font-semibold text-muted-foreground">Staff Accounts</h2>
        <CreateUserDialog />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <Table className="border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="capitalize">
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>{user.is_active ? "Active" : "Disabled"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(user.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
