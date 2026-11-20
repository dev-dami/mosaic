// Shared workspace state. Owner: foundation. Areas import from here, never from the files inside.
export { AgentLink, MosaicProvider, useMosaic, FRESH_MS, type Actions } from "./store";
export { hasInputs, inputKeys, suggestionsFor, type Model } from "./model";
export type { Action, Conn, ConnStatus, ConnectStage, HostInfo, Receipt, Run, StageState, State, Trace, TraceStage } from "./types";
