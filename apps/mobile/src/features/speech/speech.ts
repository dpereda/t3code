import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { AppState } from "react-native";

import { createSpeechController } from "./speechController";

const RATE_KEY = "reply-speech-rate";
let voice: string | undefined;

export const replySpeech = createSpeechController({
  prepare: async () => {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
      const language = locale.split("-")[0];
      const voices = await Speech.getAvailableVoicesAsync();
      voice = voices
        .filter((candidate) => candidate.language.toLowerCase().split("-")[0] === language)
        .sort((a, b) => {
          const score = (candidate: Speech.Voice) =>
            (candidate.quality === Speech.VoiceQuality.Enhanced ? 10 : 0) +
            (candidate.identifier.toLowerCase().includes("premium") ? 20 : 0) +
            (candidate.language.toLowerCase() === locale ? 2 : 0);
          return score(b) - score(a);
        })[0]?.identifier;
    } catch {
      voice = undefined;
    }
  },
  stop: Speech.stop,
  speak: (text, options) =>
    Speech.speak(text, {
      ...options,
      voice,
      useApplicationAudioSession: false,
    }),
});

let initialization: Promise<void> | undefined;
let rateChanged = false;
let rateWrites = Promise.resolve();

export function initializeReplySpeech(): Promise<void> {
  initialization ??= AsyncStorage.getItem(RATE_KEY)
    .then(async (value) => {
      if (!rateChanged && value !== null && replySpeech.getSnapshot().activeId === null) {
        await replySpeech.setRate(Number(value));
      }
    })
    .catch(() => {});
  return initialization;
}

export async function setReplySpeechRate(rate: number): Promise<void> {
  rateChanged = true;
  const playing = replySpeech.setRate(rate);
  rateWrites = rateWrites.then(() => AsyncStorage.setItem(RATE_KEY, String(rate))).catch(() => {});
  await playing;
}

const subscribers = new Set<() => void>();
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;

export function subscribeReplySpeech(listener: () => void): () => void {
  const unsubscribe = replySpeech.subscribe(listener);
  subscribers.add(listener);
  appStateSubscription ??= AppState.addEventListener("change", (state) => {
    if (state !== "active" && replySpeech.getSnapshot().activeId !== null) void replySpeech.stop();
  });
  return () => {
    unsubscribe();
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      appStateSubscription?.remove();
      appStateSubscription = undefined;
    }
  };
}
