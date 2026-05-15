import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CheckSeverity = 'issue' | 'warning';

type CheckConfig = {
  issue_type: string;
  enabled: boolean;
  severity: CheckSeverity | null;
};

export const useEnabledChecks = (country: string) => {
  const { data, isLoading } = useQuery({
    queryKey: ['check-configs', country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_configs')
        .select('issue_type, enabled, severity')
        .eq('country_code', country);
      if (error) throw error;
      return (data || []) as CheckConfig[];
    },
  });

  const enabledTypes = useMemo(() => {
    if (!data || data.length === 0) return null;
    return new Set(data.filter(c => c.enabled).map(c => c.issue_type));
  }, [data]);

  const severityMap = useMemo(() => {
    const map = new Map<string, CheckSeverity>();
    (data || []).forEach(c => {
      map.set(c.issue_type, c.severity || 'issue');
    });
    return map;
  }, [data]);

  const configSignature = useMemo(() => {
    if (!data) return 'loading';
    if (data.length === 0) return 'all';
    return data
      .map(c => `${c.issue_type}:${c.enabled ? '1' : '0'}:${c.severity || 'issue'}`)
      .sort()
      .join('|');
  }, [data]);

  const isCheckEnabled = useCallback((issueType: string | null): boolean => {
    if (!issueType) return true;
    if (enabledTypes === null || enabledTypes === undefined) return true;
    return enabledTypes.has(issueType);
  }, [enabledTypes]);

  const getSeverity = useCallback((issueType: string | null): CheckSeverity | undefined => {
    if (!issueType) return undefined;
    return severityMap.get(issueType);
  }, [severityMap]);

  return { enabledTypes, configSignature, isCheckEnabled, getSeverity, isLoading };
};
