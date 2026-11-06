import { speechChunks, speechText } from "./speechText";

export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface SpeechEngine {
  readonly prepare: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly speak: (
    text: string,
    options: {
      readonly rate: number;
      readonly onDone: () => void;
      readonly onStopped: () => void;
      readonly onError: (error: Error) => void;
    },
  ) => void;
}

export function createSpeechController(engine: SpeechEngine) {
  let snapshot: {
    readonly activeId: string | null;
    readonly rate: number;
    readonly error: string | null;
    readonly errorId: string | null;
  } = {
    activeId: null,
    rate: 1,
    error: null,
    errorId: null,
  };
  let generation = 0;
  let operations = Promise.resolve();
  let currentText = "";
  const listeners = new Set<() => void>();
  const update = (next: typeof snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const stopEngine = () => {
    const stopped = operations.then(() => engine.stop());
    operations = stopped.catch(() => {});
    return stopped;
  };
  const stop = async (ownerId?: string) => {
    if (ownerId !== undefined && snapshot.activeId !== ownerId) return;
    const request = ++generation;
    currentText = "";
    const stoppedId = snapshot.activeId;
    update({ ...snapshot, activeId: null, error: null, errorId: null });
    try {
      await stopEngine();
    } catch {
      if (generation === request)
        update({ ...snapshot, error: "Could not stop speech. Try again.", errorId: stoppedId });
    }
  };
  const play = async (id: string, markdown: string) => {
    const text = speechText(markdown);
    if (!text) return;
    const request = ++generation;
    currentText = markdown;
    update({ ...snapshot, activeId: id, error: null, errorId: null });
    const fail = () => {
      if (generation !== request) return;
      ++generation;
      update({
        ...snapshot,
        activeId: null,
        error: "Could not read this reply. Try again.",
        errorId: id,
      });
    };
    try {
      await stopEngine();
      if (generation !== request) return;
      await engine.prepare();
      if (generation !== request) return;
      const chunks = speechChunks(text);
      const next = (index: number) => {
        if (generation !== request) return;
        const chunk = chunks[index];
        if (chunk === undefined) {
          update({ ...snapshot, activeId: null });
          return;
        }
        engine.speak(chunk, {
          rate: snapshot.rate,
          onDone: () => {
            try {
              next(index + 1);
            } catch {
              fail();
            }
          },
          onStopped: () => {
            if (generation === request) update({ ...snapshot, activeId: null });
          },
          onError: fail,
        });
      };
      next(0);
    } catch {
      fail();
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play,
    stop,
    toggle: (id: string, markdown: string) =>
      snapshot.activeId === id ? stop() : play(id, markdown),
    setRate: async (rate: number) => {
      if (!SPEECH_RATES.some((candidate) => candidate === rate)) return;
      update({ ...snapshot, rate });
      if (snapshot.activeId !== null) await play(snapshot.activeId, currentText);
    },
  };
}
