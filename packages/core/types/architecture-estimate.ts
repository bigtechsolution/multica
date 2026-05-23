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
