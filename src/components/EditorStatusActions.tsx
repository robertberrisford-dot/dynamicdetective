import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, EyeOff, Ban, Users } from 'lucide-react';

interface Props {
  onBack: () => void;
  country?: string;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_caption_1: 'Non-Num Caption 1',
  metas_without_values: 'Meta Issues',
  broken_redirect_url: 'Broken URL',
  repeated_caption_1: 'Repeated Caption',
  repeated_caption_combo: 'Repeated Caption Combo',
  stale_evergreen: 'Stale Evergreen',
  abc_missing_tnc: 'ABC Missing T&C',
  abc_repeated_tnc: 'ABC Repeated T&C',
  duplicate_code: 'Duplicate Code',
  caption_title_mismatch: 'Caption-Title Mismatch',
  multiple_manual_picks: 'Multiple Manual Picks',
  similar_titles: 'Similar Titles',
  code_missing_on_igraal: 'Code Missing iGraal',
  code_missing_on_main: 'Code Missing Main',
  html_in_tnc: 'HTML in T&C',
  zero_caption_top_position: 'Zero Caption Top',
  automatic_source_review: 'Automatic Source Review',
  action_code_blocking_real_code: 'Action Code Blocking',
  deal_blocking_real_code: 'Deal Blocking',
  past_month_in_title: 'Past Month in Title',
  wrong_country_redirect_url: 'Wrong Country Redirect',
};

const labelForType = (t: string) =>
  ISSUE_TYPE_LABELS[t] || t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

type StatusFilter = 'both' | 'wont_fix' | 'hidden_3m';

const EditorStatusActions = ({ onBack, country }: Props) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('both');

  const { data: editors } = useQuery({
    queryKey: ['esa-editors', country],
    queryFn: async () => {
      let q = supabase.from('editors').select('email, name, role, team_lead_email, country');
      if (country) q = q.eq('country', country);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: updates, isLoading } = useQuery({
    queryKey: ['esa-status-updates'],
    queryFn: async () => {
      const all: { updated_by_email: string; new_status: string; issue_type: string | null }[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('issue_status_updates')
          .select('updated_by_email, new_status, issue_type')
          .in('new_status', ['wont_fix', 'hidden_3m'])
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (data) all.push(...(data as any));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const teams = useMemo(() => {
    if (!editors) return [];
    // Group editors by team_lead_email (case insensitive). Resolve TL name from editors.
    const tlByEmail = new Map<string, { email: string; name: string }>();
    for (const e of editors) {
      if (e.role === 'team_lead' || e.role === 'ops_lead') {
        tlByEmail.set(e.email.toLowerCase(), { email: e.email, name: e.name || e.email.split('@')[0] });
      }
    }
    const groups = new Map<string, { leadEmail: string; leadName: string; members: typeof editors }>();
    for (const e of editors) {
      const tlKey = (e.team_lead_email || '').toLowerCase();
      if (!tlKey) continue;
      const tl = tlByEmail.get(tlKey) || { email: e.team_lead_email!, name: e.team_lead_email!.split('@')[0] };
      const g = groups.get(tlKey) || { leadEmail: tl.email, leadName: tl.name, members: [] as any };
      g.members.push(e);
      groups.set(tlKey, g);
    }
    return Array.from(groups.values()).sort((a, b) => a.leadName.localeCompare(b.leadName));
  }, [editors]);

  const unassigned = useMemo(() => {
    if (!editors) return [];
    return editors.filter(e => !e.team_lead_email && e.role !== 'team_lead' && e.role !== 'ops_lead');
  }, [editors]);

  // Per-editor counts: editorEmail -> { issueType -> count, total }
  const countsByEditor = useMemo(() => {
    const map = new Map<string, { perType: Map<string, number>; total: number }>();
    if (!updates) return map;
    for (const u of updates) {
      if (statusFilter !== 'both' && u.new_status !== statusFilter) continue;
      const email = (u.updated_by_email || '').toLowerCase();
      if (!email) continue;
      const type = u.issue_type || 'unknown';
      const e = map.get(email) || { perType: new Map<string, number>(), total: 0 };
      e.perType.set(type, (e.perType.get(type) || 0) + 1);
      e.total += 1;
      map.set(email, e);
    }
    return map;
  }, [updates, statusFilter]);

  const renderTeamTable = (
    members: { email: string; name: string | null }[],
    title: string,
    icon?: React.ReactNode,
  ) => {
    // Determine issue types present for this team (sorted by total desc)
    const typeTotals = new Map<string, number>();
    for (const m of members) {
      const c = countsByEditor.get(m.email.toLowerCase());
      if (!c) continue;
      for (const [t, n] of c.perType) typeTotals.set(t, (typeTotals.get(t) || 0) + n);
    }
    const types = Array.from(typeTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    const rows = members
      .map(m => {
        const c = countsByEditor.get(m.email.toLowerCase());
        return {
          email: m.email,
          name: m.name || m.email.split('@')[0],
          total: c?.total || 0,
          perType: c?.perType || new Map<string, number>(),
        };
      })
      .sort((a, b) => b.total - a.total);

    const teamTotal = rows.reduce((s, r) => s + r.total, 0);

    return (
      <Card key={title}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              {icon || <Users className="h-4 w-4 text-muted-foreground" />}
              {title}
              <Badge variant="secondary" className="ml-1">{members.length} editor{members.length === 1 ? '' : 's'}</Badge>
            </span>
            <Badge>{teamTotal} actions</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {types.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No status changes yet for this team.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10 min-w-[180px]">Editor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {types.map(t => (
                    <TableHead key={t} className="text-right whitespace-nowrap">{labelForType(t)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.email}>
                    <TableCell className="sticky left-0 bg-card font-medium">{r.name}</TableCell>
                    <TableCell className="text-right font-semibold">{r.total || '—'}</TableCell>
                    {types.map(t => {
                      const v = r.perType.get(t) || 0;
                      return (
                        <TableCell key={t} className="text-right tabular-nums">
                          {v ? v : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Tabs value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="both">All</TabsTrigger>
            <TabsTrigger value="wont_fix" className="gap-1.5"><Ban className="h-3.5 w-3.5" /> Won't Fix</TabsTrigger>
            <TabsTrigger value="hidden_3m" className="gap-1.5"><EyeOff className="h-3.5 w-3.5" /> Hidden 3m</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div>
        <h2 className="text-xl font-bold">Editor Status Actions</h2>
        <p className="text-sm text-muted-foreground">
          Count of issues each editor moved to {statusFilter === 'both' ? "Won't Fix or Hidden 3m" : statusFilter === 'wont_fix' ? "Won't Fix" : 'Hidden 3 months'}, split by issue type and grouped by team{country ? ` (${country.toUpperCase()})` : ''}.
        </p>
      </div>

      {isLoading || !editors ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map(t => renderTeamTable(t.members, `${t.leadName}'s Team`))}
          {unassigned.length > 0 && renderTeamTable(unassigned, 'Without Team')}
          {teams.length === 0 && unassigned.length === 0 && (
            <p className="text-sm text-muted-foreground">No editors found for this country.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default EditorStatusActions;
