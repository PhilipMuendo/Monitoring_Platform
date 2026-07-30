import { BRAND_LABEL } from "@/lib/format";
import type { Brand } from "@/lib/types";

export function BrandBadge({ brand }: { brand: Brand }) {
  return (
    <span className="label-caps inline-flex h-4.5 shrink-0 items-center border border-border px-1.5 text-[10px] font-semibold text-muted-foreground">
      {BRAND_LABEL[brand] ?? brand}
    </span>
  );
}
