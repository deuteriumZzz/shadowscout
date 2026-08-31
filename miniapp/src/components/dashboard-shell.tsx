"use client";

import { BarChart3, History as HistoryIcon, Settings, Target, Wallet } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PicksFeed } from "@/components/picks/picks-feed";
import { BankrollPanel } from "@/components/bankroll/bankroll-panel";
import { StatsPanel } from "@/components/stats/stats-panel";
import { HistoryTable } from "@/components/history/history-table";
import { SettingsForm } from "@/components/settings/settings-form";

const TABS = [
  { value: "feed", label: "Лента", icon: Target },
  { value: "bankroll", label: "Банкролл", icon: Wallet },
  { value: "stats", label: "Статистика", icon: BarChart3 },
  { value: "history", label: "История", icon: HistoryIcon },
  { value: "settings", label: "Настройки", icon: Settings },
] as const;

export function DashboardShell() {
  return (
    <Tabs defaultValue="feed" className="flex flex-col h-dvh min-h-0">
      <header className="relative shrink-0 overflow-hidden border-b border-border">
        <div className="pitch-texture absolute inset-0 pointer-events-none" />
        <div className="relative px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="size-5 text-primary shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9.2" />
            <path d="M12 7.2 15.4 9.7 14.1 13.7H9.9L8.6 9.7Z" />
            <path d="M12 7.2V4.4M15.4 9.7 18 7.9M14.1 13.7 15.4 17.2M9.9 13.7 8.6 17.2M8.6 9.7 6 7.9" />
          </svg>
          <span className="font-semibold tracking-tight">shadowscout</span>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <TabsContent value="feed" className="m-0">
          <PicksFeed />
        </TabsContent>
        <TabsContent value="bankroll" className="m-0">
          <BankrollPanel />
        </TabsContent>
        <TabsContent value="stats" className="m-0">
          <StatsPanel />
        </TabsContent>
        <TabsContent value="history" className="m-0">
          <HistoryTable />
        </TabsContent>
        <TabsContent value="settings" className="m-0">
          <SettingsForm />
        </TabsContent>
      </div>

      <TabsList className="shrink-0 h-auto w-full justify-between gap-0 rounded-none border-t border-border bg-card px-1 pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {TABS.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="flex-1 flex-col gap-1 h-14 rounded-lg data-active:bg-secondary data-active:shadow-none"
          >
            <Icon className="size-5" />
            <span className="text-[10px] leading-none">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
