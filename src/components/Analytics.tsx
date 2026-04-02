import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Ghost, Sparkles } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts';

interface AnalyticsProps {
  onBack: () => void;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_caption_1: 'Missing Caption',
  metas_without_values: 'Meta Issues',
  repeated_caption_1: 'Repeated Caption',
  repeated_caption_combo: 'Repeated Caption Combo',
  stale_evergreen: 'Stale Evergreen',
  abc_missing_tnc: 'ABC Missing T&C',
  abc_repeated_tnc: 'ABC Repeated T&C',
  duplicate_code: 'Duplicate Code',
  broken_redirect_url: 'Broken URL',
  caption_title_mismatch: 'Caption-Title Mismatch',
};

const COLORS = ['hsl(221, 83%, 53%)', 'hsl(262, 83%, 58%)', 'hsl(339, 82%, 51%)', 'hsl(25, 95%, 53%)', 'hsl(142, 71%, 45%)', 'hsl(47, 96%, 53%)', 'hsl(199, 89%, 48%)', 'hsl(173, 58%, 39%)'];

const Analytics = ({ onBack }: AnalyticsProps) => {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['sync-snapshots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_snapshots')
        .select('*')
        .order('synced_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: currentIssues } = useQuery({
    queryKey: ['analytics-current-issues'],
    queryFn: async () => {
      const all: any[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('issues')
          .select('issue_type, status, assigned_email, created_at')
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (data) all.push(...data);
        if (!data || data.length < PAGE) break;
        offset += PAGE;
      }
      return all;
    },
  });

  const { data: editors } = useQuery({
    queryKey: ['analytics-editors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('editors').select('email, name, role');
      if (error) throw error;
      return data;
    },
  });

  const stats = useMemo(() => {
    if (!currentIssues) return null;

    const total = currentIssues.length;
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byEditor: Record<string, number> = {};

    for (const issue of currentIssues) {
      byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
      const t = issue.issue_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
      const e = issue.assigned_email || 'unassigned';
      byEditor[e] = (byEditor[e] || 0) + 1;
    }

    return { total, byStatus, byType, byEditor };
  }, [currentIssues]);

  const snapshotChartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    // Group by sync run
    const byRun = new Map<string, { date: string; total: number; resolved: number; disappeared: number; newIssues: number }>();
    for (const s of snapshots) {
      const date = new Date(s.synced_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const key = s.sync_run_id;
      if (!byRun.has(key)) byRun.set(key, { date, total: 0, resolved: 0, disappeared: 0, newIssues: 0 });
      const entry = byRun.get(key)!;
      entry.total += s.issue_count;
      entry.resolved += s.issues_resolved;
      entry.disappeared += s.issues_disappeared;
      entry.newIssues += s.issues_new;
    }

    return Array.from(byRun.values());
  }, [snapshots]);

  const typeDistribution = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byType)
      .map(([type, count]) => ({ name: ISSUE_TYPE_LABELS[type] || type, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const topEditors = useMemo(() => {
    if (!stats || !editors) return [];
    return Object.entries(stats.byEditor)
      .map(([email, count]) => {
        const editor = editors.find(e => e.email.toLowerCase() === email.toLowerCase());
        return { name: editor?.name || email.split('@')[0], email, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [stats, editors]);

  const hasHistory = snapshotChartData.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Analytics
          </h2>
          <p className="text-sm text-muted-foreground">Issue resolution tracking & trends</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <AlertTriangle className="h-4 w-4" />
              Total Open
            </div>
            <p className="text-3xl font-bold">{stats?.byStatus?.open || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Resolved
            </div>
            <p className="text-3xl font-bold">{stats?.byStatus?.done || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingDown className="h-4 w-4 text-orange-500" />
              Ignored
            </div>
            <p className="text-3xl font-bold">{stats?.byStatus?.ignored || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Ghost className="h-4 w-4 text-purple-500" />
              Disappeared
            </div>
            <p className="text-3xl font-bold">
              {hasHistory ? snapshotChartData.reduce((s, d) => s + d.disappeared, 0) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Fixed without status change</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      {hasHistory ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Issue Trends Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="total" name="Total Issues" stroke="hsl(221, 83%, 53%)" strokeWidth={2} />
                <Line type="monotone" dataKey="newIssues" name="New" stroke="hsl(339, 82%, 51%)" strokeWidth={2} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="hsl(142, 71%, 45%)" strokeWidth={2} />
                <Line type="monotone" dataKey="disappeared" name="Disappeared" stroke="hsl(262, 83%, 58%)" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Trend data will appear after the next sync</p>
            <p className="text-sm">Each sync creates a snapshot for tracking changes over time</p>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Issue type distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {typeDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={typeDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="name" type="category" width={140} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="value" name="Issues" fill="hsl(221, 83%, 53%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            )}
          </CardContent>
        </Card>

        {/* Top editors by issue count */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 10 Editors by Open Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {topEditors.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topEditors} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" name="Open Issues" fill="hsl(339, 82%, 51%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historical breakdown per sync */}
      {hasHistory && snapshotChartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync-by-Sync Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar dataKey="total" name="Total" fill="hsl(221, 83%, 53%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="newIssues" name="New" fill="hsl(339, 82%, 51%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="disappeared" name="Disappeared" fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Analytics;
