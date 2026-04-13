import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, Globe, RefreshCw, Link2, BarChart3, Users, Sparkles, ScrollText, ShieldCheck, Palmtree, ArrowLeftRight } from 'lucide-react';
import CountrySelector from '@/components/CountrySelector';
import EditorsList from '@/components/EditorsList';
import EditorIssues from '@/components/EditorIssues';
import DomainOverview from '@/components/DomainOverview';
import Analytics from '@/components/Analytics';
import SyncLogs from '@/components/SyncLogs';
import UserManagement from '@/components/UserManagement';
import { toast } from 'sonner';

interface Editor {
  id?: string;
  email: string;
  name: string | null;
  role: string;
  team_lead_email?: string | null;
}

type ViewMode = 
  | { type: 'editors' }
  | { type: 'editor'; editor: Editor }
  | { type: 'domain' }
  | { type: 'team'; teamLeadEmail: string; teamLeadName: string }
  | { type: 'analytics' }
  | { type: 'sync-logs' }
  | { type: 'user-management' };

const Dashboard = () => {
  const { user, signOut, isAdmin, isOpsLead, isTeamLead, userRole } = useAuth();
  const [view, setView] = useState<ViewMode>({ type: 'editors' });
  const [autoRedirected, setAutoRedirected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingUrls, setCheckingUrls] = useState(false);
  const [urlProgress, setUrlProgress] = useState<{ checked: number; total: number } | null>(null);
  const [viewingAsEmail, setViewingAsEmail] = useState<string | null>(null);

  // Fetch editors the current user is substituting for
  const { data: substitutingFor } = useQuery({
    queryKey: ['vacation-substitutions', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data, error } = await supabase
        .from('editors')
        .select('email, name')
        .ilike('vacation_substitute_email', user.email);
      if (error) throw error;
      // Deduplicate by name
      const seen = new Set<string>();
      return (data || []).filter(e => {
        const key = (e.name || e.email).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    enabled: !!user?.email,
  });

  // Fetch editors for team lead view
  const { data: allEditors } = useQuery({
    queryKey: ['all-editors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('editors').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  // Auto-redirect non-admin editors directly to their issues view
  useEffect(() => {
    if (autoRedirected || isAdmin || !user?.email || !allEditors) return;
    const activeEmail = viewingAsEmail || user.email;
    const editor = allEditors.find(e => e.email.toLowerCase() === activeEmail.toLowerCase());
    if (editor) {
      setView({ type: 'editor', editor: { email: editor.email, name: editor.name, role: editor.role } });
      setAutoRedirected(true);
    }
  }, [autoRedirected, isAdmin, user, allEditors, viewingAsEmail]);

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
      toast.success(`Synced ${data?.synced || 0} rows, ${data?.editors_synced || 0} editors`);
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleCheckUrls = async (limit?: number) => {
    setCheckingUrls(true);
    setUrlProgress(null);
    const batchId = new Date().toISOString().replace(/[:.]/g, '-') + (limit ? `-test-${limit}` : '');
    try {
      let done = false;
      while (!done) {
        const { data, error } = await supabase.functions.invoke('check-urls', {
          body: {
            spreadsheet_id: '1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4',
            sheet_name: 'MYDEAL_DE_API_Vouchers (Preset)',
            batch_id: batchId,
            ...(limit ? { limit } : {}),
          },
        });
        if (error) throw error;
        setUrlProgress({ checked: data.total_checked, total: data.total_to_check });
        done = data.done;
        if (!done) {
          toast.info(`Checked ${data.total_checked}/${data.total_to_check} URLs...`);
        }
      }
      toast.success('URL check complete!');
    } catch (err: any) {
      toast.error(err.message || 'URL check failed');
    } finally {
      setCheckingUrls(false);
      setUrlProgress(null);
    }
  };

  const getTeamEmails = (teamLeadEmail: string): string[] => {
    if (!allEditors) return [];
    // Find the team lead's name, then collect ALL email variants for that name
    const tl = allEditors.find(e => e.email.toLowerCase() === teamLeadEmail.toLowerCase());
    const tlName = (tl?.name || teamLeadEmail.split('@')[0]).toLowerCase();
    const allTlEmails = allEditors
      .filter(e => e.role === 'team_lead' && (e.name || e.email.split('@')[0]).toLowerCase() === tlName)
      .map(e => e.email.toLowerCase());
    return allEditors
      .filter(e => e.team_lead_email && allTlEmails.includes(e.team_lead_email.toLowerCase()))
      .map(e => e.email);
  };

  const canAccessAnalytics = isTeamLead;

  // Get team leads for the team overview buttons, deduplicated by name, excluding thomas.punzel
  const teamLeads = (() => {
    const tls = allEditors?.filter(e => e.role === 'team_lead' && e.email !== 'thomas.punzel@atolls.com') || [];
    const seen = new Set<string>();
    return tls.filter(tl => {
      const key = (tl.name || tl.email.split('@')[0]).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Atollian Dynamic Detective</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || checkingUrls}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync Sheet'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleCheckUrls()} disabled={checkingUrls || syncing}>
                  <Link2 className={`h-4 w-4 mr-1 ${checkingUrls ? 'animate-pulse' : ''}`} />
                  {checkingUrls && urlProgress
                    ? `${urlProgress.checked}/${urlProgress.total}`
                    : checkingUrls ? 'Starting...' : 'Check URLs'}
                </Button>
                <Badge variant="outline" className="text-xs">
                  {userRole === 'ops_lead' ? 'Ops Lead' : 'Admin'}
                </Badge>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Vacation substitute profile switcher */}
        {substitutingFor && substitutingFor.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950">
            <Palmtree className="h-5 w-5 text-green-600 shrink-0" />
            <span className="text-sm font-medium text-green-800 dark:text-green-200">
              {viewingAsEmail ? `Viewing ${substitutingFor.find(s => s.email.toLowerCase() === viewingAsEmail.toLowerCase())?.name || viewingAsEmail}'s portfolio` : 'You are covering for:'}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {!viewingAsEmail && substitutingFor.map(sub => (
                <Button
                  key={sub.email}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-green-300 text-green-800 hover:bg-green-100 dark:border-green-700 dark:text-green-200"
                  onClick={() => {
                    setViewingAsEmail(sub.email);
                    setAutoRedirected(false);
                    const editor = allEditors?.find(e => e.email.toLowerCase() === sub.email.toLowerCase());
                    if (editor) {
                      setView({ type: 'editor', editor: { email: editor.email, name: editor.name, role: editor.role } });
                    }
                  }}
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {sub.name || sub.email.split('@')[0]}
                </Button>
              ))}
              {viewingAsEmail && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-green-300 text-green-800 hover:bg-green-100 dark:border-green-700 dark:text-green-200"
                  onClick={() => {
                    setViewingAsEmail(null);
                    setAutoRedirected(false);
                    const editor = allEditors?.find(e => e.email.toLowerCase() === user!.email!.toLowerCase());
                    if (editor) {
                      setView({ type: 'editor', editor: { email: editor.email, name: editor.name, role: editor.role } });
                    } else {
                      setView({ type: 'editors' });
                    }
                  }}
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  Back to my portfolio
                </Button>
              )}
            </div>
          </div>
        )}
        {view.type === 'editor' ? (
          <EditorIssues
            editor={view.editor}
            onBack={() => setView({ type: 'editors' })}
          />
        ) : view.type === 'domain' ? (
          <DomainOverview
            onBack={() => setView({ type: 'editors' })}
            scope="domain"
            title="Domain Overview"
            subtitle="Aggregated results across all editors"
          />
        ) : view.type === 'team' ? (
          <DomainOverview
            onBack={() => setView({ type: 'editors' })}
            scope="team"
            teamEmails={getTeamEmails(view.teamLeadEmail)}
            title={`${view.teamLeadName}'s Team Overview`}
            subtitle={`${getTeamEmails(view.teamLeadEmail).length} team members`}
          />
        ) : view.type === 'analytics' ? (
          <Analytics onBack={() => setView({ type: 'editors' })} />
        ) : view.type === 'sync-logs' ? (
          <SyncLogs onBack={() => setView({ type: 'editors' })} />
        ) : view.type === 'user-management' ? (
          <UserManagement onBack={() => setView({ type: 'editors' })} />
        ) : (
          <div className="space-y-6">
            {/* Overview action buttons */}
            <div className="flex flex-wrap gap-2">
              {canAccessAnalytics && (
                <Button
                  variant="outline"
                  onClick={() => setView({ type: 'analytics' })}
                  className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Sparkles className="h-4 w-4" />
                  Analytics
                </Button>
              )}
              {isTeamLead && (
                <>
                <Button
                  variant="outline"
                  onClick={() => setView({ type: 'domain' })}
                  className="gap-2"
                >
                  <BarChart3 className="h-4 w-4" />
                  Domain Overview
                </Button>
                {teamLeads.map(tl => (
                  <Button
                    key={tl.id}
                    variant="outline"
                    onClick={() => setView({
                      type: 'team',
                      teamLeadEmail: tl.email,
                      teamLeadName: tl.name || tl.email.split('@')[0],
                    })}
                    className="gap-2"
                  >
                    <Users className="h-4 w-4" />
                    {tl.name || tl.email.split('@')[0]}'s Team
                  </Button>
                ))}
                </>
              )}
              {isOpsLead && (
                <>
                <Button
                  variant="outline"
                  onClick={() => setView({ type: 'sync-logs' })}
                  className="gap-2"
                >
                  <ScrollText className="h-4 w-4" />
                  Sync Logs
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setView({ type: 'user-management' })}
                  className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <ShieldCheck className="h-4 w-4" />
                  User Management
                </Button>
                </>
              )}
            </div>
            <EditorsList onSelectEditor={(editor) => setView({ type: 'editor', editor })} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
