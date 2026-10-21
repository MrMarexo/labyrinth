/** Spec §8: replay runs at a fixed pace, not the recorded intervals. */
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
export const BASE_MOVES_PER_SECOND = 4;

export function tickMs(speed: Speed): number {
  return 1000 / (BASE_MOVES_PER_SECOND * speed);
}

/**
 * The viewer's position in the timeline. `live` means the run is still
 * going; `following` means the viewer is at the live edge and new moves
 * should carry them along. A viewer who scrubs back stops following until
 * they return to the edge or jump to it.
 */
export type Playback = {
  step: number;
  length: number;
  playing: boolean;
  speed: Speed;
  live: boolean;
  following: boolean;
};

export type PlaybackAction =
  | { type: "tick" }
  | { type: "scrub"; step: number }
  /** Relative to the current step, so a key handler needs no state. */
  | { type: "step"; by: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; speed: Speed }
  | { type: "arrived"; length: number; live: boolean }
  | { type: "jumpToLive" };

export function initialPlayback(length: number, live: boolean): Playback {
  return {
    step: live ? length : 0,
    length,
    playing: false,
    speed: 1,
    live,
    following: live,
  };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

function scrubTo(state: Playback, target: number): Playback {
  const step = clamp(target, state.length);
  return { ...state, step, following: state.live && step === state.length };
}

export function playback(state: Playback, action: PlaybackAction): Playback {
  switch (action.type) {
    case "tick": {
      if (state.step >= state.length) return { ...state, playing: false };
      const step = state.step + 1;
      return { ...state, step, following: state.live && step === state.length };
    }
    case "scrub":
      return scrubTo(state, action.step);
    case "step":
      return scrubTo(state, state.step + action.by);
    case "play":
      // At the end of a finished run, play means "watch it again".
      if (state.step >= state.length && !state.live) {
        return { ...state, step: 0, playing: true, following: false };
      }
      return { ...state, playing: true };
    case "pause":
      return { ...state, playing: false };
    case "speed":
      return { ...state, speed: action.speed };
    case "arrived": {
      const length = Math.max(state.length, action.length);
      return {
        ...state,
        length,
        live: action.live,
        step: state.following ? length : state.step,
        following: state.following && action.live,
      };
    }
    case "jumpToLive":
      return {
        ...state,
        step: state.length,
        playing: false,
        following: state.live,
      };
  }
}
