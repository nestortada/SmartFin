import type { CurrencyCode } from '../../../shared/types';

export type DashboardModuleSummary = {
  id: string;
  title: string;
  description: string;
};

export type DashboardSummary = {
  currency: CurrencyCode;
  availableBalance: number;
  totalDebt: number;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  recentTransactionCount: number;
  modules: DashboardModuleSummary[];
};
