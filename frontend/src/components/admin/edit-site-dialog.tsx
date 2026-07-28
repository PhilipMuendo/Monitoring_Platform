"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateSite } from "@/hooks/use-admin";
import { ApiError } from "@/lib/api-client";
import type { SiteWithStatus } from "@/lib/types";

export function EditSiteDialog({ site }: { site: SiteWithStatus }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(site.name);
  const [location, setLocation] = useState(site.location);
  const [capacityKw, setCapacityKw] = useState(String(site.capacity_kw));
  const [isActive, setIsActive] = useState(site.is_active);
  const updateSite = useUpdateSite(site.id);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateSite.mutateAsync({
        name,
        location,
        capacity_kw: Number(capacityKw) || undefined,
        is_active: isActive,
      });
      toast.success("Site updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update site");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {site.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Site name</Label>
            <Input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-location">Location</Label>
            <Input id="edit-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-capacity">Capacity (kW)</Label>
            <Input
              id="edit-capacity"
              type="number"
              step="0.1"
              min="0"
              value={capacityKw}
              onChange={(e) => setCapacityKw(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="edit-active">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive sites are excluded from collection and the dashboard.</p>
            </div>
            <Switch id="edit-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateSite.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
