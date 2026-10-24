import React from 'react';
import { Text, View } from 'react-native';

import type { DriveBackupStatus } from '../../services';
import { BACKUP_PUBLICATION_UI_ENABLED } from '../../services/backupPublicationPolicy';
import {
  GlassButton,
  Icon,
  SettingsRow,
  SettingsSection,
  type SettingsPalette,
} from './primitives';

type DriveBackupSectionProps = {
  busy?: boolean;
  progressMessage?: string;
  errorMessage?: string;
  backupStatus?: DriveBackupStatus;
  onChooseDirectory: () => Promise<void>;
  onExport: () => Promise<void>;
  palette: SettingsPalette;
};

function formatBackupDate(value?: string): string {
  if (!value) return 'Todavía no se ha creado un respaldo';

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Fecha del último respaldo no disponible'
    : `Último respaldo: ${date.toLocaleString('es-CO')}`;
}

export function DriveBackupSection({
  busy = false,
  progressMessage,
  errorMessage,
  backupStatus,
  onChooseDirectory,
  onExport,
  palette,
}: DriveBackupSectionProps) {
  if (backupStatus?.available === false) return null;

  const configured = backupStatus?.configured === true && !backupStatus.accessNeedsRenewal;
  const stateText = backupStatus?.accessNeedsRenewal
    ? 'Android perdió el acceso. Vuelve a seleccionar la carpeta original. Los trabajos conservan su identidad y evidencia.'
    : backupStatus?.datasetCurrency === 'historical'
    ? 'Copia histórica anterior al borrado. No representa los datos locales vigentes.'
    : backupStatus?.pendingJobs?.length
    ? `Hay ${backupStatus.pendingJobs.length} trabajo(s) pendiente(s) o incierto(s). Verifica el trabajo original; no se recapturan datos actuales.`
    : !configured
    ? 'Selecciona una carpeta de Google Drive desde el selector de Android.'
    : backupStatus.outdated
      ? `Respaldo desactualizado en ${backupStatus.locationName ?? 'la carpeta elegida'}`
      : backupStatus.validation === 'verified'
        ? `Generación verificada en ${backupStatus.locationName ?? 'la carpeta elegida'}`
        : 'Respaldo histórico sin verificación de integridad.';

  return (
    <SettingsSection palette={palette} title="Respaldo en Google Drive">
      {progressMessage ? <Text accessibilityLiveRegion="polite" style={{ color: palette.primary, paddingHorizontal: 16 }}>{progressMessage}</Text> : null}
      {errorMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: palette.danger, paddingHorizontal: 16 }}>{errorMessage}</Text> : null}
      <SettingsRow
        icon={<Icon color={backupStatus?.outdated ? palette.danger : palette.primary} name="cloud-upload" />}
        label="Base completa y CSV por año"
        palette={palette}
        supportingText={`${stateText} ${formatBackupDate(backupStatus?.lastBackupAt)}`}
        trailing={
          <GlassButton
            disabled={busy}
            label={configured ? 'Cambiar carpeta' : 'Elegir carpeta'}
            onPress={() => { void onChooseDirectory(); }}
            palette={palette}
          />
        }
      />
      {configured ? (
        <SettingsRow
          icon={<Icon color={palette.tertiary} name="sync" />}
          label={backupStatus.pendingJobs?.length ? 'Verificar trabajo original' : 'Publicar nueva generación'}
          palette={palette}
          supportingText={BACKUP_PUBLICATION_UI_ENABLED
            ? backupStatus.pendingJobs?.length
              ? 'Verifica el trabajo original y su captura; no crea otra generación ni recaptura los datos actuales.'
              : 'Crea una generación independiente; conserva los archivos históricos de la raíz.'
            : 'Publicación pendiente de aceptación de compatibilidad y tiempos de captura. Los archivos históricos se conservan.'}
          trailing={
            <GlassButton
              disabled={busy || !BACKUP_PUBLICATION_UI_ENABLED}
              label={backupStatus.pendingJobs?.length ? 'Verificar' : 'Publicar'}
              onPress={() => { void onExport(); }}
              palette={palette}
              variant="filled"
            />
          }
        />
      ) : null}
      {configured && !backupStatus.permissionPersistent ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: palette.danger, fontSize: 11, fontWeight: '700', lineHeight: 16 }}>
            El proveedor dio acceso temporal. Es posible que Android solicite elegir de nuevo la carpeta después de reiniciar.
          </Text>
        </View>
      ) : null}
      {configured ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: palette.muted, fontSize: 11, fontWeight: '600', lineHeight: 16 }}>
            La verificación relee tamaños y SHA-256 mediante Android. La sincronización con la nube sigue sin confirmar. Los lectores semanales deben usar los manifiestos de generación; los CSV históricos de la raíz no se actualizan.
          </Text>
        </View>
      ) : null}
      <View style={{ paddingBottom: 16, paddingHorizontal: 16 }}>
        <Text style={{ color: palette.danger, fontSize: 11, fontWeight: '700', lineHeight: 16 }}>
          Sin cifrado: cualquier persona o aplicación con acceso a esa carpeta podrá leer tus datos financieros.
        </Text>
      </View>
    </SettingsSection>
  );
}
