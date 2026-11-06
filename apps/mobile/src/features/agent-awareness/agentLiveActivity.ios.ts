import AgentActivity, { type AgentActivityProps } from "../../widgets/AgentActivity";
import Constants from "expo-constants";

export function dismissEndedAgentLiveActivities() {
  AgentActivity.dismissEnded();
}

export function getAgentLiveActivities() {
  return AgentActivity.getInstances();
}

export function startAgentLiveActivity(props: AgentActivityProps, staleDate?: Date) {
  const scheme = Constants.expoConfig?.scheme;
  const appScheme = (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code";
  return AgentActivity.start({ ...props, appScheme }, undefined, staleDate);
}
