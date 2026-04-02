import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, Filter, AlertCircle, CheckCircle2, Clock, Globe, Copy } from 'lucide-react';
import IssueDetail from '@/components/IssueDetail';
import { toast } from 'sonner';
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

const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_caption_1: 'Non-Numerical Caption 1',
  metas_without_values: 'Metas Without Values',
};

const getIssueTypeLabel = (type: string) => ISSUE_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const EditorIssues = ({ editor, onBack }: EditorIssuesProps) => {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<string>('all');

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

  // Derive unique issue types for tabs
  const issueTypes = useMemo(() => {
    if (!issues) return [];
    const types = new Set<string>();
    issues.forEach(i => { if (i.issue_type) types.add(i.issue_type); });
    return Array.from(types).sort();
  }, [issues]);

  const filtered = useMemo(() => {
    return issues?.filter(issue => {
      const matchesSearch = !searchQuery ||
        issue.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.retailer_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.voucher_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.seo_url?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
      const matchesTab = activeTab === 'all' || issue.issue_type === activeTab;
      return matchesSearch && matchesStatus && matchesTab;
    }) || [];
  }, [issues, searchQuery, statusFilter, activeTab]);

  const stats = useMemo(() => ({
    total: issues?.length || 0,
    open: issues?.filter(i => i.status === 'open').length || 0,
    inProgress: issues?.filter(i => i.status === 'in_progress').length || 0,
    resolved: issues?.filter(i => i.status === 'resolved').length || 0,
  }), [issues]);

  const getTabCount = (type: string) => {
    if (type === 'all') return issues?.length || 0;
    return issues?.filter(i => i.issue_type === type).length || 0;
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

      {/* Issue Type Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger value="all" className="text-xs">
            All <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{getTabCount('all')}</Badge>
          </TabsTrigger>
          {issueTypes.map(type => (
            <TabsTrigger key={type} value={type} className="text-xs">
              {getIssueTypeLabel(type)}
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{getTabCount(type)}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Filters — shared across all tabs */}
        <div className="flex flex-col gap-3 sm:flex-row mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by client, voucher, URL…"
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

        {/* Issue list — rendered once, filtered by active tab */}
        <TabsContent value={activeTab} className="mt-4" forceMount>
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
                  {issues?.length ? 'Try adjusting your filters' : 'No issues assigned yet'}
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
                          {issue.voucher_title || issue.seo_url || issue.retailer_url || 'No URL'}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {issue.issue_type && (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                              {getIssueTypeLabel(issue.issue_type)}
                            </Badge>
                          )}
                          {issue.voucher_caption_1 !== null && issue.voucher_caption_1 !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              Caption 1: <span className="font-medium text-foreground">{formatCaption(issue.voucher_caption_1)}</span>
                            </span>
                          )}
                          {issue.voucher_caption_2 !== null && issue.voucher_caption_2 !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              Caption 2: <span className="font-medium text-foreground">{formatCaption(issue.voucher_caption_2)}</span>
                            </span>
                          )}
                        </div>
                        {issue.voucher_id_pool && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground font-mono">{issue.voucher_id_pool}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(issue.voucher_id_pool!);
                                toast.success('Voucher Pool ID copied');
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <Badge variant={cfg.variant} className="shrink-0">{cfg.label}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EditorIssues;
