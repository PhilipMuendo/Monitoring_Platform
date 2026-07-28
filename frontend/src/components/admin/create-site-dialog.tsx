"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSite } from "@/hooks/use-admin";
import { ApiError } from "@/lib/api-client";
import type { Brand } from "@/lib/types";

const EMPTY_FORM = {
  name: "",
  brand: "deye" as Brand,
  brand_site_id: "",
  location: "",
  capacity_kw: "",
  installer_account_id: "",
};

export function CreateSiteDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const createSite = useCreateSite();

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createSite.mutateAsync({
        name: form.name,
        brand: form.brand,
        brand_site_id: form.brand_site_id,
        location: form.location,
        capacity_kw: Number(form.capacity_kw) || 0,
        installer_account_id: form.installer_account_id || undefined,
      });
      toast.success("Site created");
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create site");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a new site</DialogTitle>
          <DialogDescription>
            The brand + site ID must match what that brand&apos;s monitoring API reports, or readings won&apos;t match up.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Site name</Label>
            <Input id="name" required value={form.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Brand</Label>
              <Select value={form.brand} onValueChange={(v) => update("brand", v as Brand)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deye">Deye</SelectItem>
                  <SelectItem value="ingecon">Ingecon</SelectItem>
                  <SelectItem value="sosen">Sosen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand_site_id">Brand site ID</Label>
              <Input
                id="brand_site_id"
                required
                value={form.brand_site_id}
                onChange={(e) => update("brand_site_id", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" value={form.location} onChange={(e) => update("location", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="capacity_kw">Capacity (kW)</Label>
              <Input
                id="capacity_kw"
                type="number"
                step="0.1"
                min="0"
                required
                value={form.capacity_kw}
                onChange={(e) => update("capacity_kw", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="installer_account_id">Installer account (optional)</Label>
              <Input
                id="installer_account_id"
                value={form.installer_account_id}
                onChange={(e) => update("installer_account_id", e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createSite.isPending}>
              Create site
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
