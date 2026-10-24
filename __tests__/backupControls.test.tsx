import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { GlassButton, type SettingsPalette } from '../src/modules/settings/ui/components/primitives';
import { backupProgressMessage } from '../src/modules/settings/services/backupProgressPresentation';
import { DriveBackupSection } from '../src/modules/settings/ui/components/DriveBackupSection';

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

test('backup control exposes its label, button role and disabled state to Android accessibility', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(<GlassButton label="Verificar" onPress={jest.fn()} disabled palette={{} as SettingsPalette} />); });
    const button = view.root.findAllByProps({ accessibilityRole: 'button' })[0];
    if (!button) throw new Error('Accessible backup button missing');
    expect(button.props).toMatchObject({
      disabled: true, accessibilityRole: 'button', accessibilityLabel: 'Verificar', accessibilityState: { disabled: true },
    });
  } finally {
    if (view) await act(async () => view.unmount());
    consoleError.mockRestore();
  }
});

test('recovery messages distinguish actual phases and verified SAF from remote synchronization', () => {
  const phases = ['recovering', 'inspectingSnapshot', 'validatingComponents', 'continuingPublication', 'verified', 'failed', 'uncertain'] as const;
  const messages = phases.map(state => backupProgressMessage({ state }));
  expect(new Set(messages).size).toBe(phases.length);
  expect(messages[4]).toContain('SAF');
  expect(messages[4]).toContain('remota sin confirmar');
  expect(backupProgressMessage({ state: 'capturing' })).toContain('6 segundos');
});

test('revoked access takes priority over an outdated configured folder and pending work', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(<DriveBackupSection
      backupStatus={{ available: true, configured: true, accessNeedsRenewal: true, outdated: true,
        localRevision: 1, permissionPersistent: false, pendingJobs: [{ id: 'synthetic', state: 'uncertain', completedFiles: 0, totalFiles: 14 }] }}
      onChooseDirectory={async () => {}} onExport={async () => {}} palette={{} as SettingsPalette} />); });
    expect(JSON.stringify(view.toJSON())).toContain('Android perdió el acceso');
    expect(view.root.findAllByType(GlassButton).map(button => button.props.label)).toEqual(['Elegir carpeta']);
  } finally {
    if (view) await act(async () => view.unmount());
    consoleError.mockRestore();
  }
});
