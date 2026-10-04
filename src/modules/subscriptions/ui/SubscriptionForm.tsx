import React, { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import type {
  Subscription,
  SubscriptionFormOptions,
  SubscriptionInput,
} from '../types';
import {
  previewSubscriptionDate,
  formatSubscriptionAmountInput,
  RECURRENCE_LABELS,
  selectableSubscriptionAccounts,
  subscriptionDate,
  subscriptionDraft,
  subscriptionInputFromDraft,
  type SubscriptionFormDraft,
} from '../useCases/subscriptionPresentation';
import {
  Card,
  Chip,
  Message,
  SButton,
  Sheet,
  SIcon,
  SText,
  s,
  useSubscriptionPalette,
} from './subscriptionDesign';
import { CivilDateField } from './components/CivilDateField';

function Field({
  label,
  value,
  onChange,
  number = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  number?: boolean;
  placeholder?: string;
}) {
  const p = useSubscriptionPalette();
  return (
    <View style={s.field}>
      <SText style={s.label}>{label}</SText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={p.muted}
        keyboardType={number ? 'decimal-pad' : 'default'}
        style={[
          s.input,
          { color: p.text, backgroundColor: p.card, borderColor: p.border },
        ]}
      />
    </View>
  );
}
function Select({
  label,
  value,
  options,
  onChange,
  onCreate,
  createLabel,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
}) {
  const p = useSubscriptionPalette();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SText style={s.label}>{label}</SText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={[
          s.input,
          s.between,
          { backgroundColor: p.card, borderColor: p.border },
        ]}
      >
        <SText style={s.flex}>
          {options.find(option => option.id === value)?.name ??
            (value ? 'Referencia no disponible' : 'Sin asignar')}
        </SText>
        <SIcon name="expand-more" />
      </Pressable>
      {open ? (
        <Sheet title={label} onClose={() => setOpen(false)}>
          {onCreate && createLabel ? (
            <SButton
              label={createLabel}
              icon="add"
              onPress={() => {
                setOpen(false);
                onCreate();
              }}
            />
          ) : null}
          {options.map(option => (
            <SButton
              key={option.id}
              label={option.name}
              secondary={option.id !== value}
              onPress={() => {
                onChange(option.id);
                setOpen(false);
              }}
            />
          ))}
        </Sheet>
      ) : null}
    </>
  );
}
export function SubscriptionForm({
  subscription,
  options,
  busy,
  externalError,
  onSave,
  onCreateReference,
}: {
  subscription?: Subscription;
  options: SubscriptionFormOptions;
  busy: boolean;
  externalError?: string;
  onSave: (input: SubscriptionInput) => Promise<boolean>;
  onCreateReference?: (
    name: string,
    categoryId?: string,
  ) => Promise<string | undefined>;
}) {
  const p = useSubscriptionPalette();
  const [draft, setDraft] = useState(() => subscriptionDraft(subscription));
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState<'category' | 'subcategory'>();
  const [referenceName, setReferenceName] = useState('');
  const startCreate = (kind: 'category' | 'subcategory') => {
    setReferenceName('');
    setError(undefined);
    setCreating(kind);
  };
  const createReference = async () => {
    if (!onCreateReference || !creating || busy) return;
    const id = await onCreateReference(
      referenceName,
      creating === 'subcategory' ? draft.categoryId : undefined,
    );
    if (id) {
      setDraft(current =>
        creating === 'category'
          ? { ...current, categoryId: id, subcategoryId: '' }
          : { ...current, subcategoryId: id },
      );
      setCreating(undefined);
    }
  };
  const update = <K extends keyof SubscriptionFormDraft>(
    key: K,
    value: SubscriptionFormDraft[K],
  ) => setDraft(current => ({ ...current, [key]: value }));
  let preview: string | undefined;
  try {
    preview = subscriptionDate(previewSubscriptionDate(draft), true);
  } catch {
    /* Incomplete drafts have no preview. */
  }
  const monthly =
    !['weekly', 'biweekly'].includes(draft.periodicity) &&
    (draft.periodicity !== 'custom' || draft.unit === 'months');
  const save = async () => {
    try {
      const input = subscriptionInputFromDraft(draft);
      setError(undefined);
      await onSave(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Revisa los datos.');
    }
  };
  return (
    <View style={s.stack}>
      <Message text="Una suscripción es un cobro esperado. Guardarla no crea un gasto ni descuenta dinero." />
      <Card>
        <SText style={s.heading}>Datos del servicio</SText>
        <Field
          label="Nombre"
          value={draft.name}
          placeholder="Ej. Netflix"
          onChange={value => update('name', value)}
        />
        <Field
          label="Comercio (opcional)"
          value={draft.merchantName}
          onChange={value => update('merchantName', value)}
        />
        <Field
          label="Importe en COP"
          value={formatSubscriptionAmountInput(draft.amount)}
          number
          placeholder="38.900"
          onChange={value =>
            update('amount', formatSubscriptionAmountInput(value))
          }
        />
      </Card>
      <Card>
        <SText style={s.heading}>Organización</SText>
        <Select
          label="Cuenta (opcional)"
          value={draft.accountId}
          options={[
            { id: '', name: 'Sin cuenta asignada' },
            ...selectableSubscriptionAccounts(options),
          ]}
          onChange={value => update('accountId', value)}
        />
        <Select
          label="Categoría de gasto (opcional)"
          createLabel="Crear categoría"
          onCreate={
            onCreateReference ? () => startCreate('category') : undefined
          }
          value={draft.categoryId}
          options={[
            { id: '', name: 'Sin categoría' },
            ...options.categories.filter(value => value.type === 'expense'),
          ]}
          onChange={value =>
            setDraft(current => ({
              ...current,
              categoryId: value,
              subcategoryId: '',
            }))
          }
        />
        <Select
          label="Subcategoría (opcional)"
          createLabel="Crear subcategoría"
          onCreate={
            onCreateReference
              ? () => {
                  if (!draft.categoryId)
                    setError('Selecciona primero una categoría de gasto.');
                  else startCreate('subcategory');
                }
              : undefined
          }
          value={draft.subcategoryId}
          options={[
            { id: '', name: 'Sin subcategoría' },
            ...options.subcategories.filter(
              value => value.isActive && value.categoryId === draft.categoryId,
            ),
          ]}
          onChange={value => update('subcategoryId', value)}
        />
      </Card>
      <Card>
        <SText style={s.heading}>Programación</SText>
        <CivilDateField
          label="Fecha contractual de anclaje"
          value={draft.anchorDate}
          onChange={value =>
            setDraft(current => ({
              ...current,
              anchorDate: value,
              billingDay: value.slice(-2),
            }))
          }
        />
        <Select
          label="Periodicidad"
          value={draft.periodicity}
          options={Object.entries(RECURRENCE_LABELS).map(([id, name]) => ({
            id,
            name,
          }))}
          onChange={value =>
            update('periodicity', value as SubscriptionFormDraft['periodicity'])
          }
        />
        {draft.periodicity === 'custom' ? (
          <>
            <Field
              label="Cada cuántos periodos"
              number
              value={draft.interval}
              onChange={value => update('interval', value)}
            />
            <Select
              label="Unidad"
              value={draft.unit}
              options={[
                { id: 'days', name: 'Días' },
                { id: 'weeks', name: 'Semanas' },
                { id: 'months', name: 'Meses' },
              ]}
              onChange={value =>
                update('unit', value as SubscriptionFormDraft['unit'])
              }
            />
          </>
        ) : null}
        {monthly ? (
          <>
            <Field
              label="Día contractual (1–31)"
              number
              value={draft.billingDay}
              onChange={value => update('billingDay', value)}
            />
            <SText style={{ color: p.muted }}>
              En meses más cortos se utiliza el último día disponible y se
              conserva el día contractual.
            </SText>
          </>
        ) : null}
        <View style={[s.card, { backgroundColor: p.tint }]}>
          <SText style={s.label}>PRÓXIMA FECHA CONTRACTUAL</SText>
          <SText style={s.heading}>
            {preview ?? 'Completa una programación válida'}
          </SText>
        </View>
      </Card>
      <Card>
        <View style={s.between}>
          <SText style={s.heading}>Recordatorios</SText>
          <Switch
            accessibilityLabel="Activar recordatorios"
            value={draft.enabled}
            onValueChange={value => update('enabled', value)}
            trackColor={{ true: p.primary, false: p.border }}
          />
        </View>
        {draft.enabled ? (
          <>
            <SText style={{ color: p.muted }}>
              Elige cuándo recibir avisos en este dispositivo.
            </SText>
            <View style={s.grid}>
              {[...new Set([0, 1, 3, 5, ...draft.offsets])]
                .sort((a, b) => a - b)
                .map(offset => (
                  <Chip
                    key={offset}
                    label={
                      offset === 0
                        ? 'Mismo día'
                        : `${offset} ${offset === 1 ? 'día' : 'días'} antes`
                    }
                    selected={draft.offsets.includes(offset)}
                    onPress={() =>
                      update(
                        'offsets',
                        draft.offsets.includes(offset)
                          ? draft.offsets.filter(value => value !== offset)
                          : [...draft.offsets, offset],
                      )
                    }
                  />
                ))}
            </View>
            <Field
              label="Hora local (HH:mm)"
              value={draft.time}
              placeholder="09:00"
              onChange={value => update('time', value)}
            />
          </>
        ) : (
          <SText style={{ color: p.muted }}>
            Los cobros seguirán registrados sin avisos.
          </SText>
        )}
      </Card>
      {subscription ? (
        <Message text="Los pagos anteriores conservarán sus importes. Precio y programación nuevos afectan únicamente pendientes posteriores a hoy." />
      ) : null}
      {error || externalError ? (
        <Message text={error ?? externalError!} error />
      ) : null}
      <SButton
        label={
          busy
            ? 'Guardando…'
            : subscription
            ? 'Guardar cambios'
            : 'Crear suscripción'
        }
        icon="check-circle"
        disabled={busy}
        onPress={() => {
          void save();
        }}
        testID="subscription-save"
      />
      {creating ? (
        <Sheet
          title={
            creating === 'category'
              ? 'Nueva categoría de gasto'
              : 'Nueva subcategoría'
          }
          busy={busy}
          onClose={() => setCreating(undefined)}
        >
          <Field
            label="Nombre de la categoría o subcategoría"
            value={referenceName}
            onChange={setReferenceName}
          />
          {externalError ? <Message text={externalError} error /> : null}
          <SButton
            label="Guardar categoría o subcategoría"
            disabled={busy}
            onPress={() => {
              void createReference();
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}
