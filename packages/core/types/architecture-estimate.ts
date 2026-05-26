/**
 * Architecture cost estimate produced by the aws-spec-to-cost /
 * aws-spec-to-bom skills. One row per (spec, snapshot) computation —
 * see `server/migrations/108_architecture_estimate.up.sql`.
 *
 * `breakdown` is the per-resource line-item array the markdown report
 * is rendered from. Its shape is skill-output-defined and we keep it
 * loose here; the trend page only reads top-level totals.
 */
export interface ArchitectureEstimate {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  spec_hash: string;
  spec_path: string;
  pricing_snapshot_id: string;
  region: string;
  monthly_usd: number;
  yearly_usd: number;
  breakdown: ArchitectureEstimateBreakdownItem[];
  /**
   * Snapshot of the llmpolicy.Decision that ran the task producing this
   * estimate. Empty object = no decision recorded (pre-Stage-G demo
   * rows). See server/internal/llmpolicy/decision.go for the canonical
   * shape; every field is optional here so unknown layers/providers
   * round-trip cleanly.
   */
  routing_decision: {
    layer?: "L1" | "L2" | "L3";
    reason?: string;
    policy?: "hybrid" | "local_only" | "cloud_first";
    override?: "local" | "cloud";
    provider?: string;
    redact_external?: boolean;
  };
  created_at: string;
}

/** Conservative line-item shape — every field is optional because the
 *  generator emits multiple flavors (per-section subtotals vs per-resource
 *  rows) and the UI only reads what it finds. */
export interface ArchitectureEstimateBreakdownItem {
  section?: string;
  resource?: string;
  qty?: number;
  monthly_usd?: number;
  yearly_usd?: number;
  unit?: string;
  notes?: string;
}
