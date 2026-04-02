import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock, Globe, Link2, FileWarning, Type, ChevronRight, Users, Hash, Search, Filter, ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import IssueDetail from '@/components/IssueDetail';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

interface DomainOverviewProps {
  onBack: () => void;
  scope: 'domain' | 'team';
  teamEmails?: string[];
  title: string;
  subtitle?: string;
}

const ISSUE_TYPE_CONFIG: Record<string, { label: string; icon: typeof AlertCircle; color: string; bgColor: string }> = {
  missing_caption_1: { label: 'Non-Numerical Caption 1', icon: Type, color: 'text-amber-600', bgColor: 'bg-amber-50 dark:bg-amber-950/30' },
  metas_without_values: { label: 'Metas Without Values', icon: FileWarning, color: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-950/30' },
  broken_redirect_url: { label: 'Broken Redirect URLs', icon: Link2, color: 'text-red-600', bgColor: 'bg-red-50 dark:bg-red-950/30' },
  repeated_caption_1: { label: 'Repeated Caption 1', icon: Type, color: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-950/30' },
  repeated_caption_combo: { label: 'Repeated Caption 1+2', icon: Type, color: 'text-indigo-600', bgColor: 'bg-indigo-50 dark:bg-indigo-950/30' },
  stale_evergreen: { label: 'Stale Evergreen Vouchers', icon: Clock, color: 'text-teal-600', bgColor: 'bg-teal-50 dark:bg-teal-950/30' },
  abc_missing_tnc: { label: 'ABC Missing T&C', icon: FileWarning, color: 'text-rose-600', bgColor: 'bg-rose-50 dark:bg-rose-950/30' },
  abc_repeated_tnc: { label: 'ABC Repeated T&C', icon: Type, color: 'text-pink-600', bgColor: 'bg-pink-50 dark:bg-pink-950/30' },
  duplicate_code: { label: 'Duplicate Codes', icon: Hash, color: 'text-sky-600', bgColor: 'bg-sky-50 dark:bg-sky-950/30' },
  caption_title_mismatch: { label: 'Caption-Title Mismatch', icon: AlertCircle, color: 'text-fuchsia-600', bgColor: 'bg-fuchsia-50 dark:bg-fuchsia-950/30' },
};

const ABC_TYPES = ['abc_missing_tnc', 'abc_repeated_tnc'];
const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'wont_fix', 'hidden_3m'] as const;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof AlertCircle }> = {
  open: { label: 'Open', variant: 'destructive', icon: AlertCircle },
  in_progress: { label: 'In Progress', variant: 'default', icon: Clock },
  resolved: { label: 'Resolved', variant: 'secondary', icon: CheckCircle2 },
  wont_fix: { label: "Won't Fix", variant: 'outline', icon: CheckCircle2 },
  hidden_3m: { label: 'Hidden 3 months', variant: 'outline', icon: Clock },
};

const formatCaption = (value: string | null | undefined): string => {
  if (!value && value !== '0') return '—';
  const s = String(value).trim();
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0 && num < 1) return `${Math.round(num * 100)}%`;
  if (!isNaN(num) && /^\d+\.?\d*$/.test(s)) return `${s}€`;
  return s;
};

const getIssueTypeConfig = (type: string) =>
  ISSUE_TYPE_CONFIG[type] || {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: AlertCircle,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
  };

const DomainOverview = ({ onBack, scope, teamEmails, title, subtitle }: DomainOverviewProps) => {
  const { user } = useAuth();
  const [activeCheckType, setActiveCheckType] = useState<string | null>(null);
  const [showAbcSubmenu, setShowAbcSubmenu] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ['overview-issues', scope, teamEmails],
    queryFn: async () => {
      let query = supabase.from('issues').select('*')
        .or(`hidden_until.is.null,hidden_until.lt.${new Date().toISOString()}`);
      if (scope === 'team' && teamEmails && teamEmails.length > 0) {
        query = query.in('assigned_email', teamEmails);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Issue[];
    },
  });

  const handleStatusChange = useCallback(async (issue: Issue, newStatus: string) => {
    if (issue.status === newStatus) return;
    try {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'hidden_3m') {
        const hideUntil = new Date();
        hideUntil.setMonth(hideUntil.getMonth() + 3);
        updateData.hidden_until = hideUntil.toISOString();
      } else {
        updateData.hidden_until = null;
      }
      const { error } = await supabase.from('issues').update(updateData).eq('id', issue.id);
      if (error) throw error;
      if (user) {
        await supabase.from('issue_status_updates').insert({
          issue_id: issue.id, old_status: issue.status, new_status: newStatus,
          updated_by: user.id, updated_by_email: user.email || '',
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
    return issueTypes.filter(type => !ABC_TYPES.includes(type)).map(type => {
      const typeIssues = issues.filter(i => i.issue_type === type);
      const editors = new Set(typeIssues.map(i => i.assigned_email?.toLowerCase()).filter(Boolean));
      return {
        type, total: typeIssues.length,
        open: typeIssues.filter(i => i.status === 'open').length,
        inProgress: typeIssues.filter(i => i.status === 'in_progress').length,
        resolved: typeIssues.filter(i => i.status === 'resolved').length,
        editorsAffected: editors.size,
      };
    });
  }, [issues, issueTypes]);

  const abcStats = useMemo(() => {
    if (!issues) return null;
    const abcIssues = issues.filter(i => i.issue_type && ABC_TYPES.includes(i.issue_type));
    if (abcIssues.length === 0) return null;
    const editors = new Set(abcIssues.map(i => i.assigned_email?.toLowerCase()).filter(Boolean));
    return {
      total: abcIssues.length,
      open: abcIssues.filter(i => i.status === 'open').length,
      inProgress: abcIssues.filter(i => i.status === 'in_progress').length,
      resolved: abcIssues.filter(i => i.status === 'resolved').length,
      editorsAffected: editors.size,
      subtypes: ABC_TYPES.filter(t => abcIssues.some(i => i.issue_type === t)).map(t => {
        const sub = abcIssues.filter(i => i.issue_type === t);
        return { type: t, total: sub.length, open: sub.filter(i => i.status === 'open').length, inProgress: sub.filter(i => i.status === 'in_progress').length, resolved: sub.filter(i => i.status === 'resolved').length };
      }),
    };
  }, [issues]);

  const totalStats = useMemo(() => ({
    total: issues?.length || 0,
    open: issues?.filter(i => i.status === 'open').length || 0,
    inProgress: issues?.filter(i => i.status === 'in_progress').length || 0,
    resolved: issues?.filter(i => i.status === 'resolved').length || 0,
    editorsAffected: new Set(issues?.map(i => i.assigned_email?.toLowerCase()).filter(Boolean)).size,
  }), [issues]);

  const filteredIssues = useMemo(() => {
    return issues?.filter(issue => {
      const matchesSearch = !searchQuery ||
        issue.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.voucher_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.assigned_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.seo_url?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
      const matchesType = issue.issue_type === activeCheckType;
      return matchesSearch && matchesStatus && matchesType;
    }) || [];
  }, [issues, searchQuery, statusFilter, activeCheckType]);

  // Issue detail view
  if (selectedIssue) {
    return <IssueDetail issue={selectedIssue} onBack={() => { setSelectedIssue(null); refetch(); }} />;
  }

  // ABC submenu
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
            <p className="text-xs text-muted-foreground">{title} · {abcStats?.total || 0} total</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {abcStats?.subtypes.map(sub => {
            const cfg = getIssueTypeConfig(sub.type);
            const Icon = cfg.icon;
            return (
              <Card key={sub.type} className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setActiveCheckType(sub.type)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor} transition-transform group-hover:scale-110`}><Icon className={`h-6 w-6 ${cfg.color}`} /></div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
                  <p className="text-3xl font-bold mb-3">{sub.total}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                    {sub.total > 0 && (<div className="flex h-full">
                      {sub.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(sub.resolved / sub.total) * 100}%` }} />}
                      {sub.inProgress > 0 && <div className="bg-primary" style={{ width: `${(sub.inProgress / sub.total) * 100}%` }} />}
                      {sub.open > 0 && <div className="bg-destructive" style={{ width: `${(sub.open / sub.total) * 100}%` }} />}
                    </div>)}
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
            <p className="text-xs text-muted-foreground">{title} · {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by client, editor, URL…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <Filter className="mr-1 h-3.5 w-3.5" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map(s => (<SelectItem key={s} value={s}>{statusConfig[s]?.label || s}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        {filteredIssues.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Globe className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-lg font-medium text-muted-foreground">No issues found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredIssues.map(issue => {
              const cfg = statusConfig[issue.status] || statusConfig.open;
              const StatusIcon = cfg.icon;
              return (
                <Card key={issue.id} className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md" onClick={() => setSelectedIssue(issue)}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <StatusIcon className={`h-5 w-5 shrink-0 ${issue.status === 'open' ? 'text-destructive' : issue.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{issue.client_name || issue.retailer_id || 'Unnamed'}</p>
                        {issue.assigned_email && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">{issue.assigned_email.split('@')[0]}</Badge>
                        )}
                        {issue.country && <Badge variant="outline" className="shrink-0 text-[10px]">{issue.country}</Badge>}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{issue.voucher_title || issue.seo_url || 'No details'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {issue.voucher_caption_1 != null && (
                          <span className="text-[10px] text-muted-foreground">Caption 1: <span className="font-medium text-foreground">{formatCaption(issue.voucher_caption_1)}</span></span>
                        )}
                        {issue.voucher_caption_2 != null && (
                          <span className="text-[10px] text-muted-foreground">Caption 2: <span className="font-medium text-foreground">{formatCaption(issue.voucher_caption_2)}</span></span>
                        )}
                      </div>
                      {issue.voucher_id_pool && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground font-mono">{issue.voucher_id_pool}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(issue.voucher_id_pool!); toast.success('Copied'); }}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {issue.seo_url && (
                        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary mt-1" onClick={(e) => { e.stopPropagation(); window.open(`https://www.mydealz.de/gutscheine/${issue.seo_url}`, '_blank', 'noopener,noreferrer'); }}>
                          <ExternalLink className="h-3 w-3" /> View Page
                        </Button>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                        <Button variant={cfg.variant} size="sm" className="shrink-0 gap-1">{cfg.label}<ChevronDown className="h-3 w-3" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                        {STATUS_OPTIONS.map(s => (
                          <DropdownMenuItem key={s} onClick={() => handleStatusChange(issue, s)} className={issue.status === s ? 'font-bold' : ''}>{statusConfig[s]?.label || s}</DropdownMenuItem>
                        ))}
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

  // Gallery view
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <Globe className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total Issues', value: totalStats.total, color: 'text-foreground' },
          { label: 'Open', value: totalStats.open, color: 'text-destructive' },
          { label: 'In Progress', value: totalStats.inProgress, color: 'text-primary' },
          { label: 'Resolved', value: totalStats.resolved, color: 'text-muted-foreground' },
          { label: 'Editors', value: totalStats.editorsAffected, color: 'text-foreground' },
        ].map(stat => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : checkStats.length === 0 && !abcStats ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle2 className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium text-muted-foreground">No issues found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Audit Checks Overview</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {checkStats.map(check => {
              const cfg = getIssueTypeConfig(check.type);
              const Icon = cfg.icon;
              return (
                <Card key={check.type} className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setActiveCheckType(check.type)}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor} transition-transform group-hover:scale-110`}><Icon className={`h-6 w-6 ${cfg.color}`} /></div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
                    <p className="text-3xl font-bold mb-3">{check.total}</p>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                      {check.total > 0 && (<div className="flex h-full">
                        {check.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(check.resolved / check.total) * 100}%` }} />}
                        {check.inProgress > 0 && <div className="bg-primary" style={{ width: `${(check.inProgress / check.total) * 100}%` }} />}
                        {check.open > 0 && <div className="bg-destructive" style={{ width: `${(check.open / check.total) * 100}%` }} />}
                      </div>)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{check.open} open</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{check.inProgress} active</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{check.resolved} done</span>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> {check.editorsAffected} editor{check.editorsAffected !== 1 ? 's' : ''} affected
                    </p>
                  </CardContent>
                </Card>
              );
            })}

            {abcStats && (
              <Card className="group cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5" onClick={() => setShowAbcSubmenu(true)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/30 transition-transform group-hover:scale-110"><FileWarning className="h-6 w-6 text-rose-600" /></div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">ABC Vouchers with Issues</h4>
                  <p className="text-3xl font-bold mb-3">{abcStats.total}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                    {abcStats.total > 0 && (<div className="flex h-full">
                      {abcStats.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(abcStats.resolved / abcStats.total) * 100}%` }} />}
                      {abcStats.inProgress > 0 && <div className="bg-primary" style={{ width: `${(abcStats.inProgress / abcStats.total) * 100}%` }} />}
                      {abcStats.open > 0 && <div className="bg-destructive" style={{ width: `${(abcStats.open / abcStats.total) * 100}%` }} />}
                    </div>)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{abcStats.open} open</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{abcStats.inProgress} active</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{abcStats.resolved} done</span>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> {abcStats.editorsAffected} editor{abcStats.editorsAffected !== 1 ? 's' : ''} affected
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default DomainOverview;
