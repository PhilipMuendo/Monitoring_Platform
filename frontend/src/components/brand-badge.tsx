import { Badge } from "@/components/ui/badge";
import { BRAND_LABEL } from "@/lib/format";
import type { Brand } from "@/lib/types";

export function BrandBadge({ brand }: { brand: Brand }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {BRAND_LABEL[brand] ?? brand}
    </Badge>
  );
}
