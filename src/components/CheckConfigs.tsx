import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Settings2, AlertTriangle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import CountrySelector from '@/components/CountrySelector';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CheckConfigsProps {
  onBack: () => void;
  country: string;
}

const CheckConfigs = ({ onBack, country: initialCountry }: CheckConfigsProps) => {
  const queryClient = useQueryClient();
  const [selectedCountry, setSelectedCountry] = useState(initialCountry);

  const { data: configs, isLoading } = useQuery({
    queryKey: ['check-configs-admin', selectedCountry],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_configs')
        .select('*')
        .eq('country_code', selectedCountry)
        .order('label');
      if (error) throw error;
      return data || [];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('check_configs')
        .update({ enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-configs-admin', selectedCountry] });
      queryClient.invalidateQueries({ queryKey: ['check-configs', selectedCountry] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update');
    },
  });

  const severityMutation = useMutation({
    mutationFn: async ({ id, severity }: { id: string; severity: 'issue' | 'warning' }) => {
      const { error } = await supabase
        .from('check_configs')
        .update({ severity })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-configs-admin', selectedCountry] });
      queryClient.invalidateQueries({ queryKey: ['check-configs', selectedCountry] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update severity');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Check Configuration</h2>
        </div>
        <CountrySelector value={selectedCountry} onChange={setSelectedCountry} />
      </div>

      <p className="text-sm text-muted-foreground">
        Toggle which issue checks are visible to editors. Disabled checks will not appear in editor views, but the data is still tracked in the database.
      </p>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid gap-3">
          {configs?.map((config: any) => {
            const severity: 'issue' | 'warning' = config.severity || 'issue';
            const isWarning = severity === 'warning';
            return (
              <div
                key={config.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3 gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{config.label}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{config.issue_type}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      severityMutation.mutate({
                        id: config.id,
                        severity: isWarning ? 'issue' : 'warning',
                      })
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      isWarning
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                        : 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
                    )}
                    title="Click to toggle between Issue and Warning"
                  >
                    {isWarning ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    {isWarning ? 'Warning' : 'Issue'}
                  </button>
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({ id: config.id, enabled: checked })
                    }
                  />
                </div>
              </div>
            );
          })}
          {configs?.length === 0 && (
            <p className="text-sm text-muted-foreground">No check configurations found for this country.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CheckConfigs;
