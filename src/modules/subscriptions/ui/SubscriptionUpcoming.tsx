import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import type { SubscriptionApi } from '../useCases/createSubscriptionApi';
import type { SubscriptionCharge, SubscriptionFormOptions } from '../types';
import { useSubscriptionQuery } from '../hooks/useSubscriptionQuery';
import {
  expectedChargeTotal,
  chargeRange,
  groupCharges,
  subscriptionDate,
  subscriptionMoney,
} from '../useCases/subscriptionPresentation';
import {
  Card,
  Chip,
  Message,
  QueryState,
  SButton,
  SText,
  s,
} from './subscriptionDesign';
import { CivilDateField } from './components/CivilDateField';
import { ChargeCard } from './components/SubscriptionCards';

export function SubscriptionUpcoming({
  acquireApi,
  revision,
  options,
  busy,
  onLink,
  onSkip,
}: {
  acquireApi: () => Promise<SubscriptionApi>;
  revision: number;
  options: SubscriptionFormOptions;
  busy: boolean;
  onLink: (charge: SubscriptionCharge) => void;
  onSkip: (charge: SubscriptionCharge) => void;
}) {
  const [days, setDays] = useState<7 | 30 | 'custom'>(7);
  const [range, setRange] = useState(() => chargeRange(7));
  useEffect(() => {
    if (days !== 'custom') setRange(chargeRange(days));
  }, [days, revision]);
  const [page, setPage] = useState(0);
  const query = useCallback(async () => {
    const api = await acquireApi();
    return {
      charges: await api.getUpcomingSubscriptionCharges(range),
      overdue: await api.getOverdueSubscriptionCharges({
        limit: 50,
        offset: page * 50,
      }),
    };
  }, [acquireApi, range, page]);
  const result = useSubscriptionQuery(query, revision);
  const total = result.data ? expectedChargeTotal(result.data.charges) : 0;
  return (
    <>
      <Message text="Una suscripción representa un cobro esperado. SmartFin no descuenta dinero automáticamente." />
      <View style={s.grid}>
        {([7, 30, 'custom'] as const).map(value => (
          <Chip
            key={value}
            label={
              value === 'custom' ? 'Personalizado' : `Próximos ${value} días`
            }
            selected={days === value}
            onPress={() => {
              setDays(value);
              if (value !== 'custom') setRange(chargeRange(value));
            }}
          />
        ))}
      </View>
      {days === 'custom' ? (
        <Card>
          <CivilDateField
            label="Desde"
            value={range.from}
            onChange={from => setRange(current => ({ ...current, from }))}
          />
          <CivilDateField
            label="Hasta (incluido)"
            value={range.to}
            onChange={to => setRange(current => ({ ...current, to }))}
          />
        </Card>
      ) : null}
      <QueryState
        loading={result.loading}
        error={result.error}
        onRetry={() => {
          void result.reload();
        }}
      />
      {result.data && !result.loading && !result.error ? (
        <>
          <Card tint>
            <SText style={s.eyebrow}>COMPROMISOS DEL PERIODO</SText>
            <SText style={s.money}>{subscriptionMoney(total)}</SText>
            <SText>
              {result.data.charges.length} próximos ·{' '}
              {subscriptionDate(range.from)} a {subscriptionDate(range.to)}
            </SText>
          </Card>
          {result.data.overdue.length || page > 0 ? (
            <>
              <SText style={s.heading}>Cobros vencidos sin conciliar</SText>
              {result.data.overdue.map(value => (
                <ChargeCard
                  key={value.id}
                  value={value}
                  options={options}
                  busy={busy}
                  onLink={() => onLink(value)}
                  onSkip={() => onSkip(value)}
                />
              ))}
              <View style={s.grid}>
                {page > 0 ? (
                  <SButton
                    label="Vencidos anteriores"
                    secondary
                    onPress={() => setPage(value => value - 1)}
                  />
                ) : null}
                {result.data.overdue.length === 50 ? (
                  <SButton
                    label="Más vencidos"
                    secondary
                    onPress={() => setPage(value => value + 1)}
                  />
                ) : null}
              </View>
            </>
          ) : null}
          {groupCharges(result.data.charges).map(group => (
            <View key={group.date} style={s.stack}>
              <SText style={s.heading}>
                {subscriptionDate(group.date, true)}
              </SText>
              {group.items.map(value => (
                <ChargeCard
                  key={value.id}
                  value={value}
                  options={options}
                  busy={busy}
                  onLink={() => onLink(value)}
                  onSkip={() => onSkip(value)}
                />
              ))}
            </View>
          ))}
          {!result.data.charges.length ? (
            <Message text="No hay cobros próximos dentro de este periodo." />
          ) : null}
        </>
      ) : null}
    </>
  );
}
