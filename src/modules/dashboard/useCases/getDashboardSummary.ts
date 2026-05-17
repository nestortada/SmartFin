import type { DashboardSummary } from '../types/DashboardSummary';

export function getDashboardSummary(): DashboardSummary {
  return {
    currency: 'USD',
    currentBalance: 0,
    modules: [
      {
        id: 'transactions',
        title: 'Transacciones',
        description: 'Registro offline de ingresos, gastos y transferencias.',
      },
      {
        id: 'accounts',
        title: 'Cuentas',
        description: 'Saldos locales por efectivo, bancos y billeteras.',
      },
      {
        id: 'budgets',
        title: 'Presupuestos',
        description: 'Limites mensuales por categoria sin exponer datos.',
      },
      {
        id: 'reports',
        title: 'Reportes',
        description: 'Lecturas financieras calculadas desde casos de uso.',
      },
    ],
  };
}
