export type DashboardModuleSummary = {
  id: string;
  title: string;
  description: string;
};

export type DashboardSummary = {
  currency: string;
  currentBalance: number;
  modules: DashboardModuleSummary[];
};
