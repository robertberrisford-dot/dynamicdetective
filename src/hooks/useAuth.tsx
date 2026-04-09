import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'ops_lead' | 'team_lead' | 'editor' | null;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isOpsLead: boolean;
  isTeamLead: boolean;
  userRole: UserRole;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  isAdmin: false,
  isOpsLead: false,
  isTeamLead: false,
  userRole: null,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>(null);

  const checkRole = (userId: string) => {
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (!data || data.length === 0) {
          setUserRole('editor');
          return;
        }
        const roles = data.map(r => r.role);
        if (roles.includes('admin') || roles.includes('ops_lead')) {
          setUserRole('ops_lead');
        } else if (roles.includes('team_lead')) {
          setUserRole('team_lead');
        } else {
          setUserRole('editor');
        }
      });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkRole(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          checkRole(session.user.id);
        } else {
          setUserRole(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const isAdmin = userRole === 'ops_lead';
  const isOpsLead = userRole === 'ops_lead';
  const isTeamLead = userRole === 'team_lead' || userRole === 'ops_lead';

  const signOut = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      setSession(null);
      setUser(null);
      setUserRole(null);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, isAdmin, isOpsLead, isTeamLead, userRole, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
