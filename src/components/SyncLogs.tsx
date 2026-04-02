import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface SyncLogsProps {
  onBack: () => void;
}

const SyncLogs = ({ onBack }: SyncLogsProps) => {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success': return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Success</Badge>;
      case 'error': return <Badge variant="destructive">Error</Badge>;
      case 'running': return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Running</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getFunctionLabel = (name: string) => {
    switch (name) {
      case 'sync-google-sheet': return 'Sheet Sync';
      case 'check-urls': return 'URL Check';
      default: return name;
    }
  };

  const getDuration = (started: string, finished: string | null) => {
    if (!finished) return '—';
    const ms = new Date(finished).getTime() - new Date(started).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-bold">Sync Logs</h2>
          <p className="text-sm text-muted-foreground">Automated daily syncs run at 7:00 AM CEST</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !logs?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          No sync logs yet. Logs will appear after the first automated sync runs.
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 rounded-lg border bg-card p-4"
            >
              <div className="mt-0.5">{getStatusIcon(log.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{getFunctionLabel(log.function_name)}</span>
                  {getStatusBadge(log.status)}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Duration: {getDuration(log.started_at, log.finished_at)}
                  </span>
                </div>
                {log.message && (
                  <p className={`text-sm mt-1 ${log.status === 'error' ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {log.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SyncLogs;
