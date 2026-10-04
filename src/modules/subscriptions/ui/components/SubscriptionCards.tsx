import React from 'react';
import { Pressable, View } from 'react-native';
import type {
  Subscription,
  SubscriptionCharge,
  SubscriptionFormOptions,
} from '../../types';
import {
  recurrenceLabel,
  subscriptionDate,
  subscriptionMoney,
} from '../../useCases/subscriptionPresentation';
import {
  Card,
  SButton,
  SIcon,
  SText,
  Status,
  s,
  useSubscriptionPalette,
} from '../subscriptionDesign';

export function SubscriptionCard({
  value,
  options,
  onPress,
}: {
  value: Subscription;
  options: SubscriptionFormOptions;
  onPress: () => void;
}) {
  const p = useSubscriptionPalette();
  const account = options.accounts.find(item => item.id === value.accountId);
  const category = options.categories.find(
    item => item.id === value.categoryId,
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver ${value.name}`}
      onPress={onPress}
    >
      <Card>
        <View style={s.row}>
          <View style={[s.serviceIcon, { backgroundColor: p.raised }]}>
            <SIcon name="subscriptions" color={p.secondary} />
          </View>
          <View style={s.flex}>
            <SText style={s.heading}>{value.name}</SText>
            <SText style={{ color: p.muted }}>
              {category?.name ? `${category.name} · ` : ''}
              {recurrenceLabel(value.recurrence)}
            </SText>
          </View>
          <SText style={[s.amount, { maxWidth: '42%', textAlign: 'right' }]}>
            {subscriptionMoney(value.amount)}
          </SText>
        </View>
        <View style={s.between}>
          <View style={s.flex}>
            <SText style={[s.label, { color: p.muted }]}>
              {account?.name ??
                (value.accountId
                  ? 'Cuenta no disponible'
                  : 'Sin cuenta asignada')}
            </SText>
            <SText style={[s.label, { color: p.muted }]}>
              {value.status === 'active' && value.nextChargeDate
                ? `Próx. ${subscriptionDate(value.nextChargeDate)}`
                : value.status === 'paused'
                ? 'Cobros futuros en pausa'
                : 'Historial conservado'}
            </SText>
          </View>
          <Status status={value.status} />
        </View>
      </Card>
    </Pressable>
  );
}
export function ChargeCard({
  value,
  options,
  busy,
  onLink,
  onSkip,
}: {
  value: SubscriptionCharge;
  options: SubscriptionFormOptions;
  busy: boolean;
  onLink: () => void;
  onSkip: () => void;
}) {
  const p = useSubscriptionPalette();
  return (
    <Card>
      <View style={s.row}>
        <SIcon
          name={value.status === 'overdue' ? 'event-busy' : 'event-repeat'}
          color={value.status === 'overdue' ? p.danger : p.primary}
        />
        <View style={s.flex}>
          <SText style={s.heading}>{value.subscriptionName}</SText>
          <SText style={[s.label, { color: p.muted }]}>
            {subscriptionDate(value.expectedDate)} ·{' '}
            {options.accounts.find(item => item.id === value.accountId)?.name ??
              'Sin cuenta asignada'}
          </SText>
        </View>
        <SText style={[s.amount, { maxWidth: '42%', textAlign: 'right' }]}>
          {subscriptionMoney(value.expectedAmount)}
        </SText>
      </View>
      <Status status={value.status} />
      {value.status === 'overdue' ? (
        <SText style={{ color: p.muted }}>
          Cobro esperado sin movimiento vinculado.
        </SText>
      ) : null}
      <View style={s.row}>
        <View style={s.flex}>
          <SButton
            label="Saltar"
            secondary
            icon="skip-next"
            disabled={busy}
            onPress={onSkip}
          />
        </View>
        <View style={s.flex}>
          <SButton
            label="Vincular"
            icon="link"
            disabled={busy}
            onPress={onLink}
          />
        </View>
      </View>
    </Card>
  );
}
