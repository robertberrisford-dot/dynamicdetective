import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CheckSeverity = 'issue' | 'warning';

export const useEnabledChecks = (country: string) => {
  const { data, isLoading } = useQuery({
    queryKey: ['check-configs', country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_configs')
        .select('issue_type, enabled, severity')
        .eq('country_code', country);
      if (error) throw error;
      return data || [];
    },
  });

  const enabledTypes = !data || data.length === 0
    ? null
    : new Set(data.filter((c: any) => c.enabled).map((c: any) => c.issue_type));

  const severityMap = new Map<string, CheckSeverity>();
  (data || []).forEach((c: any) => {
    severityMap.set(c.issue_type, (c.severity as CheckSeverity) || 'issue');
  });

  const isCheckEnabled = (issueType: string | null): boolean => {
    if (!issueType) return true;
    if (enabledTypes === null || enabledTypes === undefined) return true;
    return enabledTypes.has(issueType);
  };

  const getSeverity = (issueType: string | null): CheckSeverity | undefined => {
    if (!issueType) return undefined;
    return severityMap.get(issueType);
  };

  return { enabledTypes, isCheckEnabled, getSeverity, isLoading };
};
