import { dashboardFixture } from './dashboardFixture';
import { historySeedStatements, type HistoryDistribution } from './historyDistributionSql';

export { HISTORY_DISTRIBUTIONS, historySeedStatements, type HistoryDistribution } from './historyDistributionSql';

export async function historyFixture(distribution: HistoryDistribution, size: number) {
  const fixture = await dashboardFixture();
  for (const statement of historySeedStatements(distribution, size)) fixture.native.exec(statement);
  return fixture;
}
