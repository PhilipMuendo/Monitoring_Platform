"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";

export function PowerFlowViewToggle({
  mode,
  onChange,
}: {
  mode: PowerFlowViewMode;
  onChange: (mode: PowerFlowViewMode) => void;
}) {
  return (
    <Tabs value={mode} onValueChange={(v) => onChange(v as PowerFlowViewMode)}>
      <TabsList className="h-8">
        <TabsTrigger value="2d" className="text-xs">
          2D
        </TabsTrigger>
        <TabsTrigger value="3d" className="text-xs">
          3D
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
