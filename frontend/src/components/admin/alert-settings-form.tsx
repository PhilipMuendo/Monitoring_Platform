"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlertSettings, useUpdateAlertSettings, type AlertSettings } from "@/hooks/use-admin";
import { ApiError } from "@/lib/api-client";

type Editable = Omit<AlertSettings, "updated_at" | "derived">;

/** Form state is strings, so a half-typed number never becomes NaN mid-keystroke. */
type FormState = Record<keyof Editable, string>;

const FIELD_ORDER: (keyof Editable)[] = [
  "production_drop_threshold_w",
  "production_recover_threshold_w",
  "production_drop_window_seconds",
  "production_drop_cooldown_seconds",
  "production_edge_margin_seconds",
  "offline_threshold_seconds",
  "offline_cooldown_seconds",
  "fault_cooldown_seconds",
  "battery_window_seconds",
  "battery_soc_threshold_pct",
  "battery_soc_recover_pct",
  "battery_cooldown_seconds",
];

function toForm(s: AlertSettings): FormState {
  return Object.fromEntries(FIELD_ORDER.map((k) => [k, String(s[k])])) as FormState;
}

/** Minutes are what operators think in; the API speaks seconds. */
function minutes(seconds: string): string {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const m = n / 60;
  if (m < 60) return `${Number(m.toFixed(1))} min`;
  return `${Number((m / 60).toFixed(1))} h`;
}

interface FieldProps {
  id: keyof Editable;
  label: string;
  hint: string;
  unit: string;
  form: FormState;
  set: (k: keyof Editable, v: string) => void;
}

function Field({ id, label, hint, unit, form, set }: FieldProps) {
  const isSeconds = id.endsWith("_seconds");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          value={form[id]}
          onChange={(e) => set(id, e.target.value)}
          className="max-w-36"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {unit}
          {isSeconds && ` · ${minutes(form[id])}`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

/**
 * Editor for the fleet-wide alert policy.
 *
 * Two things about this form are deliberate and easy to "tidy" away:
 *
 * 1. WINDOWS ARE DURATIONS. The engine works in counts of consecutive
 *    readings, but a count only means something next to POLL_INTERVAL — six
 *    readings is half an hour at a 5-minute poll and twelve minutes at two.
 *    An operator states a duration; the backend re-derives the count. The
 *    derived count is shown beside the field so that conversion is visible
 *    rather than a hidden behaviour change.
 *
 * 2. VALIDATION IS THE SERVER'S. This form does no threshold checking of its
 *    own. The rules are relational (each hysteresis band, both windows against
 *    the live poll interval) and the server has to enforce them anyway; a
 *    second copy here would be the copy that drifts. The server returns every
 *    problem at once, so a rejected save names all of them together.
 */
export function AlertSettingsForm() {
  const { data, isLoading, isError } = useAlertSettings();
  const update = useUpdateAlertSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  // Seed the form when the settings arrive, and re-seed after a save so the
  // inputs show exactly what was stored (the server may normalise).
  //
  // Adjusted DURING RENDER rather than in an effect. React documents this as
  // the way to reset state when a prop changes, and it is the better fit
  // twice over: `react-hooks/set-state-in-effect` forbids the effect version,
  // and keying on updated_at means a background refetch that returns the same
  // row leaves a half-typed form alone instead of wiping the operator's edits
  // mid-keystroke.
  if (data && seededFrom !== data.updated_at) {
    setSeededFrom(data.updated_at);
    setForm(toForm(data));
  }

  if (isLoading || !form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-sm text-destructive">Could not load alert settings.</p>;
  }

  const set = (k: keyof Editable, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const dirty = FIELD_ORDER.some((k) => form[k] !== String(data[k]));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const payload = Object.fromEntries(FIELD_ORDER.map((k) => [k, Number(form[k])])) as Editable;
    if (FIELD_ORDER.some((k) => !Number.isFinite(payload[k]))) {
      toast.error("Every field must be a number");
      return;
    }

    try {
      await update.mutateAsync(payload);
      toast.success("Alert settings saved — in effect from the next collection cycle");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save alert settings");
    }
  }

  const pollMinutes = Math.round(data.derived.poll_interval_seconds / 60);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Applied on the next collection cycle — no restart needed. The collector currently polls every{" "}
        <span className="font-medium text-foreground">{pollMinutes} min</span>, which is what the two
        windows below are converted against.
      </p>

      <Section
        title="Production drop"
        description="Fires when output stays low through daylight. The gap between the two thresholds is the hysteresis band that stops the alert flapping — the recover value must be the higher of the two."
      >
        <Field id="production_drop_threshold_w" label="Fire below" unit="W" form={form} set={set}
          hint="Output under this counts as a low reading." />
        <Field id="production_recover_threshold_w" label="Recover above" unit="W" form={form} set={set}
          hint="Must exceed the fire threshold. Set it well clear — irradiance noise on a cloudy day is large." />
        <Field id="production_drop_window_seconds" label="Sustained for" unit="s" form={form} set={set}
          hint={`Every reading in this window must be low before anyone is told — currently ${data.derived.production_drop_window_readings} readings at a ${pollMinutes} min poll.`} />
        <Field id="production_drop_cooldown_seconds" label="Cooldown" unit="s" form={form} set={set}
          hint="Minimum gap before this alert can be raised again for the same site." />
        <Field id="production_edge_margin_seconds" label="Ignore around dawn/dusk" unit="s" form={form} set={set}
          hint="Excluded from judgement at each end of the day. A working array crosses any low threshold twice daily on its way up and down." />
      </Section>

      <Section
        title="Offline"
        description="Fires when a site stops reporting. No hysteresis band — 'we received a reading' is unambiguous in a way that 'output is low' is not."
      >
        <Field id="offline_threshold_seconds" label="No data for" unit="s" form={form} set={set}
          hint="Must be at least twice the poll interval, or every site alerts on every cycle." />
        <Field id="offline_cooldown_seconds" label="Cooldown" unit="s" form={form} set={set}
          hint="Minimum gap before re-alerting the same site." />
      </Section>

      <Section title="Inverter fault" description="Raised from the inverter's own fault code, and cleared when it stops reporting one.">
        <Field id="fault_cooldown_seconds" label="Cooldown" unit="s" form={form} set={set}
          hint="Minimum gap before re-alerting the same site." />
      </Section>

      <Section
        title="Battery"
        description="Fires on sustained low state of charge. Same hysteresis idea as production: without a gap, a battery trickle-charging across the threshold alerts over and over."
      >
        <Field id="battery_soc_threshold_pct" label="Fire below" unit="%" form={form} set={set}
          hint="State of charge under this counts as low." />
        <Field id="battery_soc_recover_pct" label="Recover above" unit="%" form={form} set={set}
          hint="Must exceed the fire threshold." />
        <Field id="battery_window_seconds" label="Sustained for" unit="s" form={form} set={set}
          hint={`Currently ${data.derived.battery_window_readings} readings at a ${pollMinutes} min poll.`} />
        <Field id="battery_cooldown_seconds" label="Cooldown" unit="s" form={form} set={set}
          hint="Minimum gap before re-alerting the same site." />
      </Section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || update.isPending}
          onClick={() => setForm(toForm(data))}
        >
          Reset
        </Button>
        <span className="text-xs text-muted-foreground">
          Last updated {new Date(data.updated_at).toLocaleString()}
        </span>
      </div>
    </form>
  );
}
