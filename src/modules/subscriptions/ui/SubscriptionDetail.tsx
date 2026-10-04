import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { SubscriptionApi } from '../useCases/createSubscriptionApi';
import type {
  Subscription,
  SubscriptionCharge,
  SubscriptionFormOptions,
  SubscriptionHistoryItem,
} from '../types';
import { useSubscriptionQuery } from '../hooks/useSubscriptionQuery';
import {
  recurrenceLabel,
  SKIP_LABELS,
  subscriptionDate,
  subscriptionMoney,
} from '../useCases/subscriptionPresentation';
import {
  Card,
  Message,
  QueryState,
  SButton,
  SIcon,
  SText,
  Status,
  s,
  useSubscriptionPalette,
} from './subscriptionDesign';

export function SubscriptionDetail({
  value,
  options,
  acquireApi,
  revision,
  busy,
  onEdit,
  onStatus,
  onLink,
  onSkip,
  onMovement,
  onEditAmount,
}: {
  value: Subscription;
  options: SubscriptionFormOptions;
  acquireApi: () => Promise<SubscriptionApi>;
  revision: number;
  busy: boolean;
  onEdit: () => void;
  onStatus: (action: 'pause' | 'resume' | 'cancel') => void;
  onLink: (charge: SubscriptionCharge) => void;
  onSkip: (charge: SubscriptionCharge) => void;
  onMovement: (item: SubscriptionHistoryItem) => void;
  onEditAmount: (charge: SubscriptionCharge) => void;
}) {
  const p = useSubscriptionPalette();
  const [page, setPage] = useState(0);
  const query = useCallback(async () => {
    const api = await acquireApi();
    return api.getSubscriptionHistory(value.id, {
      limit: 50,
      offset: page * 50,
    });
  }, [acquireApi, value.id, page]);
  const result = useSubscriptionQuery(query, revision);
  const account = options.accounts.find(item => item.id === value.accountId);
  const category = options.categories.find(
    item => item.id === value.categoryId,
  );
  const subcategory = options.subcategories.find(
    item => item.id === value.subcategoryId,
  );
  return (
    <>
      <Card>
        <View style={s.row}>
          <View style={[s.serviceIcon, { backgroundColor: p.tint }]}>
            <SIcon name="subscriptions" />
          </View>
          <View style={s.flex}>
            <SText style={s.title}>{value.name}</SText>
            <SText style={{ color: p.muted }}>
              {value.merchantName ?? 'Servicio recurrente'}
            </SText>
          </View>
          <Status status={value.status} />
        </View>
      </Card>
      <Card>
        <SText style={s.eyebrow}>IMPORTE ESPERADO</SText>
        <SText style={s.money}>{subscriptionMoney(value.amount)}</SText>
        <SText style={{ color: p.secondary }}>
          {recurrenceLabel(value.recurrence)} · Día contractual{' '}
          {value.billingDay}
        </SText>
        {(
          [
            [
              'event-repeat',
              'Próximo cobro',
              value.status === 'active' && value.nextChargeDate
                ? subscriptionDate(value.nextChargeDate, true)
                : 'Sin nuevos cobros programados',
            ],
            [
              'account-balance-wallet',
              'Cuenta',
              account?.name ??
                (value.accountId ? 'Cuenta no disponible' : 'Sin asignar'),
            ],
            [
              'category',
              'Categoría',
              `${category?.name ?? 'Sin categoría'}${
                subcategory ? ` › ${subcategory.name}` : ''
              }`,
            ],
            [
              'alarm',
              'Recordatorios',
              value.reminders.enabled
                ? `${value.reminders.offsets
                    .map(offset =>
                      offset === 0 ? 'Mismo día' : `${offset} días antes`,
                    )
                    .join(' · ')} a las ${String(value.reminders.hour).padStart(
                    2,
                    '0',
                  )}:${String(value.reminders.minute).padStart(2, '0')}`
                : 'Desactivados',
            ],
          ] as [string, string, string][]
        ).map(([icon, label, text]) => (
          <View key={label} style={s.row}>
            <SIcon name={icon} />
            <View style={s.flex}>
              <SText style={[s.label, { color: p.muted }]}>{label}</SText>
              <SText>{text}</SText>
            </View>
          </View>
        ))}
      </Card>
      {value.accountId && (!account || account.status !== 'active') ? (
        <Message
          text="La cuenta asociada está cerrada o no disponible. Su referencia se conserva; edita la suscripción para elegir otra cuenta."
          error
        />
      ) : null}
      {value.status !== 'cancelled' ? (
        <View style={s.stack}>
          <SButton
            label="Editar suscripción"
            secondary
            icon="edit"
            disabled={busy}
            onPress={onEdit}
          />
          <View style={s.row}>
            <View style={s.flex}>
              <SButton
                label={value.status === 'paused' ? 'Reanudar' : 'Pausar'}
                secondary
                icon={value.status === 'paused' ? 'play-arrow' : 'pause'}
                disabled={busy}
                onPress={() =>
                  onStatus(value.status === 'paused' ? 'resume' : 'pause')
                }
              />
            </View>
            <View style={s.flex}>
              <SButton
                label="Cancelar"
                danger
                icon="cancel"
                disabled={busy}
                onPress={() => onStatus('cancel')}
              />
            </View>
          </View>
        </View>
      ) : null}
      <Message text="Cancelar el compromiso en SmartFin conserva el historial y no cancela el servicio con su proveedor." />
      <SText style={s.heading}>Historial de cobros y conciliación</SText>
      <QueryState
        loading={result.loading}
        error={result.error}
        empty={
          result.data?.length === 0
            ? 'Todavía no hay cobros en esta página.'
            : undefined
        }
        onRetry={() => {
          void result.reload();
        }}
      />
      {!result.loading && !result.error
        ? result.data?.map(item => {
            const charge = { ...item, subscriptionName: value.name };
            return (
              <Card key={item.id}>
                <View style={s.between}>
                  <SText style={[s.heading, s.flex]}>
                    {subscriptionDate(item.expectedDate, true)}
                  </SText>
                  <Status status={item.status} />
                </View>
                <SText>
                  Esperado: {subscriptionMoney(item.expectedAmount)}
                </SText>
                {item.actualAmount !== undefined ? (
                  <>
                    <SText>Real: {subscriptionMoney(item.actualAmount)}</SText>
                    {item.actualAmount !== item.expectedAmount ? (
                      <SText style={{ color: p.secondary }}>
                        Diferencia:{' '}
                        {item.actualAmount > item.expectedAmount ? '+' : ''}
                        {subscriptionMoney(
                          item.actualAmount - item.expectedAmount,
                        )}
                      </SText>
                    ) : null}
                  </>
                ) : null}
                {item.skipReason ? (
                  <SText style={{ color: p.muted }}>
                    {SKIP_LABELS[item.skipReason]}
                  </SText>
                ) : null}
                {item.notes ? (
                  <SText style={{ color: p.muted }}>{item.notes}</SText>
                ) : null}
                {item.status !== 'skipped' ? (
                  <SButton
                    label="Editar importe de este cobro"
                    secondary
                    icon="edit"
                    disabled={busy}
                    onPress={() => onEditAmount(charge)}
                  />
                ) : null}
                {item.transaction ? (
                  <SButton
                    label={`Ver movimiento: ${item.transaction.description}`}
                    secondary
                    icon="receipt-long"
                    onPress={() => onMovement(item)}
                  />
                ) : null}
                {['pending', 'overdue'].includes(item.status) ? (
                  <View style={s.row}>
                    <View style={s.flex}>
                      <SButton
                        label="Saltar"
                        secondary
                        disabled={busy}
                        onPress={() => onSkip(charge)}
                      />
                    </View>
                    <View style={s.flex}>
                      <SButton
                        label="Vincular"
                        disabled={busy}
                        onPress={() => onLink(charge)}
                      />
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })
        : null}
      <View style={s.grid}>
        {page > 0 ? (
          <SButton
            label="Página anterior"
            secondary
            onPress={() => setPage(currentPage => currentPage - 1)}
          />
        ) : null}
        {result.data?.length === 50 ? (
          <SButton
            label="Más historial"
            secondary
            onPress={() => setPage(currentPage => currentPage + 1)}
          />
        ) : null}
      </View>
      <Message text="Los cobros anteriores conservan sus importes históricos aunque cambie el precio o la programación." />
    </>
  );
}
