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
  monthlyForgivenessLosses: number;
  monthlyLossReversals: number;
  monthlyLossRecoveries: number;
  monthlyRecoveryReversals: number;
  monthlyNetLosses: number;
  recentTransactionCount: number;
  modules: DashboardModuleSummary[];
};
