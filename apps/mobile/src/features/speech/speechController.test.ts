import { describe, expect, it, vi } from "vite-plus/test";
import { createSpeechController, type SpeechEngine } from "./speechController";

function setup(prepare: () => Promise<void> = async () => {}) {
  const speak = vi.fn<SpeechEngine["speak"]>();
  const stop = vi.fn(async () => {});
  return { speak, stop, controller: createSpeechController({ prepare, speak, stop }) };
}

describe("reply speech", () => {
  it("replaces playback and ignores callbacks from the previous reply", async () => {
    const { speak, controller } = setup();
    await controller.play("a", "First reply");
    const first = speak.mock.calls[0]![1];
    await controller.play("b", "Second reply");
    first.onDone();
    first.onError(new Error("late error"));
    expect(controller.getSnapshot().activeId).toBe("b");
    expect(controller.getSnapshot().error).toBeNull();
    speak.mock.calls[1]![1].onDone();
    expect(controller.getSnapshot().activeId).toBeNull();
  });

  it("cancels preparation when the user stops or leaves the thread", async () => {
    const prepared = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const { speak, controller } = setup(() => {
      entered.resolve();
      return prepared.promise;
    });
    const playing = controller.play("a", "Never speak this");
    await entered.promise;
    await controller.stop("a");
    prepared.resolve();
    await playing;
    expect(speak).not.toHaveBeenCalled();
    expect(controller.getSnapshot().activeId).toBeNull();
  });

  it("continues long replies, restarts at the selected speed, and only stops for the owner", async () => {
    const { speak, controller } = setup();
    const text = "Hello world. ".repeat(400);
    await controller.play("a", text);
    speak.mock.calls[0]![1].onDone();
    expect(speak).toHaveBeenCalledTimes(2);
    await controller.stop("other");
    expect(controller.getSnapshot().activeId).toBe("a");
    await controller.setRate(1.5);
    expect(speak.mock.lastCall?.[1].rate).toBe(1.5);
    await controller.setRate(100);
    expect(controller.getSnapshot().rate).toBe(1.5);
    await controller.toggle("a", text);
    expect(controller.getSnapshot().activeId).toBeNull();
  });

  it("reports native failures on the affected reply and permits retry", async () => {
    const { speak, controller } = setup();
    await controller.play("a", "Read me");
    speak.mock.calls[0]![1].onError(new Error("native error"));
    expect(controller.getSnapshot()).toMatchObject({ activeId: null, errorId: "a" });
    await controller.play("a", "Read me");
    expect(controller.getSnapshot()).toMatchObject({ activeId: "a", error: null });
  });
});
