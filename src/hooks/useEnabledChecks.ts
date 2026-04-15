import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useEnabledChecks = (country: string) => {
  const { data: enabledTypes, isLoading } = useQuery({
    queryKey: ['check-configs', country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_configs')
        .select('issue_type, enabled')
        .eq('country_code', country);
      if (error) throw error;
      // If no configs exist for this country, allow all types
      if (!data || data.length === 0) return null;
      return new Set(data.filter(c => c.enabled).map(c => c.issue_type));
    },
  });

  const isCheckEnabled = (issueType: string | null): boolean => {
    if (!issueType) return true;
    if (enabledTypes === null || enabledTypes === undefined) return true;
    return enabledTypes.has(issueType);
  };

  return { enabledTypes, isCheckEnabled, isLoading };
};
