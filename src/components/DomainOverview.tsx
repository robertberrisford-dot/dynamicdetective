import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock, Globe, Link2, FileWarning, Type, ChevronRight, Users, Hash } from 'lucide-react';
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
};

const ABC_TYPES = ['abc_missing_tnc', 'abc_repeated_tnc'];

const getIssueTypeConfig = (type: string) =>
  ISSUE_TYPE_CONFIG[type] || {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: AlertCircle,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
  };

const DomainOverview = ({ onBack, scope, teamEmails, title, subtitle }: DomainOverviewProps) => {
  const { data: issues, isLoading } = useQuery({
    queryKey: ['overview-issues', scope, teamEmails],
    queryFn: async () => {
      let query = supabase.from('issues').select('*')
        .or(`hidden_until.is.null,hidden_until.lt.${new Date().toISOString()}`);
      
      if (scope === 'team' && teamEmails && teamEmails.length > 0) {
        // Filter to team members' issues
        query = query.in('assigned_email', teamEmails);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Issue[];
    },
  });

  const issueTypes = useMemo(() => {
    if (!issues) return [];
    const types = new Set<string>();
    issues.forEach(i => { if (i.issue_type) types.add(i.issue_type); });
    return Array.from(types).sort();
  }, [issues]);

  const checkStats = useMemo(() => {
    if (!issues) return [];
    return issueTypes
      .filter(type => !ABC_TYPES.includes(type))
      .map(type => {
        const typeIssues = issues.filter(i => i.issue_type === type);
        // Count unique editors affected
        const editors = new Set(typeIssues.map(i => i.assigned_email?.toLowerCase()).filter(Boolean));
        return {
          type,
          total: typeIssues.length,
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
        return { type: t, total: sub.length };
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

  const renderCard = (check: { type: string; total: number; open: number; inProgress: number; resolved: number; editorsAffected?: number }) => {
    const cfg = getIssueTypeConfig(check.type);
    const Icon = cfg.icon;
    return (
      <Card key={check.type} className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cfg.bgColor}`}>
              <Icon className={`h-6 w-6 ${cfg.color}`} />
            </div>
          </div>
          <h4 className="font-semibold text-sm mb-1">{cfg.label}</h4>
          <p className="text-3xl font-bold mb-3">{check.total}</p>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
            {check.total > 0 && (
              <div className="flex h-full">
                {check.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(check.resolved / check.total) * 100}%` }} />}
                {check.inProgress > 0 && <div className="bg-primary" style={{ width: `${(check.inProgress / check.total) * 100}%` }} />}
                {check.open > 0 && <div className="bg-destructive" style={{ width: `${(check.open / check.total) * 100}%` }} />}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{check.open} open</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{check.inProgress} active</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{check.resolved} done</span>
          </div>
          {check.editorsAffected !== undefined && (
            <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> {check.editorsAffected} editor{check.editorsAffected !== 1 ? 's' : ''} affected
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

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

      {/* Summary stats */}
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
            {checkStats.map(check => renderCard(check))}
            {abcStats && (
              <Card className="border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/30">
                      <FileWarning className="h-6 w-6 text-rose-600" />
                    </div>
                  </div>
                  <h4 className="font-semibold text-sm mb-1">ABC Vouchers with Issues</h4>
                  <p className="text-3xl font-bold mb-3">{abcStats.total}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
                    {abcStats.total > 0 && (
                      <div className="flex h-full">
                        {abcStats.resolved > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(abcStats.resolved / abcStats.total) * 100}%` }} />}
                        {abcStats.inProgress > 0 && <div className="bg-primary" style={{ width: `${(abcStats.inProgress / abcStats.total) * 100}%` }} />}
                        {abcStats.open > 0 && <div className="bg-destructive" style={{ width: `${(abcStats.open / abcStats.total) * 100}%` }} />}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{abcStats.open} open</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />{abcStats.inProgress} active</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{abcStats.resolved} done</span>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> {abcStats.editorsAffected} editor{abcStats.editorsAffected !== 1 ? 's' : ''} affected
                  </p>
                  <p className="text-[10px] text-muted-foreground">{abcStats.subtypes.length} sub-checks</p>
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
