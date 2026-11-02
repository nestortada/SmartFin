// Phase 0 · 5 Speech recognition. Static evidence only: what SmartFin asks the native recognizer for.
// Whether the device recognizes offline cannot be proven in Node; it stays pending until a device test.
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useAiSpeechInput } from '../../src/modules/transactions/hooks/useAiSpeechInput';
import { phase0Evidence } from './phase0Evidence';

jest.mock('rn-speech-recognition', () => {
  // No type annotations here: jest-hoist rejects their parameter names as out-of-scope variables.
  const listeners = new Map();
  return {
    listeners,
    RNSpeechRecognitionModule: {
      isRecognitionAvailable: jest.fn(() => true),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      start: jest.fn(),
      stop: jest.fn(),
    },
    useSpeechRecognitionEvent: (name: string, listener: unknown) => { listeners.set(name, listener); },
  };
});
const { listeners, RNSpeechRecognitionModule: speech } = jest.requireMock('rn-speech-recognition') as {
  listeners: Map<string, (event: unknown) => void>;
  RNSpeechRecognitionModule: { start: jest.Mock };
};

const evidence = phase0Evidence('speechRecognition');

function useProbe() {
  const state = useAiSpeechInput(() => undefined);
  probe.current = state;
  return null;
}
const probe: { current?: ReturnType<typeof useAiSpeechInput> } = {};
function Probe() { return useProbe(); }

test('SmartFin starts the default system recognizer without requesting on-device recognition', async () => {
  await act(async () => { create(<Probe />); });
  await act(async () => probe.current!.toggleListening());
  expect(speech.start).toHaveBeenCalledTimes(1);
  const options = speech.start.mock.calls[0]![0];
  expect(options).toEqual({ addsPunctuation: true, continuous: false, interimResults: true, lang: 'es-CO', maxAlternatives: 1, recordingOptions: { persist: false } });
  expect(options).not.toHaveProperty('requiresOnDeviceRecognition');
  expect(options).not.toHaveProperty('androidRecognitionServicePackage');

  // A network failure of the recognizer service reaches the user as a generic message.
  await act(async () => listeners.get('error')!({ error: 'network', message: 'Other network related errors.' }));
  expect(probe.current!.error).toBe('No se pudo reconocer la voz. Puedes continuar escribiendo.');
  evidence.startOptions = { status: 'notExecutable', observed: { options, networkErrorMessage: probe.current!.error },
    note: 'Without requiresOnDeviceRecognition the library calls SpeechRecognizer.createSpeechRecognizer (system default service), which may use the network. Offline behavior requires a controlled device test.' };
});
