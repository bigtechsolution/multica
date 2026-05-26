-- Stage J demo seed. Idempotent: re-running deletes existing demo rows
-- (tagged with a synthetic spec_hash prefix) and re-inserts a fresh series.
-- Targets the kgc-isp workspace.
--
-- Usage:
--   docker exec -i multica-postgres-1 psql -U multica -d multica < scripts/seed-cost-trend-demo.sql

\set ws_id '''f336b875-b493-49cb-b283-fea07fa6db55'''

-- 1. Tear down old demo data first (FK ordering: estimates → snapshot).
DELETE FROM architecture_estimate
WHERE workspace_id = :ws_id AND spec_hash LIKE 'demo-%';

DELETE FROM pricing_snapshot
WHERE source = 'demo';

-- 2. Pricing snapshot the estimates anchor to.
INSERT INTO pricing_snapshot (id, region, source, captured_at, services, raw_meta)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'ap-northeast-2',
    'demo',
    now() - interval '14 days',
    '{}'::jsonb,
    '{"note": "demo snapshot for Stage J cost-trend page"}'::jsonb
);

-- 3. Estimates over the last 14 days — three specs, costs trending up
--    over time as scale grows. Numbers picked to fit the chart Y-axis.
INSERT INTO architecture_estimate (
    workspace_id, issue_id, spec_hash, spec_path, pricing_snapshot_id,
    region, monthly_usd, yearly_usd, breakdown, cost_md, created_at
)
VALUES
    (:ws_id, NULL, 'demo-001', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     1820.50, 21846.00, '[]'::jsonb, '', now() - interval '14 days'),
    (:ws_id, NULL, 'demo-002', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     1845.25, 22143.00, '[]'::jsonb, '', now() - interval '12 days'),
    (:ws_id, NULL, 'demo-003', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2110.75, 25329.00, '[]'::jsonb, '', now() - interval '10 days'),
    (:ws_id, NULL, 'demo-004', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2098.10, 25177.20, '[]'::jsonb, '', now() - interval '8 days'),
    (:ws_id, NULL, 'demo-005', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2455.00, 29460.00, '[]'::jsonb, '', now() - interval '6 days'),
    (:ws_id, NULL, 'demo-006', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2510.40, 30124.80, '[]'::jsonb, '', now() - interval '4 days'),
    (:ws_id, NULL, 'demo-007', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2890.20, 34682.40, '[]'::jsonb, '', now() - interval '2 days'),
    (:ws_id, NULL, 'demo-008', 'infra/architecture.yaml',
     '11111111-1111-1111-1111-111111111111', 'ap-northeast-2',
     2920.75, 35049.00, '[]'::jsonb, '', now() - interval '6 hours');

\echo '✓ seeded 1 pricing_snapshot + 8 architecture_estimate rows for kgc-isp'
