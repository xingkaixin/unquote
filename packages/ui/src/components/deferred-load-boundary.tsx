import { Component, type ReactNode } from "react";
import { DeferredLoadError } from "./deferred-load-error";

export interface DeferredLoadBoundaryProps {
  children: ReactNode;
  resetKey: string;
}

interface DeferredLoadBoundaryState {
  failed: boolean;
}

const reloadApplication = () => {
  window.location.reload();
};

export class DeferredLoadBoundary extends Component<
  DeferredLoadBoundaryProps,
  DeferredLoadBoundaryState
> {
  state: DeferredLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): DeferredLoadBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previousProps: DeferredLoadBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? (
      <DeferredLoadError onRetry={reloadApplication} />
    ) : (
      this.props.children
    );
  }
}
