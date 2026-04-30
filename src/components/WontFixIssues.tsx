import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, Filter, RotateCcw, ClipboardCheck, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import IssueDetail from '@/components/IssueDetail';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

interface WontFixIssuesProps {
  onBack: () => void;
  country?: string;
  teamEmails?: string[];
  teamLabel?: string;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_caption_1: 'Non-Numerical Caption 1',
  metas_without_values: 'Metas Without Values',
  broken_redirect_url: 'Broken Redirect URL',
  repeated_caption_1: 'Repeated Caption 1',
  repeated_caption_combo: 'Repeated Caption 1+2',
  stale_evergreen: 'Stale Evergreen',
  abc_missing_tnc: 'ABC Missing T&C',
  abc_repeated_tnc: 'ABC Repeated T&C',
  duplicate_code: 'Duplicate Code',
  caption_title_mismatch: 'Caption-Title Mismatch',
  multiple_manual_picks: 'Multiple Manual Picks',
  similar_titles: 'Similar Titles',
};

const STATUS_LABELS: Record<string, string> = {
  wont_fix: "Won't Fix",
  resolved: 'Resolved',
  hidden_3m: 'Hidden 3 months',
};

const REVIEWABLE_STATUSES = ['wont_fix', 'resolved', 'hidden_3m'] as const;

const labelForType = (t: string | null) =>
  (t && ISSUE_TYPE_LABELS[t]) ||
  (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ||
  'Unknown';

const WontFixIssues = ({ onBack, country, teamEmails, teamLabel }: WontFixIssuesProps) => {
  const { user } = useAuth();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('wont_fix');
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ['status-check-issues', country, teamEmails],
    queryFn: async () => {
      if (teamEmails && teamEmails.length === 0) return [];
      const all: Issue[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        let query = supabase
          .from('issues')
          .select('*')
          .in('status', REVIEWABLE_STATUSES as unknown as string[])
          .order('updated_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (country) query = query.eq('country', country);
        if (teamEmails && teamEmails.length > 0) query = query.in('assigned_email', teamEmails);
        const { data, error } = await query;
        if (error) throw error;
        if (data) all.push(...(data as Issue[]));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const handleReopen = useCallback(async (issue: Issue, e: React.MouseEvent) => {
    e.stopPropagation();
    setReopeningId(issue.id);
    try {
      const { error } = await supabase
        .from('issues')
        .update({ status: 'open', hidden_until: null })
        .eq('id', issue.id);
      if (error) throw error;
      if (user) {
        await supabase.from('issue_status_updates').insert({
          issue_id: issue.id,
          old_status: issue.status,
          new_status: 'open',
          updated_by: user.id,
          updated_by_email: user.email || '',
          issue_type: issue.issue_type || null,
          retailer_pool_id: issue.retailer_pool_id || null,
          voucher_id_pool: issue.voucher_id_pool || null,
          client_name: issue.client_name || null,
          assigned_email_snapshot: issue.assigned_email || null,
        });
      }
      toast.success('Issue reopened');
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reopen issue');
    } finally {
      setReopeningId(null);
    }
  }, [user, refetch]);

  const issueTypes = useMemo(() => {
    const types = new Set<string>();
    (issues || []).forEach(i => { if (i.issue_type) types.add(i.issue_type); });
    return Array.from(types).sort();
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return (issues || []).filter(issue => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q ||
        issue.client_name?.toLowerCase().includes(q) ||
        issue.voucher_title?.toLowerCase().includes(q) ||
        issue.assigned_email?.toLowerCase().includes(q) ||
        issue.seo_url?.toLowerCase().includes(q) ||
        issue.retailer_pool_id?.toLowerCase().includes(q);
      const matchesType = typeFilter === 'all' || issue.issue_type === typeFilter;
      const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [issues, searchQuery, typeFilter, statusFilter]);

  if (selectedIssue) {
    return <IssueDetail issue={selectedIssue} onBack={() => { setSelectedIssue(null); refetch(); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Status Check</h2>
          <p className="text-xs text-muted-foreground">
            Review issues marked as won't fix, resolved, or hidden — and reopen them if needed · {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by client, editor, URL…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-1 h-3.5 w-3.5" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {REVIEWABLE_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[220px]">
            <Filter className="mr-1 h-3.5 w-3.5" />
            <SelectValue placeholder="Issue type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All issue types</SelectItem>
            {issueTypes.map(t => (
              <SelectItem key={t} value={t}>{labelForType(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filteredIssues.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ClipboardCheck className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium text-muted-foreground">No issues found</p>
            <p className="text-sm text-muted-foreground/70">No issues match the selected status and filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredIssues.map(issue => (
            <Card
              key={issue.id}
              className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md"
              onClick={() => setSelectedIssue(issue)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <ClipboardCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{issue.client_name || issue.retailer_id || 'Unnamed'}</p>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">{labelForType(issue.issue_type)}</Badge>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{STATUS_LABELS[issue.status] || issue.status}</Badge>
                    {issue.assigned_email && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">{issue.assigned_email.split('@')[0]}</Badge>
                    )}
                    {issue.country && <Badge variant="outline" className="shrink-0 text-[10px]">{issue.country}</Badge>}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{issue.voucher_title || issue.seo_url || 'No details'}</p>
                  {issue.updated_at && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      Updated · {new Date(issue.updated_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {issue.seo_url && (
                  <a
                    href={issue.seo_url.startsWith('http') ? issue.seo_url : `https://${issue.seo_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={reopeningId === issue.id}
                  onClick={(e) => handleReopen(issue, e)}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${reopeningId === issue.id ? 'animate-spin' : ''}`} />
                  Reopen
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default WontFixIssues;
