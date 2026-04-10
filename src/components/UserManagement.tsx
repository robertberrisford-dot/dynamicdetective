import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Shield, Loader2, Palmtree } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface UserManagementProps {
  onBack: () => void;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  ops_lead: { label: 'Ops Lead', color: 'bg-red-100 text-red-800' },
  team_lead: { label: 'Team Lead', color: 'bg-blue-100 text-blue-800' },
  editor: { label: 'Editor', color: 'bg-gray-100 text-gray-800' },
};

interface UserEntry {
  id: string;
  email: string;
  name: string | null;
  role: string;
  vacation_substitute_email: string | null;
}

const UserManagement = ({ onBack }: UserManagementProps) => {
  const queryClient = useQueryClient();
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [pendingVacationSubs, setPendingVacationSubs] = useState<Record<string, string>>({});

  const { data: users, isLoading } = useQuery({
    queryKey: ['all-users-management'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-user-role', {
        body: { action: 'list' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.users as UserEntry[];
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ email, newRole }: { email: string; newRole: string }) => {
      const { data, error } = await supabase.functions.invoke('manage-user-role', {
        body: { email, role: newRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, { email, newRole }) => {
      toast.success(`Updated ${email} to ${ROLE_LABELS[newRole]?.label || newRole}`);
      queryClient.invalidateQueries({ queryKey: ['all-users-management'] });
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

  const updateVacationSubMutation = useMutation({
    mutationFn: async ({ editorEmail, substituteEmail }: { editorEmail: string; substituteEmail: string | null }) => {
      const { data, error } = await supabase.functions.invoke('manage-user-role', {
        body: { action: 'set_vacation_sub', editor_email: editorEmail, substitute_email: substituteEmail },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, { editorEmail, substituteEmail }) => {
      const subName = substituteEmail
        ? users?.find(u => u.email.toLowerCase() === substituteEmail.toLowerCase())?.name || substituteEmail
        : 'none';
      toast.success(substituteEmail
        ? `Set ${subName} as vacation substitute for ${editorEmail}`
        : `Cleared vacation substitute for ${editorEmail}`
      );
      queryClient.invalidateQueries({ queryKey: ['all-users-management'] });
      queryClient.invalidateQueries({ queryKey: ['vacation-substitutions'] });
      setPendingVacationSubs(prev => {
        const next = { ...prev };
        delete next[editorEmail];
        return next;
      });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update vacation substitute');
    },
  });

  const handleRoleChange = (email: string, newRole: string) => {
    setPendingChanges(prev => ({ ...prev, [email]: newRole }));
  };

  const handleVacationSubChange = (email: string, subEmail: string) => {
    setPendingVacationSubs(prev => ({ ...prev, [email]: subEmail }));
  };

  const handleSave = (email: string) => {
    const newRole = pendingChanges[email];
    if (newRole) {
      updateRoleMutation.mutate({ email, newRole });
    }
  };

  const handleSaveVacationSub = (email: string) => {
    const subEmail = pendingVacationSubs[email];
    if (subEmail !== undefined) {
      updateVacationSubMutation.mutate({
        editorEmail: email,
        substituteEmail: subEmail === '_none_' ? null : subEmail,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h2 className="text-xl font-bold">User Management</h2>
          <p className="text-sm text-muted-foreground">Manage access levels and vacation substitutes</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Role Assignments & Vacation Substitutes
            </div>
          </CardTitle>
          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
            <span><Badge className="bg-red-100 text-red-800 mr-1">Ops Lead</Badge> Full access + manage users</span>
            <span><Badge className="bg-blue-100 text-blue-800 mr-1">Team Lead</Badge> View all issues & analytics</span>
            <span><Badge className="bg-gray-100 text-gray-800 mr-1">Editor</Badge> Own issues only</span>
            <span><Palmtree className="h-3 w-3 inline mr-1 text-green-600" />Vacation sub sees & can edit the editor's issues</span>
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
                  <TableHead>Role</TableHead>
                  <TableHead>New Role</TableHead>
                  <TableHead></TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Palmtree className="h-3.5 w-3.5 text-green-600" />
                      Vacation Sub
                    </div>
                  </TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map(user => {
                  const currentRole = user.role;
                  const pendingRole = pendingChanges[user.email];
                  const displayRole = pendingRole || currentRole;
                  const currentSub = user.vacation_substitute_email;
                  const pendingSub = pendingVacationSubs[user.email];
                  const displaySub = pendingSub !== undefined ? pendingSub : (currentSub || '_none_');

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.name || '—'}
                        {currentSub && (
                          <Palmtree className="h-3 w-3 inline ml-1 text-green-600" title="On vacation" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge className={ROLE_LABELS[currentRole]?.color || ROLE_LABELS.editor.color}>
                          {ROLE_LABELS[currentRole]?.label || 'Editor'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={displayRole}
                          onValueChange={(val) => handleRoleChange(user.email, val)}
                        >
                          <SelectTrigger className="w-[130px]">
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
                        {pendingRole && pendingRole !== currentRole && (
                          <Button
                            size="sm"
                            onClick={() => handleSave(user.email)}
                            disabled={updateRoleMutation.isPending}
                          >
                            {updateRoleMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : 'Save'}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={displaySub}
                          onValueChange={(val) => handleVacationSubChange(user.email, val)}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="No substitute" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">No substitute</SelectItem>
                            {users
                              ?.filter(u => u.email.toLowerCase() !== user.email.toLowerCase())
                              .map(u => (
                                <SelectItem key={u.id} value={u.email}>
                                  {u.name || u.email.split('@')[0]}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {pendingSub !== undefined && pendingSub !== (currentSub || '_none_') && (
                          <Button
                            size="sm"
                            onClick={() => handleSaveVacationSub(user.email)}
                            disabled={updateVacationSubMutation.isPending}
                          >
                            {updateVacationSubMutation.isPending ? (
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
