import React from 'react';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { SectionList, StyleSheet, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import { TransactionsScreen } from '../src/modules/transactions/ui/TransactionsScreen';
import { TransactionCard } from '../src/modules/transactions/ui/components/TransactionCard';
import { AddTransactionModal } from '../src/modules/transactions/ui/components/AddTransactionModal';
import { CategorizationModal } from '../src/modules/transactions/ui/components/CategorizationModal';
import {
  AccountPickerModal,
  CategoryPickerModal,
  InlineOpTypeModal,
  InstallmentPickerModal,
  MonthPickerModal,
} from '../src/modules/transactions/ui/components/FilterModals';
import type { Transaction } from '../src/modules/transactions/types';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 20, left: 0 }),
}));

type Row = Record<string, SQLitePrimitive>;

function movement(id: string, date: string, overrides: Row = {}): Row {
  return {
    id,
    date,
    amount: 15000,
    currency: 'COP',
    description: `Compra ${id}`,
    account_id: 'bank-a',
    category_id: 'food',
    subcategory_id: null,
    type: 'expense',
    direction: 'outflow',
    status: 'posted',
    target_account_id: null,
    merchant_name: `Comercio ${id}`,
    payment_method: 'debit',
    credit_card_hint: null,
    dedupe_key: null,
    notes: null,
    created_at: date,
    updated_at: date,
    ...overrides,
  };
}

const fixtures = [
  movement('late', '2026-10-10T23:59:59.000Z', {
    payment_method: 'credit',
    notes: 'Crédito • Cuotas: 3',
  }),
  movement('early', '2026-10-10T00:00:00.000Z', { account_id: 'bank-b' }),
  movement('yesterday', '2026-10-09T23:59:59.000Z', { category_id: 'other' }),
  movement('september', '2026-09-30T23:59:59.000Z'),
];

async function setup(rows: Row[] = fixtures) {
  const sqlite = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sqlite.native.exec(statement);
  for (const suffix of ['a', 'b']) sqlite.native.prepare(
    'INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('bank-' + suffix, 'Banco ' + suffix, 'bankAccount', 'active', 'COP', 50000, '2026-01-01', '2026-01-01');
  for (const [id, name] of [['food', 'Alimentación'], ['other', 'Otros']])
    sqlite.native.prepare('INSERT INTO categories (id,name,type,macro_category,color) VALUES (?,?,?,?,?)')
      .run(id ?? '', name ?? '', 'expense', id ?? '', '#cdbdff');
  for (const row of rows) {
    const keys = Object.keys(row);
    sqlite.native.prepare('INSERT INTO transactions (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')')
      .run(...keys.map(key => row[key] ?? null));
  }
  const executeSql = jest.fn((sql: string, values: SQLitePrimitive[] = []) => sqlite.database.executeSql(sql, values));
  const database = { ...sqlite.database, executeSql } as unknown as SmartFinSQLiteDatabase;
  const props = {
    activeTheme: 'dark' as const,
    database,
    onNavigateToHome: jest.fn(),
    onOpenCreditCards: jest.fn(),
    onOpenDebitCards: jest.fn(),
    onOpenSettings: jest.fn(),
    onForceRefresh: jest.fn(),
  };
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<TransactionsScreen {...props} />);
  });
  if (!renderer) throw new Error('Renderer missing');
  const view = renderer;
  const ids = () =>
    view.root.findAllByType(TransactionCard).map(card => card.props.tx.id);
  return {
    view,
    props,
    executeSql,
    ids,
    close: () => { act(() => view.unmount()); sqlite.native.close(); },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
});

test('date sections preserve order, labels, stable keys and existing spacing', async () => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
  const f = await setup();
  try {
    const list = f.view.root.findByType(SectionList);
    expect(
      list.props.sections.map(
        (section: { date: string; key: string; data: Transaction[] }) => ({
          date: section.date,
          key: section.key,
          ids: section.data.map(tx => tx.id),
        }),
      ),
    ).toEqual([
      { date: '2026-10-10', key: '2026-10-10', ids: ['late', 'early'] },
      { date: '2026-10-09', key: '2026-10-09', ids: ['yesterday'] },
      { date: '2026-09-30', key: '2026-09-30', ids: ['september'] },
    ]);
    expect(f.ids()).toEqual(['late', 'early', 'yesterday', 'september']);
    expect(list.props.keyExtractor(list.props.sections[0].data[0], 0)).toBe(
      'late',
    );
    expect(list.props.stickySectionHeadersEnabled).toBe(false);
    for (const [index, section] of list.props.sections.entries()) {
      const header = list.props.renderSectionHeader({ section });
      expect(header.props.children).toBe(
        ['HOY', 'AYER', '30 DE SEP DE 2026'][index],
      );
      expect(StyleSheet.flatten(header.props.style)).toMatchObject({
        marginBottom: 12,
      });
    }
    const separator = list.props.ItemSeparatorComponent();
    expect(StyleSheet.flatten(separator.props.style).height).toBe(12);
    const firstFooter = list.props.renderSectionFooter({
      section: list.props.sections[0],
    });
    const lastFooter = list.props.renderSectionFooter({
      section: list.props.sections[2],
    });
    expect(StyleSheet.flatten(firstFooter.props.style).height).toBe(38);
    expect(StyleSheet.flatten(lastFooter.props.style).height).toBe(20);
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
      paddingTop: 12,
      paddingHorizontal: 20,
      paddingBottom: 140,
    });
    expect(
      StyleSheet.flatten(list.props.contentContainerStyle).gap,
    ).toBeUndefined();
  } finally {
    f.close();
    jest.useRealTimers();
  }
});

test('search, account, category, month and sorting retain the real hook behavior', async () => {
  const f = await setup();
  try {
    const search = f.view.root.findByProps({
      placeholder: 'Buscar por comercio, notas...',
    });
    expect(search.type).toBe(TextInput);
    await act(async () => search.props.onChangeText('cuotas'));
    expect(f.ids()).toEqual(['late']);
    await act(async () => search.props.onChangeText(''));
    await act(async () =>
      f.view.root
        .findByType(AccountPickerModal)
        .props.onSelectAccount('bank-b'),
    );
    expect(f.ids()).toEqual(['early']);
    await act(async () =>
      f.view.root.findByType(AccountPickerModal).props.onSelectAccount('all'),
    );
    await act(async () =>
      f.view.root
        .findByType(CategoryPickerModal)
        .props.onSelectCategory('other'),
    );
    expect(f.ids()).toEqual(['yesterday']);
    await act(async () =>
      f.view.root.findByType(CategoryPickerModal).props.onSelectCategory('all'),
    );
    await act(async () =>
      f.view.root.findByType(MonthPickerModal).props.onSelectMonth('2026-09'),
    );
    expect(f.ids()).toEqual(['september']);
    await act(async () =>
      f.view.root.findByType(MonthPickerModal).props.onSelectMonth('all'),
    );
    let sort = f.view.root
      .findAllByType(Text)
      .find(text => text.props.children === 'Recientes Primero');
    while (sort && typeof sort.props.onPress !== 'function') {
      sort = sort.parent ?? undefined;
    }
    if (!sort) throw new Error('Sort button missing');
    await act(async () => sort.props.onPress());
    expect(f.ids()).toEqual(['september', 'yesterday', 'early', 'late']);
    expect(
      f.view.root
        .findByType(SectionList)
        .props.sections.map((section: { date: string }) => section.date),
    ).toEqual(['2026-09-30', '2026-10-09', '2026-10-10']);
    await act(async () => search.props.onChangeText('sin coincidencias'));
    expect(f.ids()).toEqual([]);
    expect(
      f.view.root
        .findAllByType(Text)
        .some(text => text.props.children === 'No se encontraron movimientos'),
    ).toBe(true);
    expect(
      f.executeSql.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql)),
    ).toBe(true);
  } finally {
    f.close();
  }
});

test('individual cards retain categorization, editing, installments and operation actions', async () => {
  const f = await setup();
  try {
    const card = f.view.root.findAllByType(TransactionCard)[0];
    if (!card) throw new Error('Transaction card missing');
    const tx: Transaction = card.props.tx;
    await act(async () => card.props.onPress(tx));
    const categorization = f.view.root.findByType(CategorizationModal);
    expect(categorization.props.visible).toBe(true);
    expect(categorization.props.tx).toBe(tx);
    await act(async () => categorization.props.onEditTransaction(tx));
    expect(f.view.root.findByType(AddTransactionModal).props.visible).toBe(
      true,
    );
    await act(async () =>
      f.view.root.findByType(AddTransactionModal).props.onClose(),
    );
    await act(async () => card.props.onEditInstallments(tx));
    expect(f.view.root.findByType(InstallmentPickerModal).props.tx).toBe(tx);
    expect(
      f.view.root.findByType(InstallmentPickerModal).props.installmentCount,
    ).toBe('3');
    await act(async () =>
      f.view.root.findByType(InstallmentPickerModal).props.onClose(),
    );
    await act(async () => card.props.onShowOpTypeDropdown(tx));
    expect(f.view.root.findByType(InlineOpTypeModal).props.tx).toBe(tx);
    await act(async () =>
      f.view.root.findByType(InlineOpTypeModal).props.onClose(),
    );
    await act(async () =>
      f.view.update(<TransactionsScreen {...f.props} activeTheme="light" />),
    );
    expect(
      f.view.root
        .findAllByType(TransactionCard)
        .every(item => item.props.isDark === false),
    ).toBe(true);
    expect(f.ids()).toEqual(['late', 'early', 'yesterday', 'september']);
  } finally {
    f.close();
  }
});

test('an empty database renders the existing empty state without date sections', async () => {
  const f = await setup([]);
  try {
    expect(f.view.root.findByType(SectionList).props.sections).toEqual([]);
    expect(f.ids()).toEqual([]);
    expect(
      f.view.root
        .findAllByType(Text)
        .some(text => text.props.children === 'No se encontraron movimientos'),
    ).toBe(true);
  } finally {
    f.close();
  }
});

test('a thousand movements in one day are individual virtualized items', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) =>
    movement(
      `large-${index}`,
      new Date(Date.UTC(2026, 9, 10, 0, 0, index)).toISOString(),
    ),
  );
  const f = await setup(rows);
  try {
    const list = f.view.root.findByType(SectionList);
    expect(list.props.sections).toHaveLength(1);
    expect(list.props.sections[0].data).toHaveLength(50);
    await act(async () => list.props.onEndReached());
    expect(f.view.root.findByType(SectionList).props.sections[0].data).toHaveLength(100);
    expect(f.ids().length).toBeGreaterThan(0);
    expect(f.ids().length).toBeLessThan(1000);
    expect(f.ids()[0]).toBe('large-999');
    await act(async () =>
      f.view.root
        .findByProps({ placeholder: 'Buscar por comercio, notas...' })
        .props.onChangeText('Comercio large-0'),
    );
    expect(f.ids()).toEqual(['large-0']);
  } finally {
    f.close();
  }
});
