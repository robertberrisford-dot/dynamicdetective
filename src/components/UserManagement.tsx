import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Shield, Users, UserCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface UserManagementProps {
  onBack: () => void;
}

const ROLE_LABELS: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  ops_lead: { label: 'Ops Lead', color: 'bg-red-100 text-red-800', icon: Shield },
  team_lead: { label: 'Team Lead', color: 'bg-blue-100 text-blue-800', icon: Users },
  editor: { label: 'Editor', color: 'bg-gray-100 text-gray-800', icon: UserCheck },
};

const UserManagement = ({ onBack }: UserManagementProps) => {
  const queryClient = useQueryClient();
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});

  // Get all editors from editors table
  const { data: editors, isLoading: editorsLoading } = useQuery({
    queryKey: ['editors-management'],
    queryFn: async () => {
      const { data, error } = await supabase.from('editors').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  // Get all auth users with their roles
  const { data: authUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['auth-users-roles'],
    queryFn: async () => {
      // Get user_roles - we can only see these if we're ops_lead/admin
      const { data: roles, error } = await supabase.from('user_roles').select('*');
      if (error) throw error;
      return roles;
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ email, newRole }: { email: string; newRole: string }) => {
      // Find the editor's auth user by matching email in editors table
      // We need to use an edge function or RPC for this since we can't query auth.users
      // Instead, look up user_id from user_roles or use the email approach

      // First, find if this user already has a role entry
      const existingRole = authUsers?.find(r => {
        const editor = editors?.find(e => e.email.toLowerCase() === email.toLowerCase());
        // We match by checking all role entries
        return false; // We'll handle this differently
      });

      // Use a simpler approach: call an edge function to manage roles
      const { data, error } = await supabase.functions.invoke('manage-user-role', {
        body: { email, role: newRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, { email, newRole }) => {
      toast.success(`Updated ${email} to ${ROLE_LABELS[newRole]?.label || newRole}`);
      queryClient.invalidateQueries({ queryKey: ['auth-users-roles'] });
      setPendingChanges(prev => {
        const next = { ...prev };
        delete next[email];
        return next;
      });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update role');
    },
  });

  // Deduplicate editors by email
  const uniqueEditors = (() => {
    if (!editors) return [];
    const seen = new Set<string>();
    return editors.filter(e => {
      const key = e.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  // Map email -> current role from user_roles
  const getRoleForEmail = (email: string): string => {
    // This is tricky because user_roles uses user_id, not email
    // We'll show the editors table role as a fallback display
    return 'editor'; // Default, will be updated by edge function
  };

  const handleRoleChange = (email: string, newRole: string) => {
    setPendingChanges(prev => ({ ...prev, [email]: newRole }));
  };

  const handleSave = (email: string) => {
    const newRole = pendingChanges[email];
    if (newRole) {
      updateRoleMutation.mutate({ email, newRole });
    }
  };

  const isLoading = editorsLoading || usersLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h2 className="text-xl font-bold">User Management</h2>
          <p className="text-sm text-muted-foreground">Manage access levels for all users</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Role Assignments
            </div>
          </CardTitle>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span><Badge className="bg-red-100 text-red-800 mr-1">Ops Lead</Badge> Full access + manage users</span>
            <span><Badge className="bg-blue-100 text-blue-800 mr-1">Team Lead</Badge> View all issues & analytics</span>
            <span><Badge className="bg-gray-100 text-gray-800 mr-1">Editor</Badge> Own issues only</span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Current Role</TableHead>
                  <TableHead>New Role</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uniqueEditors.map(editor => {
                  const editorRole = editor.role === 'team_lead' ? 'team_lead' : 'editor';
                  const pending = pendingChanges[editor.email];
                  const displayRole = pending || editorRole;
                  const roleInfo = ROLE_LABELS[displayRole] || ROLE_LABELS.editor;

                  return (
                    <TableRow key={editor.id}>
                      <TableCell className="font-medium">{editor.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{editor.email}</TableCell>
                      <TableCell>
                        <Badge className={ROLE_LABELS[editorRole]?.color}>
                          {ROLE_LABELS[editorRole]?.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={displayRole}
                          onValueChange={(val) => handleRoleChange(editor.email, val)}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="editor">Editor</SelectItem>
                            <SelectItem value="team_lead">Team Lead</SelectItem>
                            <SelectItem value="ops_lead">Ops Lead</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {pending && pending !== editorRole && (
                          <Button
                            size="sm"
                            onClick={() => handleSave(editor.email)}
                            disabled={updateRoleMutation.isPending}
                          >
                            {updateRoleMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : 'Save'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagement;
