import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, Globe, RefreshCw, Link2 } from 'lucide-react';
import EditorsList from '@/components/EditorsList';
import EditorIssues from '@/components/EditorIssues';
import { toast } from 'sonner';

interface Editor {
  id?: string;
  email: string;
  name: string | null;
  role: string;
}

const Dashboard = () => {
  const { user, signOut, isAdmin } = useAuth();
  const [selectedEditor, setSelectedEditor] = useState<Editor | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checkingUrls, setCheckingUrls] = useState(false);
  const [urlProgress, setUrlProgress] = useState<{ checked: number; total: number } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-sheet', {
        body: {
          spreadsheet_id: '1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4',
          sheet_name: 'MYDEAL_DE_API_Vouchers (Preset)',
        },
      });
      if (error) throw error;
      toast.success(`Synced ${data?.synced || 0} rows, ${data?.editors_synced || 0} editors`);
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleCheckUrls = async () => {
    setCheckingUrls(true);
    setUrlProgress(null);
    const batchId = new Date().toISOString().slice(0, 10);
    try {
      let done = false;
      while (!done) {
        const { data, error } = await supabase.functions.invoke('check-urls', {
          body: {
            spreadsheet_id: '1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4',
            sheet_name: 'MYDEAL_DE_API_Vouchers (Preset)',
            batch_id: batchId,
          },
        });
        if (error) throw error;
        setUrlProgress({ checked: data.total_checked, total: data.total_to_check });
        done = data.done;
        if (!done) {
          toast.info(`Checked ${data.total_checked}/${data.total_to_check} URLs...`);
        }
      }
      toast.success('URL check complete!');
    } catch (err: any) {
      toast.error(err.message || 'URL check failed');
    } finally {
      setCheckingUrls(false);
      setUrlProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Audit Tracker</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || checkingUrls}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync Sheet'}
                </Button>
                <Button variant="outline" size="sm" onClick={handleCheckUrls} disabled={checkingUrls || syncing}>
                  <Link2 className={`h-4 w-4 mr-1 ${checkingUrls ? 'animate-pulse' : ''}`} />
                  {checkingUrls && urlProgress
                    ? `${urlProgress.checked}/${urlProgress.total}`
                    : checkingUrls ? 'Starting...' : 'Check URLs'}
                </Button>
                <Badge variant="outline" className="text-xs">Admin</Badge>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {selectedEditor ? (
          <EditorIssues
            editor={selectedEditor}
            onBack={() => setSelectedEditor(null)}
          />
        ) : (
          <EditorsList onSelectEditor={setSelectedEditor} />
        )}
      </main>
    </div>
  );
};

export default Dashboard;
