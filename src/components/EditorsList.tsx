import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, UserCheck } from 'lucide-react';

interface Editor {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface EditorsListProps {
  onSelectEditor: (editor: Editor) => void;
}

const roleConfig: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  team_lead: { label: 'Team Lead', icon: Shield, color: 'text-amber-500' },
  editor: { label: 'Editor', icon: UserCheck, color: 'text-primary' },
};

const EditorsList = ({ onSelectEditor }: EditorsListProps) => {
  const { data: editors, isLoading } = useQuery({
    queryKey: ['editors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('editors')
        .select('*')
        .in('role', ['team_lead', 'editor'])
        .neq('email', 'thomas.punzel@atolls.com')
        .order('name');
      if (error) throw error;
      return data as Editor[];
    },
  });

  const { data: issueCounts } = useQuery({
    queryKey: ['issue-counts-by-email'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issues')
        .select('assigned_email');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach(issue => {
        const email = issue.assigned_email?.toLowerCase();
        if (email) counts[email] = (counts[email] || 0) + 1;
      });
      return counts;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const grouped = {
    team_lead: editors?.filter(e => e.role === 'team_lead') || [],
    editor: editors?.filter(e => e.role === 'editor') || [],
  };

  return (
    <div className="space-y-8">
      {(['team_lead', 'editor'] as const).map(role => {
        const list = grouped[role];
        if (list.length === 0) return null;
        const cfg = roleConfig[role];
        const RoleIcon = cfg.icon;

        return (
          <div key={role}>
            <div className="mb-3 flex items-center gap-2">
              <RoleIcon className={`h-5 w-5 ${cfg.color}`} />
              <h2 className="text-lg font-semibold">{cfg.label}s</h2>
              <Badge variant="outline" className="text-xs">{list.length}</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map(editor => {
                const count = issueCounts?.[editor.email.toLowerCase()] || 0;
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
                      {count > 0 && (
                        <Badge variant="secondary" className="shrink-0">
                          {count} issues
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

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
