import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  sublabel?: string;
  colorClass?: string;
  bgClass?: string;
}

export function KpiCard({ icon: Icon, label, value, sublabel, colorClass = "text-primary", bgClass = "bg-primary/10" }: KpiCardProps) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", bgClass)}>
          <Icon className={cn("size-5", colorClass)} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate font-mono text-xl font-semibold tabular-nums">{value}</div>
          {sublabel && <div className="truncate text-xs text-muted-foreground">{sublabel}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
