import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, UserCheck, ChevronRight, ShieldAlert, AlertTriangle } from 'lucide-react';

const WARNING_TYPES = new Set([
  'missing_caption_1',
  'repeated_caption_1',
  'repeated_caption_combo',
  'stale_evergreen',
  'abc_repeated_tnc',
  'non_numerical_caption',
  'multiple_manual_picks',
  'similar_titles',
]);

interface Editor {
  id: string;
  email: string;
  name: string | null;
  role: string;
  team_lead_email: string | null;
}

interface EditorsListProps {
  onSelectEditor: (editor: Editor) => void;
}

const EditorsList = ({ onSelectEditor }: EditorsListProps) => {
  const { data: editorsData, isLoading } = useQuery({
    queryKey: ['editors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('editors')
        .select('*')
        .in('role', ['team_lead', 'editor'])
        .neq('email', 'thomas.punzel@atolls.com')
        .order('name');
      if (error) throw error;
      const all = data as Editor[];

      // Build a map of all emails per editor (use email as unique key, not name)
      const emailsByKey: Record<string, string[]> = {};
      for (const e of all) {
        const key = e.email.toLowerCase();
        emailsByKey[key] = [key];
      }
      return { deduped: all, emailsByKey };
    },
  });

  const editors = editorsData?.deduped;
  const emailsByKey = editorsData?.emailsByKey || {};

  const { data: issueCounts } = useQuery({
    queryKey: ['issue-counts-by-email-split'],
    queryFn: async () => {
      const issues: Record<string, number> = {};
      const warnings: Record<string, number> = {};
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('issues')
          .select('assigned_email, issue_type, status, hidden_until')
          .not('status', 'in', '("resolved","wont_fix")')
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const now = new Date().toISOString();
        data?.forEach(issue => {
          const email = issue.assigned_email?.toLowerCase();
          if (!email) return;
          // Skip hidden_3m issues that are still within their hide window
          if (issue.status === 'hidden_3m' && issue.hidden_until && issue.hidden_until > now) return;
          if (WARNING_TYPES.has(issue.issue_type || '')) {
            warnings[email] = (warnings[email] || 0) + 1;
          } else {
            issues[email] = (issues[email] || 0) + 1;
          }
        });
        if (!data || data.length < PAGE) break;
        offset += PAGE;
      }
      return { issues, warnings };
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Deduplicate team leads by name (diacritical email variants)
  const teamLeads = (() => {
    const raw = editors?.filter(e => e.role === 'team_lead') || [];
    const seen = new Set<string>();
    return raw.filter(tl => {
      const key = (tl.name || tl.email.split('@')[0]).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  // Collect all team lead email variants for matching
  const allTeamLeadEmails = editors?.filter(e => e.role === 'team_lead') || [];
  const tlEmailsByName: Record<string, string[]> = {};
  for (const tl of allTeamLeadEmails) {
    const key = (tl.name || tl.email.split('@')[0]).toLowerCase();
    if (!tlEmailsByName[key]) tlEmailsByName[key] = [];
    tlEmailsByName[key].push(tl.email.toLowerCase());
  }

  const editorsList = editors?.filter(e => e.role === 'editor') || [];

  // Group editors by team lead, matching against ALL email variants for each TL
  const teamsByLead: Record<string, Editor[]> = {};
  for (const tl of teamLeads) {
    const key = (tl.name || tl.email.split('@')[0]).toLowerCase();
    const variants = tlEmailsByName[key] || [tl.email.toLowerCase()];
    teamsByLead[tl.email.toLowerCase()] = editorsList.filter(
      e => e.team_lead_email && variants.includes(e.team_lead_email.toLowerCase())
    );
  }

  // Calculate team totals
  const getTeamIssueCount = (teamLeadEmail: string) => {
    const members = teamsByLead[teamLeadEmail.toLowerCase()] || [];
    return members.reduce((sum, m) => {
      const e = m.email.toLowerCase();
      return sum + (issueCounts?.issues[e] || 0);
    }, 0);
  };

  const getTeamWarningCount = (teamLeadEmail: string) => {
    const members = teamsByLead[teamLeadEmail.toLowerCase()] || [];
    return members.reduce((sum, m) => {
      const e = m.email.toLowerCase();
      return sum + (issueCounts?.warnings[e] || 0);
    }, 0);
  };

  return (
    <div className="space-y-8">
      {teamLeads.map(tl => {
        const members = teamsByLead[tl.email.toLowerCase()] || [];
        const teamIssues = getTeamIssueCount(tl.email);
        const teamWarnings = getTeamWarningCount(tl.email);

        return (
          <div key={tl.id}>
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-semibold">
                {tl.name || tl.email.split('@')[0]}'s Team
              </h2>
              <Badge variant="outline" className="text-xs">{members.length} editors</Badge>
              {teamIssues > 0 && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  {teamIssues}
                </Badge>
              )}
              {teamWarnings > 0 && (
                <Badge variant="outline" className="text-xs gap-1 border-amber-500/50 text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  {teamWarnings}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {members.map(editor => {
                const email = editor.email.toLowerCase();
                const issueCount = issueCounts?.issues[email] || 0;
                const warningCount = issueCounts?.warnings[email] || 0;
                return (
                  <Card
                    key={editor.id}
                    className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md"
                    onClick={() => onSelectEditor(editor)}
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                        {(editor.name || editor.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {editor.name || editor.email.split('@')[0]}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{editor.email}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {issueCount > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <ShieldAlert className="h-3 w-3" />
                            {issueCount}
                          </Badge>
                        )}
                        {warningCount > 0 && (
                          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {warningCount}
                          </Badge>
                        )}
                        {issueCount === 0 && warningCount === 0 && (
                          <Badge variant="secondary" className="text-muted-foreground">0</Badge>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Unassigned editors */}
      {(() => {
        const unassigned = editorsList.filter(e => !e.team_lead_email);
        if (unassigned.length === 0) return null;
        return (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Unassigned Editors</h2>
              <Badge variant="outline" className="text-xs">{unassigned.length}</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {unassigned.map(editor => {
                const email = editor.email.toLowerCase();
                const issueCount = issueCounts?.issues[email] || 0;
                const warningCount = issueCounts?.warnings[email] || 0;
                return (
                  <Card
                    key={editor.id}
                    className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md"
                    onClick={() => onSelectEditor(editor)}
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                        {(editor.name || editor.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {editor.name || editor.email.split('@')[0]}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{editor.email}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {issueCount > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <ShieldAlert className="h-3 w-3" />
                            {issueCount}
                          </Badge>
                        )}
                        {warningCount > 0 && (
                          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {warningCount}
                          </Badge>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })()}

      {(!editors || editors.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-medium text-muted-foreground">No editors found</p>
            <p className="text-sm text-muted-foreground/60">Sync the sheet to populate editors</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EditorsList;
