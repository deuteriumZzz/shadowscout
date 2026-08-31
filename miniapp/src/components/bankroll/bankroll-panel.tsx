"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ShieldCheck, ShieldOff, Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/status-state";
import { useBankroll, useSetBankroll } from "@/hooks/use-shadowscout";
import { formatMoney, formatPct } from "@/lib/format";

const schema = z.object({
  capital: z.coerce.number().positive("Сумма должна быть больше нуля"),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

function BankrollForm({ initial, onDone }: { initial?: number; onDone: () => void }) {
  const setBankroll = useSetBankroll();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initial ? { capital: initial } : undefined,
  });

  async function onSubmit(values: FormOutput) {
    await setBankroll.mutateAsync(values.capital);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="capital">Сумма банкролла</Label>
        <Input id="capital" type="number" step="0.01" inputMode="decimal" {...register("capital")} />
        {errors.capital && <p className="text-xs text-destructive">{errors.capital.message}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={setBankroll.isPending} className="w-full">
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BankrollPanel() {
  const { data, isPending, isError, error, refetch } = useBankroll();
  const [open, setOpen] = useState(false);

  if (isPending) return <LoadingState label="Загружаю банкролл…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  if (!data) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<Wallet className="size-6 text-muted-foreground" />}
          title="Банкролл не задан"
          description="Без него бот не считает размер ставки — задайте сумму, чтобы включить рекомендации по стейку."
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button className="w-full" />}>Задать банкролл</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Банкролл</DialogTitle>
            </DialogHeader>
            <BankrollForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const drawdownRatio = data.stop_loss_pct > 0 ? Math.min(100, (data.drawdown_pct / data.stop_loss_pct) * 100) : 0;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Капитал</span>
          {data.stopped ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
              <ShieldOff className="size-3.5" /> Остановлено
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <ShieldCheck className="size-3.5" /> Активно
            </span>
          )}
        </div>
        <p className="font-mono tabular-nums text-3xl font-semibold">{formatMoney(data.capital)}</p>
        <p className="text-xs text-muted-foreground">Пик: {formatMoney(data.peak)}</p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Просадка от пика</span>
            <span className="font-mono tabular-nums">
              {formatPct(data.drawdown_pct)} / стоп {formatPct(data.stop_loss_pct)}
            </span>
          </div>
          <Progress value={drawdownRatio} className={data.drawdown_stopped ? "[&>div]:bg-destructive" : ""} />
        </div>

        {data.clv_gated && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              Средний CLV за последние рекомендации {formatPct(data.clv_gate_avg, { signed: true })} — модель
              систематически проигрывает закрывающей линии, новые ставки не предлагаются.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-sm text-muted-foreground">Ставка сейчас</span>
          <span className="font-mono tabular-nums text-base font-medium">
            {data.stopped ? "—" : formatMoney(data.suggested_stake)}
          </span>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="secondary" className="w-full" />}>
          Изменить банкролл
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Банкролл</DialogTitle>
          </DialogHeader>
          <BankrollForm initial={data.capital} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
