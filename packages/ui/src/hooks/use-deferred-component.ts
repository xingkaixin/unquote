import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";

type DeferredComponentState<TProps> =
  | { status: "idle"; component: null }
  | { status: "loading"; component: null }
  | { status: "ready"; component: ComponentType<TProps> }
  | { status: "error"; component: null };

export const useDeferredComponent = <TProps>(
  load: () => Promise<ComponentType<TProps>>,
  enabled: boolean,
) => {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DeferredComponentState<TProps>>({
    status: "idle",
    component: null,
  });

  useEffect(() => {
    if (!enabled || state.status === "ready") {
      return;
    }

    let active = true;
    setState({ status: "loading", component: null });
    void load().then(
      (component) => {
        if (active) {
          setState({ status: "ready", component });
        }
      },
      () => {
        if (active) {
          setState({ status: "error", component: null });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, enabled, load]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return {
    component: state.component,
    loading: state.status === "loading",
    failed: state.status === "error",
    retry,
  };
};
