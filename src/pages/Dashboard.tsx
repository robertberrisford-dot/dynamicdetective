import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Search, Globe, AlertCircle, CheckCircle2, Clock, Filter, RefreshCw } from 'lucide-react';
import IssueDetail from '@/components/IssueDetail';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'wont_fix'] as const;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof AlertCircle }> = {
  open: { label: 'Open', variant: 'destructive', icon: AlertCircle },
  in_progress: { label: 'In Progress', variant: 'default', icon: Clock },
  resolved: { label: 'Resolved', variant: 'secondary', icon: CheckCircle2 },
  wont_fix: { label: "Won't Fix", variant: 'outline', icon: CheckCircle2 },
};

const Dashboard = () => {
  const { user, signOut, isAdmin } = useAuth();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-sheet', {
        body: {
          spreadsheet_id: '1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4',
          sheet_name: 'MYDEAL_DE_API_Vouchers (Preset)',
        },
      });
      if (error) throw error;
      toast.success(`Synced ${data?.synced || 0} rows from Google Sheet`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ['issues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issues')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Issue[];
    },
  });

  const countries = [...new Set(issues?.map(i => i.country).filter(Boolean) || [])].sort();

  const filtered = issues?.filter(issue => {
    const matchesSearch = !searchQuery ||
      issue.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.retailer_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.seo_url?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.retailer_url?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
    const matchesCountry = countryFilter === 'all' || issue.country === countryFilter;
    return matchesSearch && matchesStatus && matchesCountry;
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
        onBack={() => {
          setSelectedIssue(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Audit Tracker</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync Sheet'}
                </Button>
                <Badge variant="outline" className="text-xs">Admin</Badge>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by client, retailer, URL…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
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
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="w-[140px]">
                <Globe className="mr-1 h-3.5 w-3.5" />
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All countries</SelectItem>
                {countries.map(c => (
                  <SelectItem key={c} value={c!}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                {issues?.length ? 'Try adjusting your filters' : 'Issues will appear here once synced from your sheets'}
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
                        {issue.seo_url || issue.retailer_url || 'No URL'}
                      </p>
                    </div>
                    <Badge variant={cfg.variant} className="shrink-0">
                      {cfg.label}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
