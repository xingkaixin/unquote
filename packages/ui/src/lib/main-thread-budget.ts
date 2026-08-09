/**
 * The largest input the synchronous no-Worker fallback will parse or search
 * when work scales with source size. User regex is rejected before this budget
 * because its backtracking cost cannot be bounded from input bytes.
 *
 * A synchronous parse or search cannot be interrupted once it starts — a timer
 * cannot preempt it — so the only protection is refusing the work up front,
 * using a fact available beforehand: the input size.
 *
 * The number comes from the release benchmark rather than taste. UQ-161
 * measured ~440ms to parse a 3.18MB document, so a 100ms response budget (the
 * RAIL guideline for reacting to input) lands near 700KB. This path is most
 * likely to run on the slower hosts that lack workers at all — restricted
 * WebViews, strict CSP, a failed worker script — so the ceiling is rounded down
 * to 512KB.
 */
export const mainThreadWorkBudgetBytes = 512 * 1024;

export const isWithinMainThreadBudget = (bytes: number) => bytes <= mainThreadWorkBudgetBytes;
