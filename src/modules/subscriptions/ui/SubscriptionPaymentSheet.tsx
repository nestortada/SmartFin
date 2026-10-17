import React, { useCallback, useEffect, useState } from 'react';
import { transactionDateKey } from '../../../shared/utils/transactionDate';
import { Pressable, TextInput, View } from 'react-native';
import type { SubscriptionApi } from '../useCases/createSubscriptionApi';
import type {
  SubscriptionCharge,
  SubscriptionFormOptions,
  SubscriptionPaymentCandidate,
} from '../types';
import { useSubscriptionQuery } from '../hooks/useSubscriptionQuery';
import {
  subscriptionDate,
  subscriptionTransactionDate,
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
  s,
  useSubscriptionPalette,
} from './subscriptionDesign';

export function SubscriptionPaymentSheet({
  charge,
  options,
  acquireApi,
  busy,
  revision,
  error,
  onClose,
  onConfirm,
  onCreateTransaction,
  manualInitially = false,
}: {
  charge: SubscriptionCharge;
  options: SubscriptionFormOptions;
  acquireApi: () => Promise<SubscriptionApi>;
  busy: boolean;
  revision: number;
  error?: string;
  onClose: () => void;
  onConfirm: (transactionId: string) => Promise<void>;
  onCreateTransaction?: () => void;
  manualInitially?: boolean;
}) {
  const p = useSubscriptionPalette();
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  const [suggested, setSuggested] = useState(!manualInitially);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SubscriptionPaymentCandidate>();
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQueryText(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);
  const query = useCallback(async () => {
    const api = await acquireApi();
    return api.getSubscriptionPaymentCandidates({
      occurrenceId: charge.id,
      query: queryText,
      suggestedOnly: suggested,
      limit: 30,
      offset: page * 30,
    });
  }, [acquireApi, charge.id, queryText, suggested, page]);
  const result = useSubscriptionQuery(query, revision);
  return (
    <Sheet title="Vincular cobro esperado" onClose={onClose} busy={busy}>
      <Card tint>
        <SText style={s.heading}>{charge.subscriptionName}</SText>
        <SText style={s.amount}>
          {subscriptionMoney(charge.expectedAmount)}
        </SText>
        <SText>
          {subscriptionDate(charge.expectedDate, true)} ·{' '}
          {options.accounts.find(item => item.id === charge.accountId)?.name ??
            'Sin cuenta asignada'}
        </SText>
      </Card>
      {onCreateTransaction ? (
        <Message
          text="¿Ya pagaste y todavía no registraste el gasto? Regístralo en Movimientos y después selecciónalo para vincularlo."
          action="Registrar nuevo gasto"
          onPress={onCreateTransaction}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Buscar movimientos"
        value={search}
        onChangeText={text => {
          setSearch(text);
          setSuggested(false);
          setSelected(undefined);
        }}
        placeholder="Comercio, importe o referencia"
        placeholderTextColor={p.muted}
        style={[s.input, { color: p.text, borderColor: p.border }]}
      />
      <View style={s.grid}>
        <Chip
          label="Sugeridos"
          selected={suggested}
          onPress={() => {
            setSuggested(true);
            setPage(0);
            setSelected(undefined);
          }}
        />
        <Chip
          label="Todos compatibles"
          selected={!suggested}
          onPress={() => {
            setSuggested(false);
            setPage(0);
            setSelected(undefined);
          }}
        />
      </View>
      <QueryState
        loading={result.loading}
        error={result.error}
        empty={
          result.data?.length === 0
            ? 'No hay movimientos compatibles en esta búsqueda. Registra el gasto en Movimientos cuando se haya realizado y vuelve a vincularlo aquí.'
            : undefined
        }
        onRetry={() => {
          void result.reload();
        }}
      />
      {!result.loading && !result.error
        ? result.data?.map(candidate => (
            <Pressable
              key={candidate.transaction.id}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selected?.transaction.id === candidate.transaction.id,
              }}
              accessibilityLabel={`Seleccionar ${candidate.transaction.description}`}
              onPress={() => setSelected(candidate)}
            >
              <Card
                tint={selected?.transaction.id === candidate.transaction.id}
              >
                <View style={s.between}>
                  <SText style={[s.heading, s.flex]}>
                    {candidate.transaction.description}
                  </SText>
                  <SIcon
                    name={
                      selected?.transaction.id === candidate.transaction.id
                        ? 'radio-button-checked'
                        : 'radio-button-unchecked'
                    }
                  />
                </View>
                <SText>
                  {subscriptionTransactionDate(transactionDateKey(candidate.transaction))} ·{' '}
                  {options.accounts.find(
                    item => item.id === candidate.transaction.accountId,
                  )?.name ?? candidate.transaction.accountId}
                </SText>
                <SText style={s.amount}>
                  {subscriptionMoney(candidate.transaction.amount)}
                </SText>
                {candidate.score ? (
                  <SText style={[s.label, { color: p.green }]}>
                    Coincidencia {candidate.score}/100
                  </SText>
                ) : null}
                {candidate.reasons.map(reason => (
                  <SText key={reason} style={[s.label, { color: p.muted }]}>
                    ✓ {reason}
                  </SText>
                ))}
              </Card>
            </Pressable>
          ))
        : null}
      <View style={s.grid}>
        {page > 0 ? (
          <SButton
            label="Anteriores"
            secondary
            onPress={() => setPage(value => value - 1)}
          />
        ) : null}
        {result.data?.length === 30 ? (
          <SButton
            label="Más movimientos"
            secondary
            onPress={() => setPage(value => value + 1)}
          />
        ) : null}
      </View>
      {selected ? (
        <Card tint>
          <SText>Esperado: {subscriptionMoney(charge.expectedAmount)}</SText>
          <SText>Real: {subscriptionMoney(selected.transaction.amount)}</SText>
          {selected.transaction.amount !== charge.expectedAmount ? (
            <SText>
              Diferencia:{' '}
              {subscriptionMoney(
                selected.transaction.amount - charge.expectedAmount,
              )}
            </SText>
          ) : null}
        </Card>
      ) : null}
      <Message text="Esta acción vincula un movimiento ya registrado. No crea otro gasto ni modifica el importe esperado." />
      {error ? <Message text={error} error /> : null}
      <SButton
        label={busy ? 'Vinculando…' : 'Vincular movimiento seleccionado'}
        icon="link"
        disabled={busy || !selected || result.loading}
        onPress={() => {
          if (selected) void onConfirm(selected.transaction.id);
        }}
        testID="subscription-confirm-payment"
      />
    </Sheet>
  );
}
