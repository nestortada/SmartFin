import { useCallback, useState } from 'react';

import {
  RNSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from '../../../native';

export function useAiSpeechInput(onTranscript: (text: string) => void) {
  const [error, setError] = useState<string>();
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent('start', () => {
    setError(undefined);
    setListening(true);
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript;
    if (transcript) onTranscript(transcript);
  });
  useSpeechRecognitionEvent('error', event => {
    setListening(false);
    if (event.error !== 'aborted') {
      setError(event.error === 'not-allowed'
        ? 'Activa el permiso de microfono para dictar.'
        : 'No se pudo reconocer la voz. Puedes continuar escribiendo.');
    }
  });

  const toggleListening = useCallback(async () => {
    if (listening) {
      RNSpeechRecognitionModule.stop();
      return;
    }
    if (!RNSpeechRecognitionModule.isRecognitionAvailable()) {
      setError('El reconocimiento de voz no esta disponible en este dispositivo.');
      return;
    }
    const permission = await RNSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError('Activa el permiso de microfono para dictar.');
      return;
    }
    RNSpeechRecognitionModule.start({
      addsPunctuation: true,
      continuous: false,
      interimResults: true,
      lang: 'es-CO',
      maxAlternatives: 1,
      recordingOptions: { persist: false },
    });
  }, [listening]);

  return { error, listening, toggleListening };
}
