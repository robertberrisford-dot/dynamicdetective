import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, Filter, AlertCircle, CheckCircle2, Clock, Globe } from 'lucide-react';
import IssueDetail from '@/components/IssueDetail';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

interface EditorIssuesProps {
  editor: { email: string; name: string | null; role: string };
  onBack: () => void;
}

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'wont_fix'] as const;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof AlertCircle }> = {
  open: { label: 'Open', variant: 'destructive', icon: AlertCircle },
  in_progress: { label: 'In Progress', variant: 'default', icon: Clock },
  resolved: { label: 'Resolved', variant: 'secondary', icon: CheckCircle2 },
  wont_fix: { label: "Won't Fix", variant: 'outline', icon: CheckCircle2 },
};

const EditorIssues = ({ editor, onBack }: EditorIssuesProps) => {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ['editor-issues', editor.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issues')
        .select('*')
        .ilike('assigned_email', editor.email)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Issue[];
    },
  });

  const filtered = issues?.filter(issue => {
    const matchesSearch = !searchQuery ||
      issue.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.retailer_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.seo_url?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  const stats = {
    total: issues?.length || 0,
    open: issues?.filter(i => i.status === 'open').length || 0,
    inProgress: issues?.filter(i => i.status === 'in_progress').length || 0,
    resolved: issues?.filter(i => i.status === 'resolved').length || 0,
  };

  if (selectedIssue) {
    return (
      <IssueDetail
        issue={selectedIssue}
        onBack={() => { setSelectedIssue(null); refetch(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-xl font-bold">{editor.name || editor.email.split('@')[0]}</h2>
          <p className="text-sm text-muted-foreground">{editor.email}</p>
        </div>
        <Badge variant="outline" className="ml-auto capitalize">
          {editor.role.replace('_', ' ')}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'Open', value: stats.open, color: 'text-destructive' },
          { label: 'In Progress', value: stats.inProgress, color: 'text-primary' },
          { label: 'Resolved', value: stats.resolved, color: 'text-muted-foreground' },
        ].map(stat => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by client, retailer, URL…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <Filter className="mr-1 h-3.5 w-3.5" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{statusConfig[s]?.label || s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Issues list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Globe className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium text-muted-foreground">No issues found</p>
            <p className="text-sm text-muted-foreground/60">
              {issues?.length ? 'Try adjusting your filters' : 'No issues assigned to this editor yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(issue => {
            const cfg = statusConfig[issue.status] || statusConfig.open;
            const StatusIcon = cfg.icon;
            return (
              <Card
                key={issue.id}
                className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md"
                onClick={() => setSelectedIssue(issue)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <StatusIcon className={`h-5 w-5 shrink-0 ${
                    issue.status === 'open' ? 'text-destructive' :
                    issue.status === 'in_progress' ? 'text-primary' :
                    'text-muted-foreground'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">
                        {issue.client_name || issue.retailer_id || 'Unnamed retailer'}
                      </p>
                      {issue.country && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {issue.country}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {(issue as any).voucher_title || issue.seo_url || issue.retailer_url || 'No URL'}
                    </p>
                    {(issue as any).issue_type && (
                      <Badge variant="outline" className="mt-1 text-[10px] text-amber-600 border-amber-300">
                        {(issue as any).issue_type === 'missing_caption_1' ? 'Missing Caption 1 Value' : (issue as any).issue_type}
                      </Badge>
                    )}
                  </div>
                  <Badge variant={cfg.variant} className="shrink-0">{cfg.label}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EditorIssues;
