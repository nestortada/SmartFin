import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNavigation } from '../../../shared/components';
import type { AppTheme } from '../../settings';
import type {
  Subscription,
  SubscriptionCharge,
  SubscriptionHistoryItem,
  SubscriptionInput,
  SubscriptionStatus,
} from '../types';
import { useSubscriptionsController } from '../hooks/useSubscriptionsController';
import {
  subscriptionDate,
  subscriptionTransactionDate,
  formatSubscriptionAmountInput,
  parseSubscriptionAmount,
  subscriptionMoney,
} from '../useCases/subscriptionPresentation';
import {
  Card,
  Chip,
  Message,
  QueryState,
  SButton,
  Sheet,
  SIcon,
  SText,
  SubscriptionDesign,
  s,
  useSubscriptionPalette,
} from './subscriptionDesign';
import { SubscriptionCard } from './components/SubscriptionCards';
import { SubscriptionForm } from './SubscriptionForm';
import { SubscriptionUpcoming } from './SubscriptionUpcoming';
import { SubscriptionDetail } from './SubscriptionDetail';
import { SubscriptionPaymentSheet } from './SubscriptionPaymentSheet';

type Props = {
  activeTheme: AppTheme;
  onChanged: () => void;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenSettings: () => void;
  onOpenCreditCards: () => void;
  onOpenDebitCards: () => void;
  onCreateTransaction?: (
    charge: SubscriptionCharge,
    subscription?: Subscription,
  ) => void;
  initialPaymentCharge?: SubscriptionCharge;
  onInitialPaymentConsumed?: () => void;
};
type Route =
  | { type: 'list' }
  | { type: 'upcoming' }
  | { type: 'detail'; id: string }
  | { type: 'form'; id?: string };
type Overlay =
  | { type: 'info' | 'reminders' }
  | { type: 'payment' | 'skip' | 'amount'; charge: SubscriptionCharge }
  | {
      type: 'status';
      action: 'pause' | 'resume' | 'cancel';
      subscription: Subscription;
    }
  | { type: 'movement'; item: SubscriptionHistoryItem };
export function SubscriptionsScreen(props: Props) {
  return (
    <SubscriptionDesign theme={props.activeTheme}>
      <SubscriptionContent {...props} />
    </SubscriptionDesign>
  );
}
function SubscriptionContent(props: Props) {
  const p = useSubscriptionPalette();
  const insets = useSafeAreaInsets();
  const controller = useSubscriptionsController(props.onChanged);
  const [route, setRoute] = useState<Route>({ type: 'list' });
  const [overlay, setOverlay] = useState<Overlay>();
  const [filter, setFilter] = useState<SubscriptionStatus | 'all'>('all');
  const [notes, setNotes] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [amountError, setAmountError] = useState<string>();
  const [paymentManual, setPaymentManual] = useState(false);
  const { initialPaymentCharge, onInitialPaymentConsumed } = props;
  useEffect(() => {
    if (initialPaymentCharge) {
      setRoute({
        type: 'detail',
        id: initialPaymentCharge.subscriptionId,
      });
      setOverlay({ type: 'payment', charge: initialPaymentCharge });
      setPaymentManual(true);
      onInitialPaymentConsumed?.();
    }
  }, [initialPaymentCharge, onInitialPaymentConsumed]);
  const scroll = useRef<ScrollView | null>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [route]);
  const selected =
    'id' in route
      ? controller.subscriptions.find(value => value.id === route.id)
      : undefined;
  const back = () => {
    if (controller.busy) return;
    if (overlay) setOverlay(undefined);
    else if (route.type === 'form' && route.id)
      setRoute({ type: 'detail', id: route.id });
    else if (route.type !== 'list') setRoute({ type: 'list' });
    else props.onNavigateToHome();
  };
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => handler.remove();
  });
  const link = (charge: SubscriptionCharge) => {
    setPaymentManual(false);
    setOverlay({ type: 'payment', charge });
  };
  const skip = (charge: SubscriptionCharge) => {
    setNotes('');
    setOverlay({ type: 'skip', charge });
  };
  const save = async (input: SubscriptionInput) => {
    const success = await controller.run(api =>
      route.type === 'form' && route.id
        ? api.updateSubscription(route.id, input)
        : api.createSubscription(input),
    );
    if (success)
      setRoute(
        route.type === 'form' && route.id
          ? { type: 'detail', id: route.id }
          : { type: 'list' },
      );
    return success;
  };
  const confirmStatus = async () => {
    if (overlay?.type !== 'status') return;
    const { subscription, action } = overlay;
    const success = await controller.run(api =>
      action === 'pause'
        ? api.pauseSubscription(subscription.id)
        : action === 'resume'
        ? api.resumeSubscription(subscription.id)
        : api.cancelSubscription(subscription.id),
    );
    if (success) setOverlay(undefined);
  };
  const title =
    route.type === 'list'
      ? 'Suscripciones'
      : route.type === 'upcoming'
      ? 'Próximos cobros'
      : route.type === 'detail'
      ? 'Detalle de suscripción'
      : route.id
      ? 'Editar suscripción'
      : 'Nueva suscripción';
  const visible = controller.subscriptions.filter(
    value => filter === 'all' || value.status === filter,
  );
  const notices = controller.sync?.reminderErrors.length;
  return (
    <KeyboardAvoidingView
      style={[
        s.root,
        { backgroundColor: p.background, paddingTop: insets.top },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar
        barStyle={
          props.activeTheme === 'dark' ? 'light-content' : 'dark-content'
        }
      />
      <View style={s.header}>
        {route.type === 'list' ? (
          <SIcon name="subscriptions" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            disabled={controller.busy}
            onPress={back}
            style={s.iconButton}
          >
            <SIcon name="arrow-back" />
          </Pressable>
        )}
        <SText style={[s.title, s.flex]}>{title}</SText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Estado de recordatorios"
          onPress={() => setOverlay({ type: 'reminders' })}
          style={s.iconButton}
        >
          <SIcon name="notifications-none" />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          {
            paddingBottom:
              route.type === 'list' ? 120 + insets.bottom : 40 + insets.bottom,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={controller.loading && !!controller.summary}
            onRefresh={() => {
              void controller.reload();
            }}
            tintColor={p.primary}
          />
        }
      >
        {controller.error ? (
          <Message
            text={controller.error}
            error
            action="Reintentar"
            onPress={() => {
              void controller.reload();
            }}
          />
        ) : null}
        {controller.notice ? (
          <Message
            text={controller.notice}
            action={notices ? 'Reintentar recordatorios' : undefined}
            onPress={() => {
              void controller.reminders();
            }}
          />
        ) : null}
        {!controller.summary ? (
          <QueryState
            loading={controller.loading}
            error={controller.error}
            onRetry={() => {
              void controller.reload();
            }}
          />
        ) : null}
        {route.type === 'list' && controller.summary ? (
          <>
            <Card tint>
              <View style={s.between}>
                <SText style={s.eyebrow}>COMPROMISO MENSUAL</SText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cómo se calcula el compromiso"
                  onPress={() => setOverlay({ type: 'info' })}
                  style={s.iconButton}
                >
                  <SIcon name="info-outline" size={20} />
                </Pressable>
              </View>
              <SText style={s.money}>
                {subscriptionMoney(controller.summary.monthlyEquivalent)}
              </SText>
              <SText style={[s.label, { color: p.muted }]}>
                {controller.summary.activeCount} activas ·{' '}
                {
                  controller.subscriptions.filter(
                    value => value.status === 'paused',
                  ).length
                }{' '}
                en pausa
              </SText>
              <View style={s.row}>
                <SIcon name="calendar-today" size={18} />
                <SText style={s.flex}>Equivalente anual</SText>
                <SText style={s.amount}>
                  {subscriptionMoney(controller.summary.annualEquivalent)}
                </SText>
              </View>
            </Card>
            {controller.summary.nextCharge ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gestionar próximo cobro"
                onPress={() =>
                  setRoute({
                    type: 'detail',
                    id: controller.summary!.nextCharge!.subscriptionId,
                  })
                }
              >
                <Card>
                  <SText style={[s.eyebrow, { color: p.secondary }]}>
                    PRÓXIMO COBRO ESPERADO
                  </SText>
                  <View style={s.row}>
                    <View
                      style={[s.serviceIcon, { backgroundColor: p.raised }]}
                    >
                      <SIcon name="event-repeat" color={p.secondary} />
                    </View>
                    <View style={s.flex}>
                      <SText style={s.heading}>
                        {controller.summary.nextCharge.subscriptionName}
                      </SText>
                      <SText style={{ color: p.muted }}>
                        {subscriptionDate(
                          controller.summary.nextCharge.expectedDate,
                          true,
                        )}
                      </SText>
                    </View>
                  </View>
                  <SText style={s.amount}>
                    {subscriptionMoney(
                      controller.summary.nextCharge.expectedAmount,
                    )}
                  </SText>
                  <View style={s.row}>
                    <SIcon name="account-balance-wallet" />
                    <SText style={s.flex}>
                      {controller.options.accounts.find(
                        value =>
                          value.id ===
                          controller.summary?.nextCharge?.accountId,
                      )?.name ?? 'Sin cuenta asignada'}
                    </SText>
                    <SText style={{ color: p.primary }}>Gestionar ›</SText>
                  </View>
                </Card>
              </Pressable>
            ) : null}
            <SButton
              label={`Próximos cobros${
                controller.summary.overdueCount
                  ? ` · ${controller.summary.overdueCount} vencidos`
                  : ''
              }`}
              secondary
              icon="calendar-today"
              onPress={() => setRoute({ type: 'upcoming' })}
            />
            {controller.sync &&
            (!controller.sync.reminders.available ||
              controller.sync.reminders.permission === 'denied' ||
              controller.subscriptions.every(
                value => !value.reminders.enabled,
              )) ? (
              <Message
                text={
                  !controller.sync.reminders.available
                    ? 'Recordatorios no disponibles en este dispositivo.'
                    : controller.sync.reminders.permission === 'denied'
                    ? 'Las notificaciones están bloqueadas. Tus cobros siguen guardados.'
                    : 'Los recordatorios están desactivados. Puedes activarlos al editar cada suscripción.'
                }
                action="Revisar recordatorios"
                onPress={() => setOverlay({ type: 'reminders' })}
              />
            ) : null}
            {controller.sync?.diagnostics.map(diagnostic => (
              <Message
                key={diagnostic.subscriptionId}
                error
                text={`Configuración por revisar (${diagnostic.subscriptionId}): ${diagnostic.message}. Se conservan los datos originales.`}
              />
            ))}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {(['all', 'active', 'paused', 'cancelled'] as const).map(
                value => (
                  <Chip
                    key={value}
                    selected={filter === value}
                    label={`${
                      value === 'all'
                        ? 'Todas'
                        : value === 'active'
                        ? 'Activas'
                        : value === 'paused'
                        ? 'Pausadas'
                        : 'Canceladas'
                    } (${
                      controller.subscriptions.filter(
                        item => value === 'all' || item.status === value,
                      ).length
                    })`}
                    onPress={() => setFilter(value)}
                  />
                ),
              )}
            </ScrollView>
            {visible.map(value => (
              <SubscriptionCard
                key={value.id}
                value={value}
                options={controller.options}
                onPress={() => setRoute({ type: 'detail', id: value.id })}
              />
            ))}
            {!visible.length ? (
              <Message
                text={
                  controller.subscriptions.length
                    ? 'No hay suscripciones con este estado.'
                    : 'Organiza tus compromisos recurrentes. Añade tu primera suscripción para ver fechas, importes y recordatorios.'
                }
              />
            ) : null}
            <SButton
              label="Añadir suscripción"
              icon="add"
              disabled={controller.busy || controller.loading}
              onPress={() => setRoute({ type: 'form' })}
              testID="subscription-add"
            />
          </>
        ) : null}
        {route.type === 'upcoming' ? (
          <SubscriptionUpcoming
            acquireApi={controller.acquireApi}
            revision={controller.revision}
            options={controller.options}
            busy={controller.busy}
            onLink={link}
            onSkip={skip}
          />
        ) : null}
        {route.type === 'detail' && selected ? (
          <SubscriptionDetail
            key={selected.id}
            value={selected}
            options={controller.options}
            acquireApi={controller.acquireApi}
            revision={controller.revision}
            busy={controller.busy}
            onEdit={() => setRoute({ type: 'form', id: selected.id })}
            onStatus={action =>
              setOverlay({ type: 'status', action, subscription: selected })
            }
            onLink={link}
            onSkip={skip}
            onMovement={item => setOverlay({ type: 'movement', item })}
            onEditAmount={charge => {
              setChargeAmount(String(charge.expectedAmount).replace('.', ','));
              setAmountError(undefined);
              setOverlay({ type: 'amount', charge });
            }}
          />
        ) : null}
        {route.type === 'form' && (!route.id || selected) ? (
          <SubscriptionForm
            key={route.id ?? 'new'}
            subscription={selected}
            options={controller.options}
            busy={controller.busy}
            externalError={controller.error}
            onSave={save}
            onCreateReference={async (name, categoryId) => {
              let id: string | undefined;
              const success = await controller.run(async api => {
                const result = categoryId
                  ? await api.createSubscriptionSubcategory(categoryId, name)
                  : await api.createSubscriptionCategory(name);
                id = result.value.id;
                return result;
              });
              return success ? id : undefined;
            }}
          />
        ) : null}
        {'id' in route && route.id && !selected && !controller.loading ? (
          <Message
            text="Esta suscripción ya no está disponible. Vuelve al listado para consultar los datos actuales."
            action="Volver al listado"
            onPress={() => setRoute({ type: 'list' })}
          />
        ) : null}
      </ScrollView>
      {route.type === 'list' ? (
        <BottomNavigation
          activeTab="more"
          bottomInset={insets.bottom}
          colorScheme={props.activeTheme}
          onTabPress={tab => {
            if (tab === 'home') props.onNavigateToHome();
            else if (tab === 'transactions') props.onNavigateToTransactions();
          }}
          onMoreActionPress={action => {
            if (action === 'creditCards') props.onOpenCreditCards();
            else if (action === 'debitCards') props.onOpenDebitCards();
            else if (action === 'settings') props.onOpenSettings();
          }}
        />
      ) : null}
      {overlay?.type === 'payment' ? (
        <SubscriptionPaymentSheet
          manualInitially={paymentManual}
          charge={overlay.charge}
          options={controller.options}
          acquireApi={controller.acquireApi}
          revision={controller.revision}
          busy={controller.busy}
          error={controller.error}
          onClose={() => setOverlay(undefined)}
          onCreateTransaction={
            props.onCreateTransaction
              ? () => {
                  props.onCreateTransaction?.(
                    overlay.charge,
                    controller.subscriptions.find(
                      value => value.id === overlay.charge.subscriptionId,
                    ),
                  );
                }
              : undefined
          }
          onConfirm={async transactionId => {
            const success = await controller.run(api =>
              api.confirmSubscriptionPayment({
                occurrenceId: overlay.charge.id,
                transactionId,
              }),
            );
            if (success) setOverlay(undefined);
          }}
        />
      ) : null}
      {overlay?.type === 'amount' ? (
        <Sheet
          title="Importe de este cobro"
          busy={controller.busy}
          onClose={() => setOverlay(undefined)}
        >
          <SText style={s.heading}>{overlay.charge.subscriptionName}</SText>
          <SText>{subscriptionDate(overlay.charge.expectedDate, true)}</SText>
          <Message text="Cambia únicamente el importe esperado de esta fecha. El precio contractual, otros meses y el importe del movimiento real se conservan." />
          <TextInput
            accessibilityLabel="Importe esperado de este cobro"
            value={formatSubscriptionAmountInput(chargeAmount)}
            onChangeText={value =>
              setChargeAmount(formatSubscriptionAmountInput(value))
            }
            keyboardType="decimal-pad"
            style={[s.input, { color: p.text, borderColor: p.border }]}
          />
          {amountError || controller.error ? (
            <Message text={amountError ?? controller.error!} error />
          ) : null}
          <SButton
            label="Guardar importe de este cobro"
            disabled={controller.busy}
            onPress={() => {
              void (async () => {
                try {
                  const amount = parseSubscriptionAmount(chargeAmount);
                  setAmountError(undefined);
                  const success = await controller.run(api =>
                    api.updateSubscriptionOccurrenceAmount(
                      overlay.charge.id,
                      amount,
                    ),
                  );
                  if (success) setOverlay(undefined);
                } catch (reason) {
                  setAmountError(
                    reason instanceof Error
                      ? reason.message
                      : 'Importe inválido.',
                  );
                }
              })();
            }}
          />
        </Sheet>
      ) : null}
      {overlay?.type === 'skip' ? (
        <Sheet
          title="Saltar este cobro"
          busy={controller.busy}
          onClose={() => setOverlay(undefined)}
        >
          <SText style={s.heading}>{overlay.charge.subscriptionName}</SText>
          <SText>
            {subscriptionDate(overlay.charge.expectedDate, true)} ·{' '}
            {subscriptionMoney(overlay.charge.expectedAmount)}
          </SText>
          <Message text="Este cobro se marcará como saltado. La suscripción continuará con el siguiente periodo." />
          <TextInput
            accessibilityLabel="Nota opcional"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Nota opcional"
            placeholderTextColor={p.muted}
            style={[s.input, { color: p.text, borderColor: p.border }]}
          />
          {controller.error ? <Message text={controller.error} error /> : null}
          <SButton
            label="Confirmar salto"
            disabled={controller.busy}
            onPress={() => {
              void controller
                .run(api =>
                  api.skipSubscriptionOccurrence(
                    overlay.charge.id,
                    notes.trim() || undefined,
                  ),
                )
                .then(success => {
                  if (success) setOverlay(undefined);
                });
            }}
          />
        </Sheet>
      ) : null}
      {overlay?.type === 'status' ? (
        <Sheet
          title={
            overlay.action === 'cancel'
              ? 'Cancelar compromiso'
              : overlay.action === 'pause'
              ? 'Pausar suscripción'
              : 'Reanudar suscripción'
          }
          busy={controller.busy}
          onClose={() => setOverlay(undefined)}
        >
          <SText style={s.heading}>{overlay.subscription.name}</SText>
          <SText>
            {overlay.action === 'resume'
              ? 'Se calculará el siguiente cobro desde hoy. No se recuperarán periodos transcurridos durante la pausa.'
              : overlay.action === 'pause'
              ? 'Los pendientes futuros se marcarán como saltados por pausa y dejarán de proyectarse. Sus recordatorios se cancelarán. Los cobros de hoy y anteriores se conservan.'
              : 'Esta acción es definitiva dentro de SmartFin. Los pendientes futuros dejarán de proyectarse y se cancelarán sus recordatorios. El historial y los cobros de hoy o anteriores se conservan.'}
          </SText>
          <Message text="Esta acción no cancela ni modifica el servicio con su proveedor." />
          {controller.error ? <Message text={controller.error} error /> : null}
          <SButton
            label={
              overlay.action === 'cancel'
                ? 'Cancelar compromiso definitivamente'
                : overlay.action === 'pause'
                ? 'Confirmar pausa'
                : 'Confirmar reanudación'
            }
            danger={overlay.action === 'cancel'}
            disabled={controller.busy}
            onPress={() => {
              void confirmStatus();
            }}
          />
          <SButton
            label="Volver"
            secondary
            disabled={controller.busy}
            onPress={() => setOverlay(undefined)}
          />
        </Sheet>
      ) : null}
      {overlay?.type === 'info' ? (
        <Sheet
          title="Compromiso mensual equivalente"
          onClose={() => setOverlay(undefined)}
        >
          <SText>
            Es una estimación que distribuye los compromisos activos a lo largo
            del año. No representa el gasto real de este mes ni dinero
            descontado.
          </SText>
          <SText>
            Las recurrencias mensuales se anualizan según su intervalo. Las
            semanales y diarias usan el promedio gregoriano de 365,2425 días; el
            mensual se calcula desde el anual.
          </SText>
        </Sheet>
      ) : null}
      {overlay?.type === 'reminders' ? (
        <Sheet
          title="Recordatorios del dispositivo"
          busy={controller.busy}
          onClose={() => setOverlay(undefined)}
        >
          <Message
            text={
              !controller.sync?.reminders.available
                ? 'Este dispositivo no ofrece recordatorios compatibles. El módulo de suscripciones continúa funcionando.'
                : controller.sync.reminders.permission === 'granted'
                ? 'Notificaciones permitidas. Los avisos siguen la hora local del dispositivo.'
                : 'Notificaciones bloqueadas. La intención de programación se conserva.'
            }
          />
          <SText>
            Activa o modifica los avisos desde el formulario de cada
            suscripción. En pantalla bloqueada el contenido es genérico.
          </SText>
          {controller.sync?.reminders.available ? (
            <>
              <SButton
                label="Solicitar permiso de notificaciones"
                disabled={controller.busy}
                onPress={() => {
                  void controller.reminders(true);
                }}
              />
              <SButton
                label="Abrir ajustes del dispositivo"
                secondary
                onPress={() => {
                  void Linking.openSettings().catch(() => undefined);
                }}
              />
              <SButton
                label="Reintentar programación"
                secondary
                disabled={controller.busy}
                onPress={() => {
                  void controller.reminders();
                }}
              />
            </>
          ) : null}
          {controller.notice ? <Message text={controller.notice} /> : null}
          {controller.error ? <Message text={controller.error} error /> : null}
        </Sheet>
      ) : null}
      {overlay?.type === 'movement' && overlay.item.transaction ? (
        <Sheet
          title="Movimiento vinculado"
          onClose={() => setOverlay(undefined)}
        >
          <SText style={s.heading}>
            {overlay.item.transaction.description}
          </SText>
          <SText style={s.money}>
            {subscriptionMoney(overlay.item.transaction.amount)}
          </SText>
          <SText>
            {subscriptionTransactionDate(overlay.item.transaction.date, true)}
          </SText>
          <SText>
            Cuenta:{' '}
            {controller.options.accounts.find(
              value => value.id === overlay.item.transaction?.accountId,
            )?.name ?? overlay.item.transaction.accountId}
          </SText>
          <SText>Referencia: {overlay.item.transaction.id}</SText>
          <SText>{overlay.item.transaction.notes}</SText>
          <Message text="Este movimiento ya está registrado. La vinculación no genera otro gasto." />
        </Sheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}
