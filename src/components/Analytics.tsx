import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Ghost, Sparkles, ShieldAlert, ClipboardCheck, Ban, EyeOff, Calendar, Users, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, Cell } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface AnalyticsProps {
  onBack: () => void;
}

type Severity = 'issue' | 'warning';

const ISSUE_TYPE_META: Record<string, { label: string; severity: Severity }> = {
  missing_caption_1: { label: 'Non-Numerical Caption 1', severity: 'warning' },
  metas_without_values: { label: 'Meta Issues', severity: 'issue' },
  repeated_caption_1: { label: 'Repeated Caption', severity: 'warning' },
  repeated_caption_combo: { label: 'Repeated Caption Combo', severity: 'warning' },
  stale_evergreen: { label: 'Stale Evergreen', severity: 'warning' },
  abc_missing_tnc: { label: 'ABC Missing T&C', severity: 'issue' },
  abc_repeated_tnc: { label: 'ABC Repeated T&C', severity: 'warning' },
  duplicate_code: { label: 'Duplicate Code', severity: 'issue' },
  broken_redirect_url: { label: 'Broken URL', severity: 'issue' },
  caption_title_mismatch: { label: 'Caption-Title Mismatch', severity: 'issue' },
  multiple_manual_picks: { label: 'Multiple Manual Picks', severity: 'warning' },
  similar_titles: { label: 'Similar Titles', severity: 'warning' },
};

const getLabel = (type: string) => ISSUE_TYPE_META[type]?.label || type;
const getSeverity = (type: string): Severity => ISSUE_TYPE_META[type]?.severity || 'issue';

const COLORS = ['hsl(221, 83%, 53%)', 'hsl(262, 83%, 58%)', 'hsl(339, 82%, 51%)', 'hsl(25, 95%, 53%)', 'hsl(142, 71%, 45%)', 'hsl(47, 96%, 53%)', 'hsl(199, 89%, 48%)', 'hsl(173, 58%, 39%)'];

const STATUS_COLORS: Record<string, string> = {
  open: 'hsl(339, 82%, 51%)',
  in_progress: 'hsl(221, 83%, 53%)',
  resolved: 'hsl(142, 71%, 45%)',
  wont_fix: 'hsl(25, 95%, 53%)',
  hidden_3m: 'hsl(262, 83%, 58%)',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  wont_fix: "Won't Fix",
  hidden_3m: 'Hidden 3 months',
};

// Helper: get ISO week number
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getWeekLabel(d: Date): string {
  return `W${getISOWeek(d)} ${d.getFullYear()}`;
}

function getMonthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getDayLabel(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

const Analytics = ({ onBack }: AnalyticsProps) => {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [editorFilter, setEditorFilter] = useState<string>('all');
  const [comparisonMode, setComparisonMode] = useState<'none' | 'wow' | 'mom'>('none');

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
          .select('issue_type, status, assigned_email, created_at, hidden_until')
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
      const { data, error } = await supabase.from('editors').select('email, name, role, team_lead_email');
      if (error) throw error;
      return data;
    },
  });

  const { data: statusUpdates } = useQuery({
    queryKey: ['analytics-status-updates'],
    queryFn: async () => {
      const all: any[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('issue_status_updates')
          .select('updated_by_email, new_status, old_status, created_at, issue_type, assigned_email_snapshot')
          .order('created_at', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (data) all.push(...data);
        if (!data || data.length < PAGE) break;
        offset += PAGE;
      }
      return all;
    },
  });

  // Team leads for team filter
  const teamLeads = useMemo(() => {
    if (!editors) return [];
    const tls = editors.filter(e => e.role === 'team_lead');
    const seen = new Set<string>();
    return tls.filter(tl => {
      const key = (tl.name || tl.email.split('@')[0]).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [editors]);

  // Get team member emails for a team lead
  const getTeamEmails = (teamLeadEmail: string): Set<string> => {
    if (!editors) return new Set();
    const tl = editors.find(e => e.email.toLowerCase() === teamLeadEmail.toLowerCase());
    const tlName = (tl?.name || teamLeadEmail.split('@')[0]).toLowerCase();
    const allTlEmails = editors
      .filter(e => e.role === 'team_lead' && (e.name || e.email.split('@')[0]).toLowerCase() === tlName)
      .map(e => e.email.toLowerCase());
    const members = editors
      .filter(e => e.team_lead_email && allTlEmails.includes(e.team_lead_email.toLowerCase()))
      .map(e => e.email.toLowerCase());
    return new Set(members);
  };

  // All unique editor names for filter
  const editorOptions = useMemo(() => {
    if (!editors) return [];
    return editors
      .filter(e => e.role === 'editor' || e.role === 'team_lead')
      .map(e => ({ email: e.email, name: e.name || e.email.split('@')[0] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editors]);

  // Status summary cards
  const stats = useMemo(() => {
    if (!currentIssues) return null;
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const issue of currentIssues) {
      byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
      const t = issue.issue_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }
    return { total: currentIssues.length, byStatus, byType };
  }, [currentIssues]);

  // Total actions from status updates (matches team performance)
  const actionStats = useMemo(() => {
    if (!statusUpdates) return null;
    const byStatus: Record<string, number> = {};
    for (const u of statusUpdates) {
      byStatus[u.new_status] = (byStatus[u.new_status] || 0) + 1;
    }
    const total = statusUpdates.length;
    return { total, byStatus };
  }, [statusUpdates]);

  // Trend chart data from snapshots
  const snapshotChartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    // Aggregate by day (not sync_run_id) to avoid duplicate date labels
    const byDay = new Map<string, { date: string; sortKey: string; total: number; resolved: number; disappeared: number; newIssues: number; syncCount: number }>();
    for (const s of snapshots) {
      const d = new Date(s.synced_at);
      const dayKey = d.toISOString().slice(0, 10);
      const dateLabel = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      if (!byDay.has(dayKey)) byDay.set(dayKey, { date: dateLabel, sortKey: dayKey, total: 0, resolved: 0, disappeared: 0, newIssues: 0, syncCount: 0 });
      const entry = byDay.get(dayKey)!;
      // For total, take the max from any sync run that day (latest snapshot count)
      entry.total = Math.max(entry.total, s.issue_count);
      entry.resolved += s.issues_resolved;
      entry.disappeared += s.issues_disappeared;
      entry.newIssues += s.issues_new;
      entry.syncCount++;
    }
    return Array.from(byDay.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [snapshots]);

  const typeDistribution = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byType)
      .map(([type, count]) => ({ name: getLabel(type), value: count, severity: getSeverity(type) }))
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'issue' ? -1 : 1;
        return b.value - a.value;
      });
  }, [stats]);

  // Editor performance data grouped by time range
  const performanceData = useMemo(() => {
    if (!statusUpdates || !editors) return [];

    // Filter by selected editor or team
    let filteredUpdates = statusUpdates;
    if (editorFilter.startsWith('team:')) {
      const teamLeadEmail = editorFilter.replace('team:', '');
      const teamEmails = getTeamEmails(teamLeadEmail);
      filteredUpdates = statusUpdates.filter((u: any) => teamEmails.has(u.updated_by_email?.toLowerCase()));
    } else if (editorFilter !== 'all') {
      filteredUpdates = statusUpdates.filter((u: any) => u.updated_by_email?.toLowerCase() === editorFilter.toLowerCase());
    }

    // Group by period + editor
    const grouped = new Map<string, Map<string, Record<string, number>>>();
    for (const u of filteredUpdates) {
      const d = new Date(u.created_at);
      let period: string;
      if (timeRange === 'daily') period = getDayLabel(d);
      else if (timeRange === 'weekly') period = getWeekLabel(d);
      else period = getMonthLabel(d);

      const email = u.updated_by_email?.toLowerCase() || 'unknown';
      if (!grouped.has(period)) grouped.set(period, new Map());
      const periodMap = grouped.get(period)!;
      if (!periodMap.has(email)) periodMap.set(email, {});
      const statuses = periodMap.get(email)!;
      statuses[u.new_status] = (statuses[u.new_status] || 0) + 1;
    }

    const rows: { period: string; email: string; name: string; statuses: Record<string, number>; total: number }[] = [];
    for (const [period, periodMap] of grouped) {
      for (const [email, statuses] of periodMap) {
        const editor = editors.find(e => e.email.toLowerCase() === email);
        const total = Object.values(statuses).reduce((s, v) => s + v, 0);
        rows.push({ period, email, name: editor?.name || email.split('@')[0], statuses, total });
      }
    }

    // Sort by period (newest first for daily, otherwise chronological)
    return rows.sort((a, b) => {
      if (a.period !== b.period) {
        // For daily view with DD.MM format, reverse sort
        return a.period < b.period ? 1 : -1;
      }
      return b.total - a.total;
    });
  }, [statusUpdates, editors, timeRange, editorFilter]);

  // All statuses found in updates
  const allStatuses = useMemo(() => {
    if (!statusUpdates) return [];
    const set = new Set<string>();
    for (const u of statusUpdates) set.add(u.new_status);
    return Array.from(set).sort();
  }, [statusUpdates]);

  // Comparison data (WoW or MoM)
  const comparisonData = useMemo(() => {
    if (comparisonMode === 'none' || !statusUpdates || !editors) return null;

    let filteredUpdates = statusUpdates;
    if (editorFilter.startsWith('team:')) {
      const teamLeadEmail = editorFilter.replace('team:', '');
      const teamEmails = getTeamEmails(teamLeadEmail);
      filteredUpdates = statusUpdates.filter((u: any) => teamEmails.has(u.updated_by_email?.toLowerCase()));
    } else if (editorFilter !== 'all') {
      filteredUpdates = statusUpdates.filter((u: any) => u.updated_by_email?.toLowerCase() === editorFilter.toLowerCase());
    }

    const isWeekly = comparisonMode === 'wow';
    const getPeriod = (d: Date) => isWeekly ? getWeekLabel(d) : getMonthLabel(d);

    // Group by period
    const byPeriod = new Map<string, { total: number; byStatus: Record<string, number>; sortKey: number }>();
    for (const u of filteredUpdates) {
      const d = new Date(u.created_at);
      const period = getPeriod(d);
      if (!byPeriod.has(period)) byPeriod.set(period, { total: 0, byStatus: {}, sortKey: d.getTime() });
      const entry = byPeriod.get(period)!;
      entry.total++;
      entry.byStatus[u.new_status] = (entry.byStatus[u.new_status] || 0) + 1;
    }

    const periods = Array.from(byPeriod.entries())
      .sort(([, a], [, b]) => a.sortKey - b.sortKey)
      .map(([period, data]) => ({ period, ...data }));

    // Add change % vs previous period
    return periods.map((p, i) => {
      const prev = i > 0 ? periods[i - 1] : null;
      const change = prev && prev.total > 0 ? ((p.total - prev.total) / prev.total * 100) : null;
      return { ...p, change };
    });
  }, [comparisonMode, statusUpdates, editors, editorFilter]);

  // Editor performance chart data (bar chart of totals per editor for selected period)
  const editorChartData = useMemo(() => {
    if (!performanceData || !editors) return [];
    const byEditor = new Map<string, number>();
    for (const row of performanceData) {
      byEditor.set(row.name, (byEditor.get(row.name) || 0) + row.total);
    }
    return Array.from(byEditor.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [performanceData, editors]);

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
          <p className="text-sm text-muted-foreground">Issue resolution tracking & team performance</p>
        </div>
      </div>

      {/* Summary cards with full status breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Total
            </div>
            <p className="text-2xl font-bold">{stats?.total || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-destructive text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Open
            </div>
            <p className="text-2xl font-bold">{stats?.byStatus?.open || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-primary text-xs mb-1">
              <ClipboardCheck className="h-3.5 w-3.5" /> In Progress
            </div>
            <p className="text-2xl font-bold">{stats?.byStatus?.in_progress || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'hsl(142, 71%, 45%)' }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
            </div>
            <p className="text-2xl font-bold">{stats?.byStatus?.resolved || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'hsl(25, 95%, 53%)' }}>
              <Ban className="h-3.5 w-3.5" /> Won't Fix
            </div>
            <p className="text-2xl font-bold">{stats?.byStatus?.wont_fix || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'hsl(262, 83%, 58%)' }}>
              <EyeOff className="h-3.5 w-3.5" /> Hidden 3m
            </div>
            <p className="text-2xl font-bold">{stats?.byStatus?.hidden_3m || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      {hasHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Issue Trends Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                <Legend />
                <Line type="monotone" dataKey="total" name="Total Issues" stroke="hsl(221, 83%, 53%)" strokeWidth={2} />
                <Line type="monotone" dataKey="newIssues" name="New" stroke="hsl(339, 82%, 51%)" strokeWidth={2} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="hsl(142, 71%, 45%)" strokeWidth={2} />
                <Line type="monotone" dataKey="disappeared" name="Disappeared" stroke="hsl(262, 83%, 58%)" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Issue type distribution */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues & Warnings by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {typeDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={typeDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="name" type="category" width={140} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    formatter={(value: number, _name: string, props: any) => [value, props.payload.severity === 'issue' ? '🔴 Issue' : '⚠️ Warning']} />
                  <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                    {typeDistribution.map((entry, index) => (
                      <Cell key={index} fill={entry.severity === 'issue' ? 'hsl(339, 82%, 51%)' : 'hsl(45, 93%, 47%)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            )}
          </CardContent>
        </Card>

        {/* Editor performance chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editor Activity (Total Actions)</CardTitle>
          </CardHeader>
          <CardContent>
            {editorChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={editorChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="count" name="Actions" fill="hsl(221, 83%, 53%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team Performance Section */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Team Performance
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Time range selector */}
              <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
                <TabsList className="h-8">
                  <TabsTrigger value="daily" className="text-xs px-3 h-6">
                    <Calendar className="h-3 w-3 mr-1" /> Daily
                  </TabsTrigger>
                  <TabsTrigger value="weekly" className="text-xs px-3 h-6">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly" className="text-xs px-3 h-6">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Editor / Team filter */}
              <Select value={editorFilter} onValueChange={setEditorFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <Users className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="All editors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All editors</SelectItem>
                  {teamLeads.map(tl => (
                    <SelectItem key={`team:${tl.email}`} value={`team:${tl.email}`}>
                      🏷️ {tl.name || tl.email.split('@')[0]}'s Team
                    </SelectItem>
                  ))}
                  {editorOptions.map(e => (
                    <SelectItem key={e.email} value={e.email}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Comparison mode */}
              <Select value={comparisonMode} onValueChange={(v) => setComparisonMode(v as any)}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Compare" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No comparison</SelectItem>
                  <SelectItem value="wow">Week over Week</SelectItem>
                  <SelectItem value="mom">Month over Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Comparison chart */}
          {comparisonData && comparisonData.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                {comparisonMode === 'wow' ? 'Week over Week' : 'Month over Month'} — Total Actions
              </h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    formatter={(value: number, name: string, props: any) => {
                      const change = props.payload.change;
                      const changeStr = change !== null ? ` (${change > 0 ? '+' : ''}${change.toFixed(0)}%)` : '';
                      return [`${value}${changeStr}`, name];
                    }}
                  />
                  <Bar dataKey="total" name="Total Actions" radius={[4, 4, 0, 0]}>
                    {comparisonData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.change === null ? 'hsl(var(--muted-foreground))' : entry.change >= 0 ? 'hsl(142, 71%, 45%)' : 'hsl(339, 82%, 51%)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Performance table */}
          {performanceData.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Editor</TableHead>
                    {allStatuses.map(s => (
                      <TableHead key={s} className="text-center text-xs">{STATUS_LABELS[s] || s.replace(/_/g, ' ')}</TableHead>
                    ))}
                    <TableHead className="text-center text-xs font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceData.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{row.period}</TableCell>
                      <TableCell className="text-sm">{row.name}</TableCell>
                      {allStatuses.map(s => (
                        <TableCell key={s} className="text-center text-sm">
                          {row.statuses[s] ? (
                            <span className="font-medium" style={{ color: STATUS_COLORS[s] || 'inherit' }}>{row.statuses[s]}</span>
                          ) : '—'}
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-bold text-sm">{row.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No activity data for the selected filters</p>
          )}
        </CardContent>
      </Card>

      {/* Sync-by-Sync Breakdown */}
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
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
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
