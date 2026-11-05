# On-device TTS options for the iOS app

Research for dpereda/t3code#2 (map: dpereda/t3code#1). Researched 2026-11-05.

**Constraints:** on-device only, $0 running cost, Expo SDK 58 / RN 0.88 (`apps/mobile`, dev client, custom native modules in `apps/mobile/modules/*`), a speak button on AI replies with adjustable speed, and the smallest fork diff we can get.

Notation: **[fact]** comes from a cited source. **[inference]** is my judgment and has not been verified on a device.

## What upstream already ships (relevant to the diff)

- `apps/mobile/package.json` already depends on **`@react-native-ai/apple` 0.12.0** and **`expo-audio` 58.0.9**. iOS voice input already uses `@react-native-ai/apple/src/NativeAppleTranscription` (`apps/mobile/src/native/voiceTranscription.ios.ts`).
- The same package ships a **`NativeAppleSpeech` TurboModule** ([src/NativeAppleSpeech.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/NativeAppleSpeech.ts), [ios/speech/AppleSpeechImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/speech/AppleSpeechImpl.swift)) **[fact]**:
  - `getVoices()` returns `quality: default | enhanced | premium`, plus `isPersonalVoice` and `isNoveltyVoice`.
  - `generate(text, {voice, language})` runs `AVSpeechSynthesizer.write()` and returns a whole WAV `ArrayBuffer`.
  - It has **no rate option** and **no streaming**. Upstream does not use it today: grepping `apps/mobile/src` finds no speech-synthesis usage.
- `expo-speech` is **not** a dependency. Its SDK 58 release is `58.0.3` on npm.
- iOS deployment target is **18.0** (`apps/mobile/app.config.ts`, `expo-build-properties`). The oldest supported devices are therefore iPhone XS/XR (A12) **[inference from Apple's iOS 18 device list]**.
- The per-message "Copy message" action lives in `apps/mobile/src/features/threads/ThreadFeed.tsx` (around lines 405 and 2287). That is where a speak button would naturally sit.

## Comparison

| Option | Voice quality | Size / download | Time-to-first-audio, old iPhones | Adjustable rate | License | Expo integration effort | Maintenance risk |
|---|---|---|---|---|---|---|---|
| **A. `expo-speech` (AVSpeechSynthesizer)** | Default to Siri-like. Enhanced/Premium voices are good but robotic next to neural engines. Quality depends on which voices the user has downloaded **[fact/inference]** | 0 MB in the app. Premium voices (~100s of MB) are downloaded by the user in Settings > Accessibility > Spoken Content. **Apps cannot trigger or detect downloadable voices** ([forum 787779](https://developer.apple.com/forums/thread/787779), [758460](https://developer.apple.com/forums/thread/758460)) | Near-instant, streams natively, fine on A12 **[inference]** | **Yes.** `rate` multiplies `AVSpeechUtteranceDefaultSpeechRate` ([SpeechModule.swift L49](https://github.com/expo/expo/blob/main/packages/expo-speech/ios/SpeechModule.swift)). Also supports pitch, pause/resume, stop, and queueing ([docs](https://docs.expo.dev/versions/latest/sdk/speech/)) | MIT (Expo); OS voices | **Lowest.** `npx expo install expo-speech`, no config plugin, prebuild autolinks | Very low (first-party Expo) |
| **B. `@react-native-ai/apple` AppleSpeech** (already installed) | Same voices as A | 0 MB, no new dependency | Must synthesize the **whole** text to a WAV before playback starts. Long replies mean a noticeable wait unless chunked by sentence **[fact: code / inference: latency]** | Not in the synth. Would need `expo-audio` playback rate (time-stretch) **[inference]** | MIT | Zero new native code. Playback plumbing goes through `expo-audio` | Medium: a third-party package that upstream may bump or drop |
| **C. Kokoro-82M via `react-native-executorch` (Software Mansion)** | Neural, clearly better than AVSpeech **[inference, widely reported]** | **332 MB per language package**, downloaded at runtime with a progress hook ([docs](https://docs.swmansion.com/react-native-executorch/docs/extensions/text-to-speech)) | Streams sentence by sentence through an async generator. No published iPhone TTFA. Likely slow and memory-heavy on A12-A13 **[inference]** | **Yes**, `speed` option | Kokoro weights Apache-2.0 ([HF](https://huggingface.co/hexgrad/Kokoro-82M)). The executorch G2P license is **not stated** on the page | Medium: a large native runtime (ExecuTorch), new arch only, model download UI and storage handling | Medium-high: fast-moving 0.x API (now 0.11.x) |
| **D. Kokoro / Pocket / Kitten / Piper via `react-native-sherpa-onnx` (XDcobra)** | Neural. Choice of models | The sherpa-onnx XCFramework is **~80 MB**, fetched at `pod install`. Kokoro ONNX is 86-326 MB by quantization ([onnx-community](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)) | Has a streaming TTS API. No iPhone numbers. The README notes "iOS vs Android drift (length/quality)" and Pocket on iOS is "experimental" ([repo](https://github.com/XDcobra/react-native-sherpa-onnx)) | sherpa-onnx's own API has a `speed` param **[inference, not on the RN page]** | SDK MIT, sherpa-onnx Apache-2.0, ONNX Runtime MIT, **FFmpeg/Shine LGPL**. Kokoro and Piper in sherpa use **eSpeak-NG data (GPL-3.0)** **[inference: verify]** | Medium: has a config plugin (for background download only) | **High:** 43 stars, a single maintainer, breaking 0.2 to 0.3 change |
| **E. Kokoro via FluidAudio (CoreML, Swift)** | Neural | 82M params; CoreML model from HF `FluidInference/kokoro-82m-coreml`. Peak RAM **1.5 GB** on an M4 Pro ([docs](https://docs.fluidinference.com/tts/kokoro)) | **Non-streaming**: generates all frames before playback. 23x RTF on Mac. No iPhone numbers | Not documented | **Phonemizer is eSpeak-NG, GPL-3.0** (stated in the docs) | High: we would write our own Expo local module wrapping the SwiftPM product `FluidAudioWithTTS` | Medium |
| **F. Pocket TTS via FluidAudio (CoreML)** | Neural, with voice cloning. Kyutai ([repo](https://github.com/kyutai-labs/pocket-tts)) | 100M params, plus small English variants (18.2M / 6.9M / 1.9M, added Oct 2026). CoreML repo `FluidInference/pocket-tts-coreml`, compiled and cached on first load | **Streams, ~80 ms after prefill** (CoreML benchmark "planned"). Runs on CPU/GPU, not the ANE ([docs](https://docs.fluidinference.com/tts/pocket-tts)) | **No speed control** in the model. Needs `expo-audio` playback rate **[fact/inference]** | Weights **CC-BY-4.0** and **HF-gated** (accept terms) ([HF](https://huggingface.co/kyutai/pocket-tts)). Code MIT. **No phonemizer, no GPL** | High: own local module wrapping FluidAudio | Medium-high: new model, young CoreML port |
| **G. Kokoro via `kokoro-ios` / KokoroSwift (MLX)** | Neural | Model shipped separately (~300 MB class **[inference]**). Needs MLX Swift | **~3.3x real-time on iPhone 13 Pro** after warm-up ([repo](https://github.com/mlalma/kokoro-ios)). A12 is untested | Not documented | MIT. MisakiSwift G2P (eSpeak path commented out) | High: own local module plus MLX | Medium-high: small project |

## Prior upstream attempts (all closed unmerged)

| Item | What it was | Why it closed | Lesson for us |
|---|---|---|---|
| [pingdotgg/t3code#3964](https://github.com/pingdotgg/t3code/issues/3964) | Feature request: per-message "Read aloud" on desktop. Proposed browser `SpeechSynthesisUtterance` as a baseline and BYO-key cloud as an option | Locked and **converted to a discussion** by a maintainer. The request itself named the OS synth as the "smallest useful scope" | Upstream won't build this, so it has to be fork-only. A play/stop button on one message is the agreed minimum. Suggested: skip fenced code and read prose only |
| [pingdotgg/t3code#2356](https://github.com/pingdotgg/t3code/pull/2356) | Web play button calling a local Kokoro-FastAPI server (618+ lines, 14 files) | Author: "opened against the wrong repo". The bot flagged race conditions, and an error toast shown on every button | Needs **one playback owner** (single-flight singleton), per-message state keyed by message id, and a stop on thread switch |
| [pingdotgg/t3code#3630](https://github.com/pingdotgg/t3code/pull/3630) / [#3631](https://github.com/pingdotgg/t3code/pull/3631) | whisper.cpp plus a Kokoro adapter run as **server** processes, and a voice-mode orb (2002+ lines, 34 files) | Self-closed. Bot found 13-14 blocking bugs: `stop()` left the `onended` promise hanging (deadlock), cursor reset races, stale buffers after stop, an un-resumed AudioContext. The `speakableText` regex dropped "and/or" and "he/she" | Server-side TTS breaks our "stock computer" rule. For our build: keep the queue tiny and make `stop()` idempotent and cancellation-safe. Test markdown-to-speech stripping (code, URLs, paths) against prose with slashes |
| [pingdotgg/t3code#10230](https://github.com/pingdotgg/t3code/pull/10230) | "Replace Kokoro with native Pocket TTS" inside a 68k-line Jarvis rebrand (460 files): C++ Pocket daemon, worker, onset filter, SHA-256-pinned model artifacts | "Wrong target", meant for a personal fork | Pocket was picked for streaming and low latency on desktop CPU. Pinning and verifying model downloads is a good pattern if we ever ship a model. It also shows how a fork's diff balloons |

## Recommendation shortlist

1. **Ship v1 on `expo-speech` (option A).**
   - It is the only option that meets every constraint today: $0, 0 MB, instant on A12, native `rate`, stop/pause, and a single first-party dependency.
   - The diff is about one button in `ThreadFeed.tsx`, a small speak hook, and a rate setting.
   - Strip markdown before speaking (reuse `remark-parse`, which is already a dependency) **[inference]**.
   - Known gap: `expo-speech` reports Premium voices as `"Default"` (`voice.quality == .enhanced ? "Enhanced" : "Default"`, [SpeechModule.swift L70](https://github.com/expo/expo/blob/main/packages/expo-speech/ios/SpeechModule.swift)). To pick the best installed voice, call the already-installed `NativeAppleSpeech.getVoices()`, which reports `premium`, then pass its identifier to `Speech.speak({voice})`.
   - Add a one-line hint telling users to download a Premium voice in Settings.
2. **Fallback with zero new dependencies: option B** (`@react-native-ai/apple` generate, plus `expo-audio` with playback rate), but only if adding `expo-speech` turns out to be undesirable. It is worse for time-to-first-audio and rate quality.
3. **Neural upgrade later, behind the same "speaker" interface:**
   - **Pocket TTS via FluidAudio (F)** is the most promising: streaming, ~80 ms TTFA claim, no GPL phonemizer, and small variants. Costs: CC-BY attribution, an HF-gated download, no native speed control, and our own Expo local module.
   - **Kokoro via `react-native-executorch` (C)** is the easiest neural path in JS. It has `speed` and streaming, but costs a 332 MB download plus the ExecuTorch runtime.
   - Avoid eSpeak-NG-based Kokoro paths (D, E) for TestFlight distribution until GPL-3.0 implications are cleared **[inference]**.

## Open questions surfaced

- Real TTFA and memory for Pocket (FluidAudio) and Kokoro (executorch) on an A12-A14 iPhone. This needs a device spike.
- Does `expo-speech` coexist cleanly with `expo-audio`'s audio session, given the `useApplicationAudioSession` option? Should speech play while the iPhone is in silent mode? The docs say it is silent in silent mode unless the session category is set.
- Should code blocks be skipped (as #3964 suggested) or announced ("code block omitted")?
- What rate range to expose (for example 0.5x-2x) and where the setting lives (a per-device AsyncStorage key vs. the existing settings screens).
