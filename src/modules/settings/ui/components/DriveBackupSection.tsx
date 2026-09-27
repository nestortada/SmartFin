import React from 'react';
import { Text, View } from 'react-native';

import type { DriveBackupStatus } from '../../services';
import {
  GlassButton,
  Icon,
  SettingsRow,
  SettingsSection,
  type SettingsPalette,
} from './primitives';

type DriveBackupSectionProps = {
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
  backupStatus,
  onChooseDirectory,
  onExport,
  palette,
}: DriveBackupSectionProps) {
  if (backupStatus?.available === false) return null;

  const configured = backupStatus?.configured === true;
  const stateText = !configured
    ? backupStatus?.accessNeedsRenewal
      ? 'Android perdió el acceso. Vuelve a seleccionar la carpeta.'
      : 'Selecciona una carpeta de Google Drive desde el selector de Android.'
    : backupStatus.outdated
      ? `Respaldo desactualizado en ${backupStatus.locationName ?? 'la carpeta elegida'}`
      : `Archivos escritos y al día en ${backupStatus.locationName ?? 'la carpeta elegida'}`;

  return (
    <SettingsSection palette={palette} title="Respaldo en Google Drive">
      <SettingsRow
        icon={<Icon color={backupStatus?.outdated ? palette.danger : palette.primary} name="cloud-upload" />}
        label="Base completa y CSV por año"
        palette={palette}
        supportingText={`${stateText} ${formatBackupDate(backupStatus?.lastBackupAt)}`}
        trailing={
          <GlassButton
            label={configured ? 'Cambiar carpeta' : 'Elegir carpeta'}
            onPress={() => { void onChooseDirectory(); }}
            palette={palette}
          />
        }
      />
      {configured ? (
        <SettingsRow
          icon={<Icon color={palette.tertiary} name="sync" />}
          label="Actualizar archivos ahora"
          palette={palette}
          supportingText="Reemplaza smartfin-backup.db y genera movimientos-AAAA.csv."
          trailing={
            <GlassButton
              label="Actualizar"
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
            “Al día” confirma que SmartFin escribió y verificó los archivos. La subida a la nube la confirma Google Drive con “Carga completa”.
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
