import type { ComponentType } from "react";
import { useDeferredComponent } from "../hooks/use-deferred-component";

export class DeferredComponentLoadError extends Error {
  constructor() {
    super("Deferred component failed to load");
    this.name = "DeferredComponentLoadError";
  }
}

// React.lazy reveals a resolved chunk in a Suspense retry, which React 19
// throttles to 300 ms after the fallback commit. Rendering nothing until the
// module resolves keeps the reveal in an ordinary update.
export const deferredComponent = <TProps extends object>(
  load: () => Promise<ComponentType<TProps>>,
) => {
  let loaded: ComponentType<TProps> | null = null;
  let pending: Promise<ComponentType<TProps>> | null = null;

  const preload = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Loader rejections are not restricted to Error instances.
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  const DeferredComponent = (props: TProps) => {
    const deferred = useDeferredComponent(preload, loaded === null);
    if (deferred.failed) {
      throw new DeferredComponentLoadError();
    }

    const Component = loaded ?? deferred.component;
    return Component ? <Component {...props} /> : null;
  };

  return Object.assign(DeferredComponent, { preload });
};
