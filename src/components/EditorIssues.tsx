import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, Filter, AlertCircle, CheckCircle2, Clock, Globe, Copy, ChevronDown, Link2, FileWarning, Type, ChevronRight, ExternalLink, Lightbulb, Hash, AlertTriangle, ShieldAlert } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import IssueDetail from '@/components/IssueDetail';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

const formatCaption = (value: string | null | undefined): string => {
  if (!value && value !== '0') return '—';
  const s = String(value).trim();
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0 && num < 1) {
    return `${Math.round(num * 100)}%`;
  }
  // If it's a plain number (no existing unit), append €
  if (!isNaN(num) && /^\d+\.?\d*$/.test(s)) {
    return `${s}€`;
  }
  return s;
};

interface EditorIssuesProps {
  editor: { email: string; name: string | null; role: string };
  onBack: () => void;
}

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'wont_fix', 'hidden_3m'] as const;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof AlertCircle }> = {
  open: { label: 'Open', variant: 'destructive', icon: AlertCircle },
  in_progress: { label: 'In Progress', variant: 'default', icon: Clock },
  resolved: { label: 'Resolved', variant: 'secondary', icon: CheckCircle2 },
  wont_fix: { label: "Won't Fix", variant: 'outline', icon: CheckCircle2 },
  hidden_3m: { label: 'Hidden 3 months', variant: 'outline', icon: Clock },
};

type Severity = 'issue' | 'warning';

const ISSUE_TYPE_CONFIG: Record<string, { label: string; icon: typeof AlertCircle; color: string; bgColor: string; severity: Severity }> = {
  missing_caption_1: {
    label: 'Non-Numerical Caption 1',
    icon: Type,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    severity: 'warning',
  },
  metas_without_values: {
    label: 'Metas Without Values',
    icon: FileWarning,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    severity: 'issue',
  },
  broken_redirect_url: {
    label: 'Broken Redirect URLs',
    icon: Link2,
    color: 'text-red-600',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    severity: 'issue',
  },
  repeated_caption_1: {
    label: 'Repeated Caption 1',
    icon: Type,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    severity: 'warning',
  },
  repeated_caption_combo: {
    label: 'Repeated Caption 1+2',
    icon: Type,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
    severity: 'warning',
  },
  stale_evergreen: {
    label: 'Stale Evergreen Vouchers',
    icon: Clock,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50 dark:bg-teal-950/30',
    severity: 'warning',
  },
  abc_missing_tnc: {
    label: 'ABC Missing T&C',
    icon: FileWarning,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50 dark:bg-rose-950/30',
    severity: 'issue',
  },
  abc_repeated_tnc: {
    label: 'ABC Repeated T&C',
    icon: Type,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50 dark:bg-pink-950/30',
    severity: 'warning',
  },
  duplicate_code: {
    label: 'Duplicate Codes',
    icon: Hash,
    color: 'text-sky-600',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    severity: 'issue',
  },
  caption_title_mismatch: {
    label: 'Caption-Title Mismatch',
    icon: AlertCircle,
    color: 'text-fuchsia-600',
    bgColor: 'bg-fuchsia-50 dark:bg-fuchsia-950/30',
    severity: 'issue',
  },
  multiple_manual_picks: {
    label: 'Multiple Manual Picks',
    icon: AlertTriangle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
    severity: 'warning',
  },
  similar_titles: {
    label: 'Similar Titles',
    icon: AlertTriangle,
    color: 'text-lime-600',
    bgColor: 'bg-lime-50 dark:bg-lime-950/30',
    severity: 'warning',
  },
};

const getIssueTypeConfig = (type: string) =>
  ISSUE_TYPE_CONFIG[type] || {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: AlertCircle,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    severity: 'issue' as Severity,
  };

const getSeverity = (type: string): Severity => getIssueTypeConfig(type).severity;

const ABC_TYPES = ['abc_missing_tnc', 'abc_repeated_tnc'];

const EditorIssues = ({ editor, onBack }: EditorIssuesProps) => {
  const { user } = useAuth();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [activeCheckType, setActiveCheckType] = useState<string | null>(null);
  const [showAbcSubmenu, setShowAbcSubmenu] = useState(false);
  const [showQuickFixes, setShowQuickFixes] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ['editor-issues', editor.email],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('issues')
        .select('*')
        .ilike('assigned_email', editor.email)
        .not('status', 'in', '("resolved","wont_fix")')
        .or(`hidden_until.is.null,hidden_until.lt.${now}`)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Issue[];
    },
  });

  const handleStatusChange = useCallback(async (issue: Issue, newStatus: string) => {
    const oldStatus = issue.status;
    if (oldStatus === newStatus) return;
    try {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'hidden_3m') {
        const hideUntil = new Date();
        hideUntil.setMonth(hideUntil.getMonth() + 3);
        updateData.hidden_until = hideUntil.toISOString();
      } else {
        updateData.hidden_until = null;
      }
      const { error } = await supabase
        .from('issues')
        .update(updateData)
        .eq('id', issue.id);
      if (error) throw error;

      if (user) {
        await supabase.from('issue_status_updates').insert({
          issue_id: issue.id,
          old_status: oldStatus,
          new_status: newStatus,
          updated_by: user.id,
          updated_by_email: user.email || '',
        });
      }

      toast.success(`Status changed to ${statusConfig[newStatus]?.label || newStatus}`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  }, [user, refetch]);

  const issueTypes = useMemo(() => {
    if (!issues) return [];
    const types = new Set<string>();
    issues.forEach(i => { if (i.issue_type) types.add(i.issue_type); });
    return Array.from(types).sort();
  }, [issues]);

  const checkStats = useMemo(() => {
    if (!issues) return [];
    return issueTypes
      .filter(type => !ABC_TYPES.includes(type)) // exclude ABC from individual cards
      .map(type => {
        const typeIssues = issues.filter(i => i.issue_type === type);
        return {
          type,
          total: typeIssues.length,
          open: typeIssues.filter(i => i.status === 'open').length,
          inProgress: typeIssues.filter(i => i.status === 'in_progress').length,
          resolved: typeIssues.filter(i => i.status === 'resolved').length,
        };
      });
  }, [issues, issueTypes]);

  const abcStats = useMemo(() => {
    if (!issues) return null;
    const abcIssues = issues.filter(i => i.issue_type && ABC_TYPES.includes(i.issue_type));
    if (abcIssues.length === 0) return null;
    return {
      total: abcIssues.length,
      open: abcIssues.filter(i => i.status === 'open').length,
      inProgress: abcIssues.filter(i => i.status === 'in_progress').length,
      resolved: abcIssues.filter(i => i.status === 'resolved').length,
      subtypes: ABC_TYPES.filter(t => abcIssues.some(i => i.issue_type === t)).map(t => {
        const sub = abcIssues.filter(i => i.issue_type === t);
        return {
          type: t,
          total: sub.length,
          open: sub.filter(i => i.status === 'open').length,
          inProgress: sub.filter(i => i.status === 'in_progress').length,
          resolved: sub.filter(i => i.status === 'resolved').length,
        };
      }),
    };
  }, [issues]);

  const totalStats = useMemo(() => ({
    total: issues?.length || 0,
    open: issues?.filter(i => i.status === 'open').length || 0,
    inProgress: issues?.filter(i => i.status === 'in_progress').length || 0,
    resolved: issues?.filter(i => i.status === 'resolved').length || 0,
  }), [issues]);

  // Quick fixes: vouchers that appear in multiple open issue types
  const quickFixes = useMemo(() => {
    if (!issues) return [];
    const openIssues = issues.filter(i => i.status === 'open' && i.voucher_id_pool);
    const byVoucher: Record<string, Issue[]> = {};
    for (const issue of openIssues) {
      const key = issue.voucher_id_pool!;
      if (!byVoucher[key]) byVoucher[key] = [];
      byVoucher[key].push(issue);
    }
    return Object.entries(byVoucher)
      .filter(([, group]) => {
        const types = new Set(group.map(i => i.issue_type));
        return types.size > 1; // appears in multiple different check types
      })
      .map(([voucherId, group]) => ({
        voucherId,
        issues: group,
        types: Array.from(new Set(group.map(i => i.issue_type).filter(Boolean))),
        clientName: group[0].client_name,
        seoUrl: group[0].seo_url,
        voucherTitle: group[0].voucher_title,
      }))
      .sort((a, b) => b.issues.length - a.issues.length);
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues?.filter(issue => {
      const matchesSearch = !searchQuery ||
        issue.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.retailer_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.voucher_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.seo_url?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
      const matchesType = issue.issue_type === activeCheckType;
      return matchesSearch && matchesStatus && matchesType;
    }) || [];
  }, [issues, searchQuery, statusFilter, activeCheckType]);

  // Group similar_titles issues by retailer_pool_id for showing siblings
  const similarTitlesByRetailer = useMemo(() => {
    if (!issues) return {};
    const map: Record<string, { title: string; voucherId: string }[]> = {};
    issues
      .filter(i => i.issue_type === 'similar_titles' && i.retailer_pool_id)
      .forEach(i => {
        const key = i.retailer_pool_id!;
        if (!map[key]) map[key] = [];
        map[key].push({ title: i.voucher_title || '—', voucherId: i.voucher_id_pool || '—' });
      });
    return map;
  }, [issues]);

  // Issue detail view
  if (selectedIssue) {
    return (
      <IssueDetail
        issue={selectedIssue}
        onBack={() => { setSelectedIssue(null); refetch(); }}
      />
    );
  }

  // Quick Fixes detail view
  if (showQuickFixes && !activeCheckType) {
    const totalResolvable = quickFixes.reduce((s, q) => s + q.issues.length, 0);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setShowQuickFixes(false)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <Lightbulb className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Quick Fixes</h2>
            <p className="text-xs text-muted-foreground">
              {editor.name || editor.email.split('@')[0]} · {quickFixes.length} voucher{quickFixes.length !== 1 ? 's' : ''} → {totalResolvable} issues
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {quickFixes.map(qf => (
            <Card key={qf.voucherId} className="border-amber-200/50 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0 mt-0.5">
                    <Lightbulb className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{qf.clientName || 'Unknown'}</p>
                      <Badge variant="secondary" className="text-[10px]">{qf.issues.length} issues resolved</Badge>
                    </div>
                    {qf.voucherTitle && (
                      <p className="text-xs text-foreground/80 mt-0.5 line-clamp-1">{qf.voucherTitle}</p>
                    )}
                    <button
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground font-mono mt-0.5 hover:text-foreground transition-colors group/copy"
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(qf.voucherId); toast.success('Voucher ID copied'); }}
                    >
                      {qf.voucherId}
                      <Copy className="h-3 w-3 opacity-0 group-hover/copy:opacity-100 transition-opacity" />
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {qf.types.map(t => {
                        const cfg = getIssueTypeConfig(t!);
                        return (
                          <Badge key={t} variant="outline" className="text-[10px] gap-1">
                            <cfg.icon className={`h-3 w-3 ${cfg.color}`} />
                            {cfg.label}
                          </Badge>
                        );
                      })}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {qf.seoUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                          onClick={() => window.open(`https://www.mydealz.de/gutscheine/${qf.seoUrl}`, '_blank', 'noopener,noreferrer')}
                        >
                          <ExternalLink className="h-3 w-3" />
                          View Page
                        </Button>
                      )}
                      {qf.voucherId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                          onClick={() => {
                            const country = (qf.issues[0]?.country || 'de').toLowerCase();
                            window.open(`https://ap.cuponation.com/country/${country}/admin/clients/b375850ebe3345b1a43e6d730ca545b5/vouchers?origin=imt&voucher-manage=${qf.voucherId}`, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <ExternalLink className="h-3 w-3" /> Admin
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ABC submenu view
  if (showAbcSubmenu && !activeCheckType) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setShowAbcSubmenu(false)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/30">
            <FileWarning className="h-5 w-5 text-rose-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold">ABC Vouchers with Issues</h2>
            <p className="text-xs text-muted-foreground">
              {editor.name || editor.email.split('@')[0]} · {abcStats?.total || 0} total issues
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {abcStats?.subtypes.map(sub => {
            const cfg = getIssueTypeConfig(sub.type);
            const Icon = cfg.icon;
            return (
              <Card
                key={sub.type}
                className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => setActiveCheckType(sub.type)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor} transition-transform group-hover:scale-110`}>
                      <Icon className={`h-6 w-6 ${cfg.color}`} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
                  <p className="text-3xl font-bold mb-3">{sub.total}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                    {sub.total > 0 && (
                      <div className="flex h-full">
                        {sub.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(sub.resolved / sub.total) * 100}%` }} />}
                        {sub.inProgress > 0 && <div className="bg-primary" style={{ width: `${(sub.inProgress / sub.total) * 100}%` }} />}
                        {sub.open > 0 && <div className="bg-destructive" style={{ width: `${(sub.open / sub.total) * 100}%` }} />}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{sub.open} open</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{sub.inProgress} active</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{sub.resolved} done</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // Issue list for a specific check type
  if (activeCheckType) {
    const typeCfg = getIssueTypeConfig(activeCheckType);
    const TypeIcon = typeCfg.icon;
    const isAbcType = ABC_TYPES.includes(activeCheckType);

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setActiveCheckType(null); setSearchQuery(''); setStatusFilter('all'); if (!isAbcType) setShowAbcSubmenu(false); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${typeCfg.bgColor}`}>
            <TypeIcon className={`h-5 w-5 ${typeCfg.color}`} />
          </div>
          <div>
            <h2 className="text-lg font-bold">{typeCfg.label}</h2>
            <p className="text-xs text-muted-foreground">
              {editor.name || editor.email.split('@')[0]} · {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
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

        {filteredIssues.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Globe className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-lg font-medium text-muted-foreground">No issues found</p>
              <p className="text-sm text-muted-foreground/60">Try adjusting your filters</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredIssues.map(issue => {
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
                        {issue.voucher_description && activeCheckType === 'broken_redirect_url' && (
                          <span className="text-[10px] text-destructive font-medium">
                            {issue.voucher_description}
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 gap-1 px-1.5 text-[10px] text-primary hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              const country = (issue.country || 'de').toLowerCase();
                              window.open(`https://ap.cuponation.com/country/${country}/admin/clients/b375850ebe3345b1a43e6d730ca545b5/vouchers?origin=imt&voucher-manage=${issue.voucher_id_pool}`, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <ExternalLink className="h-3 w-3" /> Admin
                          </Button>
                        </div>
                      )}
                      {activeCheckType === 'similar_titles' && issue.retailer_pool_id && (() => {
                        const siblings = (similarTitlesByRetailer[issue.retailer_pool_id!] || [])
                          .filter(s => s.voucherId !== (issue.voucher_id_pool || '—'));
                        if (siblings.length === 0) return null;
                        return (
                          <div className="mt-1.5 rounded-md bg-muted/50 p-2 space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Similar titles on same retailer</p>
                            {siblings.map((s, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px]">
                                <span className="font-mono text-muted-foreground shrink-0">{s.voucherId}</span>
                                <span className="truncate text-foreground">{s.title}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {issue.retailer_url && activeCheckType === 'broken_redirect_url' && (
                        <div className="mt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(issue.retailer_url!, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open URL
                          </Button>
                        </div>
                      )}
                      {issue.seo_url && (activeCheckType === 'repeated_caption_1' || activeCheckType === 'repeated_caption_combo') && (
                        <div className="mt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`https://www.mydealz.de/gutscheine/${issue.seo_url}`, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
                            View Page
                          </Button>
                        </div>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                        <Button variant={cfg.variant} size="sm" className="shrink-0 gap-1">
                          {cfg.label}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                        {STATUS_OPTIONS.map(s => {
                          const sc = statusConfig[s];
                          return (
                            <DropdownMenuItem
                              key={s}
                              onClick={() => handleStatusChange(issue, s)}
                              className={issue.status === s ? 'font-bold' : ''}
                            >
                              {sc?.label || s}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Gallery view — check type cards
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

      {/* Overall summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Issues', value: totalStats.total, color: 'text-foreground' },
          { label: 'Open', value: totalStats.open, color: 'text-destructive' },
          { label: 'In Progress', value: totalStats.inProgress, color: 'text-primary' },
          { label: 'Resolved', value: totalStats.resolved, color: 'text-muted-foreground' },
        ].map(stat => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Fixes tile — shown first in the grid */}

      {/* Check type gallery */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : checkStats.length === 0 && !abcStats && quickFixes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle2 className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium text-muted-foreground">No issues assigned</p>
            <p className="text-sm text-muted-foreground/60">All checks are passing</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Quick Fixes tile */}
          {quickFixes.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quick Fixes</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card
                  className="group cursor-pointer border-amber-200/50 dark:border-amber-800/30 transition-all hover:border-amber-400/50 hover:shadow-lg hover:-translate-y-0.5"
                  onClick={() => setShowQuickFixes(true)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/30 transition-transform group-hover:scale-110">
                        <Lightbulb className="h-6 w-6 text-amber-500" />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-amber-500 transition-colors" />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">Quick Fixes</h4>
                    <p className="text-3xl font-bold mb-3">{quickFixes.length}</p>
                    <p className="text-xs text-muted-foreground">
                      Fix {quickFixes.length} voucher{quickFixes.length !== 1 ? 's' : ''} to resolve {quickFixes.reduce((s, q) => s + q.issues.length, 0)} issues
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* Issues section */}
          {(() => {
            const issueChecks = checkStats.filter(c => getSeverity(c.type) === 'issue');
            if (issueChecks.length === 0 && !(abcStats && ABC_TYPES.some(t => getSeverity(t) === 'issue'))) return null;
            return (
              <>
                <h3 className="text-sm font-semibold text-destructive/80 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4" /> Issues
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {issueChecks.map(check => {
                    const cfg = getIssueTypeConfig(check.type);
                    const Icon = cfg.icon;
                    return (
                      <Card key={check.type} className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setActiveCheckType(check.type)}>
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor} transition-transform group-hover:scale-110`}><Icon className={`h-6 w-6 ${cfg.color}`} /></div>
                            <div className="flex items-center gap-2">
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Issue</Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                          <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
                          <p className="text-3xl font-bold mb-3">{check.total}</p>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                            {check.total > 0 && (<div className="flex h-full">
                              {check.resolved > 0 && <div className="bg-muted-foreground/50 transition-all" style={{ width: `${(check.resolved / check.total) * 100}%` }} />}
                              {check.inProgress > 0 && <div className="bg-primary transition-all" style={{ width: `${(check.inProgress / check.total) * 100}%` }} />}
                              {check.open > 0 && <div className="bg-destructive transition-all" style={{ width: `${(check.open / check.total) * 100}%` }} />}
                            </div>)}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{check.open} open</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{check.inProgress} active</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{check.resolved} done</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  {/* ABC grouped card (contains both issue + warning subtypes) */}
                  {abcStats && (
                    <Card className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setShowAbcSubmenu(true)}>
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/30 transition-transform group-hover:scale-110">
                            <FileWarning className="h-6 w-6 text-rose-600" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Mixed</Badge>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                        <h4 className="font-semibold text-sm mb-1">ABC Vouchers with Issues</h4>
                        <p className="text-3xl font-bold mb-3">{abcStats.total}</p>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                          {abcStats.total > 0 && (<div className="flex h-full">
                            {abcStats.resolved > 0 && <div className="bg-muted-foreground/50 transition-all" style={{ width: `${(abcStats.resolved / abcStats.total) * 100}%` }} />}
                            {abcStats.inProgress > 0 && <div className="bg-primary transition-all" style={{ width: `${(abcStats.inProgress / abcStats.total) * 100}%` }} />}
                            {abcStats.open > 0 && <div className="bg-destructive transition-all" style={{ width: `${(abcStats.open / abcStats.total) * 100}%` }} />}
                          </div>)}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{abcStats.open} open</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{abcStats.inProgress} active</span>
                          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{abcStats.resolved} done</span>
                        </div>
                        <p className="mt-2 text-[10px] text-muted-foreground">{abcStats.subtypes.length} sub-check{abcStats.subtypes.length !== 1 ? 's' : ''}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </>
            );
          })()}

          {/* Warnings section */}
          {(() => {
            const warningChecks = checkStats.filter(c => getSeverity(c.type) === 'warning');
            if (warningChecks.length === 0) return null;
            return (
              <>
                <h3 className="text-sm font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Warnings
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {warningChecks.map(check => {
                    const cfg = getIssueTypeConfig(check.type);
                    const Icon = cfg.icon;
                    return (
                      <Card key={check.type} className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setActiveCheckType(check.type)}>
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor} transition-transform group-hover:scale-110`}><Icon className={`h-6 w-6 ${cfg.color}`} /></div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">Warning</Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                          <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
                          <p className="text-3xl font-bold mb-3">{check.total}</p>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                            {check.total > 0 && (<div className="flex h-full">
                              {check.resolved > 0 && <div className="bg-muted-foreground/50 transition-all" style={{ width: `${(check.resolved / check.total) * 100}%` }} />}
                              {check.inProgress > 0 && <div className="bg-primary transition-all" style={{ width: `${(check.inProgress / check.total) * 100}%` }} />}
                              {check.open > 0 && <div className="bg-destructive transition-all" style={{ width: `${(check.open / check.total) * 100}%` }} />}
                            </div>)}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{check.open} open</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{check.inProgress} active</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{check.resolved} done</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default EditorIssues;
