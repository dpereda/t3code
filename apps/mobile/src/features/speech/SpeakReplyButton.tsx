import { memo, useCallback, useSyncExternalStore } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, View, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import {
  initializeReplySpeech,
  replySpeech,
  setReplySpeechRate,
  subscribeReplySpeech,
} from "./speech";
import { SPEECH_RATES } from "./speechController";

export const SpeakReplyButton = memo(function SpeakReplyButton(props: {
  readonly id: string;
  readonly text: string;
  readonly tintColor: ColorValue;
  readonly buttonSize: number;
  readonly iconSize: number;
}) {
  const state = useSyncExternalStore(subscribeReplySpeech, replySpeech.getSnapshot);
  const active = state.activeId === props.id;
  useFocusEffect(
    useCallback(() => {
      void initializeReplySpeech();
      return () => {
        void replySpeech.stop(props.id);
      };
    }, [props.id]),
  );

  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? "Stop reading reply" : "Read reply aloud"}
        accessibilityState={{ selected: active }}
        accessibilityHint="Reads this reply using an on-device voice. Turn off Silent Mode to hear speech."
        hitSlop={8}
        onPress={() => {
          void replySpeech.toggle(props.id, props.text);
        }}
        style={({ pressed }) => ({
          width: props.buttonSize,
          height: props.buttonSize,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.52 : 1,
        })}
      >
        <SymbolView
          name={active ? "stop.fill" : "speaker.wave.2"}
          tintColor={props.tintColor}
          size={props.iconSize}
          type="monochrome"
        />
      </Pressable>
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Speech speed ${state.rate} times`}
          accessibilityHint="Changes reading speed and restarts the reply."
          onPress={() => {
            const index = SPEECH_RATES.findIndex((rate) => rate === state.rate);
            void setReplySpeechRate(SPEECH_RATES[(index + 1) % SPEECH_RATES.length]!);
          }}
          hitSlop={8}
          style={{
            minWidth: 44,
            minHeight: props.buttonSize,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <AppText className="text-xs tabular-nums text-foreground-secondary">
            {state.rate}×
          </AppText>
        </Pressable>
      ) : null}
      {state.error && state.errorId === props.id ? (
        <AppText accessibilityRole="alert" className="text-xs text-foreground-secondary">
          {state.error}
        </AppText>
      ) : null}
    </View>
  );
});
