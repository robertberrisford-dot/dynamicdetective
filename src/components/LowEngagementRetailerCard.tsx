import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ExternalLink, AlertTriangle, Copy } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

interface Props {
  retailerName: string;
  issues: Issue[];
  country?: string;
  onOpenIssue?: (issue: Issue) => void;
  showAssignedBadge?: boolean;
}

const getPageUrl = (seoUrl: string, country?: string) => {
  if (country === 'pl') return `https://www.pepper.pl/kupony/${seoUrl}`;
  if (country === 'uk') return `https://www.hotukdeals.com/vouchers/${seoUrl}`;
  return `https://www.mydealz.de/gutscheine/${seoUrl}`;
};

const parseSummary = (desc: string | null | undefined): { dead: number; total: number; pct: number } | null => {
  if (!desc) return null;
  const m = desc.match(/Low engagement:\s*(\d+)\/(\d+)\s*\((\d+)%\)/i);
  if (!m) return null;
  return { dead: parseInt(m[1], 10), total: parseInt(m[2], 10), pct: parseInt(m[3], 10) };
};

const parseCpd = (desc: string | null | undefined): number | null => {
  if (!desc) return null;
  const m = desc.match(/This voucher CPD:\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
};

const LowEngagementRetailerCard = ({ retailerName, issues, country, onOpenIssue, showAssignedBadge }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const first = issues[0];
  const summary = parseSummary(first?.voucher_description) || { dead: issues.length, total: issues.length, pct: 100 };
  const ctry = (first?.country || country || 'de').toLowerCase();
  const seoUrl = first?.seo_url;
  const oldest = issues.reduce((acc, i) => {
    if (!i.created_at) return acc;
    if (!acc) return i.created_at;
    return new Date(i.created_at) < new Date(acc) ? i.created_at : acc;
  }, null as string | null);

  const openAdmin = () => {
    window.open(
      `https://ap.cuponation.com/country/${ctry}/admin/clients/b375850ebe3345b1a43e6d730ca545b5/vouchers?origin=imt`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{retailerName}</p>
              <Badge variant="destructive" className="text-[10px]">
                {summary.dead}/{summary.total} low engagement ({summary.pct}%)
              </Badge>
              {showAssignedBadge && first?.assigned_email && (
                <Badge variant="outline" className="text-[10px]">{first.assigned_email.split('@')[0]}</Badge>
              )}
              {oldest && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  identified {formatDistanceToNowStrict(new Date(oldest), { addSuffix: true })}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.dead} of {summary.total} active vouchers on this landing page have zero CPD (7d). Prune or refresh them in the admin panel.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="default" className="h-7 gap-1 px-2 text-xs" onClick={openAdmin}>
                <ExternalLink className="h-3 w-3" /> Open Admin Panel
              </Button>
              {seoUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => window.open(getPageUrl(seoUrl, ctry), '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-3 w-3" /> View Page
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setExpanded(v => !v)}
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {expanded ? 'Hide' : 'Show'} {issues.length} voucher{issues.length !== 1 ? 's' : ''}
              </Button>
            </div>
            {expanded && (
              <div className="mt-3 space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
                {issues.map(i => {
                  const cpd = parseCpd(i.voucher_description);
                  return (
                    <div
                      key={i.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-background cursor-pointer"
                      onClick={() => onOpenIssue?.(i)}
                    >
                      <span className="font-mono text-muted-foreground shrink-0">{i.voucher_id_pool || '—'}</span>
                      <span className="truncate flex-1">{i.voucher_title || '—'}</span>
                      {cpd != null && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">CPD {cpd.toFixed(2)}</Badge>
                      )}
                      {i.voucher_type && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">{i.voucher_type}</Badge>
                      )}
                      {i.voucher_id_pool && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(i.voucher_id_pool!);
                            toast.success('Copied');
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LowEngagementRetailerCard;
