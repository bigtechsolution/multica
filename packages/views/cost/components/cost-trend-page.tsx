"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { estimateListOptions } from "@multica/core/estimates";
import { useWorkspaceId } from "@multica/core/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@multica/ui/components/ui/table";

import { PageHeader } from "../../layout/page-header";

// Cost Trend page (Stage J). Shows architecture cost estimates over time
// for the current workspace: KPI cards for the latest run, a line chart
// of monthly_usd across all estimates, and a table of recent estimates.
//
// External-member gating is intentionally omitted — multica has no
// external/guest role yet (see project memory). When that role lands,
// gate this page at the route level rather than guessing here.

const chartConfig = {
  monthly_usd: {
    label: "Monthly (USD)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function CostTrendPage() {
  const wsId = useWorkspaceId();
  const { data, isLoading, isError } = useQuery(estimateListOptions(wsId));

  // Newest-first from the API → reverse to chronological for the chart.
  const chartData = useMemo(() => {
    const estimates = data?.estimates ?? [];
    return [...estimates]
      .reverse()
      .map((e) => ({
        date: e.created_at.slice(0, 10),
        monthly_usd: e.monthly_usd,
        spec_path: e.spec_path,
      }));
  }, [data]);

  const latest = data?.estimates[0];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-medium">Cost Trend</h1>
      </PageHeader>

      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            title="Latest monthly"
            value={latest ? currency.format(latest.monthly_usd) : "—"}
            hint={latest ? latest.spec_path : "no estimates yet"}
            loading={isLoading}
          />
          <KpiCard
            title="Latest yearly"
            value={latest ? currency.format(latest.yearly_usd) : "—"}
            hint={latest ? latest.region : "—"}
            loading={isLoading}
          />
          <KpiCard
            title="Estimates"
            value={String(total)}
            hint="all-time in workspace"
            loading={isLoading}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="size-4" />
              Monthly USD over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="aspect-[3/1] w-full" />
            ) : chartData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ChartContainer config={chartConfig} className="aspect-[3/1] w-full">
                <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={64}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          typeof value === "number" ? currency.format(value) : String(value)
                        }
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="monthly_usd"
                    stroke="var(--color-monthly_usd)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent estimates</CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? (
              <p className="text-sm text-muted-foreground">Failed to load estimates.</p>
            ) : (
              <EstimatesTable
                estimates={data?.estimates ?? []}
                loading={isLoading}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  title,
  value,
  hint,
  loading,
}: {
  title: string;
  value: string;
  hint: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex aspect-[3/1] w-full items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
      No estimates yet — run aws-spec-to-cost against an architecture.yaml to produce one.
    </div>
  );
}

function EstimatesTable({
  estimates,
  loading,
}: {
  estimates: ReturnType<typeof useEstimateRows>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (estimates.length === 0) {
    return <p className="text-sm text-muted-foreground">No estimates yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Spec</TableHead>
          <TableHead>Region</TableHead>
          <TableHead className="text-right">Monthly</TableHead>
          <TableHead className="text-right">Yearly</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {estimates.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="font-mono text-xs tabular-nums">
              {e.created_at.slice(0, 19).replace("T", " ")}
            </TableCell>
            <TableCell className="font-mono text-xs">{e.spec_path}</TableCell>
            <TableCell className="text-xs">{e.region}</TableCell>
            <TableCell className="text-right tabular-nums">{currency.format(e.monthly_usd)}</TableCell>
            <TableCell className="text-right tabular-nums">{currency.format(e.yearly_usd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Helper type alias so EstimatesTable typing stays in lockstep with the
// shape `estimateListOptions` returns. Avoids re-importing the full
// ArchitectureEstimate type across the file.
function useEstimateRows() {
  return [] as Array<{
    id: string;
    spec_path: string;
    region: string;
    monthly_usd: number;
    yearly_usd: number;
    created_at: string;
  }>;
}
