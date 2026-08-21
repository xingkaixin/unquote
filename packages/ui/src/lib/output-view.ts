const outputViews = ["agent", "trajectory", "json"] as const;

export type OutputView = (typeof outputViews)[number];

export const isOutputView = (value: string): value is OutputView =>
  outputViews.some((view) => view === value);
