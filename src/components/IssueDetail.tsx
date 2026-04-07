import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, MessageSquare, Clock, Send, ExternalLink, User } from 'lucide-react';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Issue = Tables<'issues'>;

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'wont_fix', label: "Won't Fix" },
];

const fieldGroups = [
  {
    title: 'General',
    fields: [
      { key: 'retailer_id', label: 'Retailer ID' },
      { key: 'retailer_pool_id', label: 'Pool ID' },
      { key: 'client_name', label: 'Client Name' },
      { key: 'merchant_quality', label: 'Merchant Quality' },
      { key: 'affiliate_network', label: 'Affiliate Network' },
      { key: 'country', label: 'Country' },
      { key: 'retailer_assignment', label: 'Assignment' },
    ],
  },
  {
    title: 'Content Status',
    fields: [
      { key: 'published', label: 'Published' },
      { key: 'indexed', label: 'Indexed' },
      { key: 'active_vouchers', label: 'Active Vouchers' },
      { key: 'active_codes', label: 'Active Codes' },
      { key: 'active_deals', label: 'Active Deals' },
      { key: 'show_expired_vouchers', label: 'Show Expired' },
      { key: 'last_verified', label: 'Last Verified' },
      { key: 'ranking_algorithm', label: 'Ranking Algorithm' },
    ],
  },
  {
    title: 'SEO',
    fields: [
      { key: 'seo_url', label: 'SEO URL' },
      { key: 'retailer_seo_title', label: 'SEO Title' },
      { key: 'retailer_seo_desc', label: 'SEO Description' },
      { key: 'h1', label: 'H1' },
      { key: 'logo_alt_text', label: 'Logo Alt Text' },
      { key: 'page_title', label: 'Page Title' },
      { key: 'retailer_url_anchor', label: 'URL Anchor' },
      { key: 'retailer_url', label: 'Retailer URL' },
      { key: 'url_anchor_js_link', label: 'JS Link' },
    ],
  },
  {
    title: 'Keywords',
    fields: [
      { key: 'keyword_1', label: 'Keyword 1' },
      { key: 'keyword_2', label: 'Keyword 2' },
      { key: 'keyword_3', label: 'Keyword 3' },
      { key: 'keyword_4', label: 'Keyword 4' },
    ],
  },
];

interface Props {
  issue: Issue;
  onBack: () => void;
}

const IssueDetail = ({ issue, onBack }: Props) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(issue.status);

  const { data: comments } = useQuery({
    queryKey: ['comments', issue.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('issue_id', issue.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: statusHistory } = useQuery({
    queryKey: ['status_updates', issue.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issue_status_updates')
        .select('*')
        .eq('issue_id', issue.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('comments').insert({
        issue_id: issue.id,
        user_id: user!.id,
        user_email: user!.email!,
        comment_text: comment,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['comments', issue.id] });
      toast.success('Comment added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error: statusError } = await supabase.from('issue_status_updates').insert({
        issue_id: issue.id,
        old_status: issue.status,
        new_status: newStatus,
        updated_by: user!.id,
        updated_by_email: user!.email!,
      });
      if (statusError) throw statusError;

      const updatePayload: Record<string, unknown> = { status: newStatus };
      if (['resolved', 'wont_fix', 'hidden_3m'].includes(newStatus)) {
        const hideUntil = new Date();
        hideUntil.setMonth(hideUntil.getMonth() + 3);
        updatePayload.hidden_until = hideUntil.toISOString();
      } else {
        updatePayload.hidden_until = null;
      }
      const { error: updateError } = await supabase
        .from('issues')
        .update(updatePayload)
        .eq('id', issue.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status_updates', issue.id] });
      toast.success('Status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    updateStatus.mutate(newStatus);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">
              {issue.client_name || issue.retailer_id || 'Issue Detail'}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {issue.assigned_email && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  {issue.assigned_email}
                </span>
              )}
              {issue.seo_url && (
                <span className="truncate text-xs text-muted-foreground">· {issue.seo_url}</span>
              )}
            </div>
          </div>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Details */}
          <div className="space-y-4 lg:col-span-2">
            {fieldGroups.map(group => {
              const visibleFields = group.fields.filter(
                f => (issue as Record<string, unknown>)[f.key]
              );
              if (visibleFields.length === 0) return null;
              return (
                <Card key={group.title} className="border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {group.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {visibleFields.map(f => {
                      const val = (issue as Record<string, unknown>)[f.key] as string;
                      const isUrl = val?.startsWith('http');
                      const isAssignment = f.key === 'retailer_assignment' && val?.includes(',');
                      return (
                        <div key={f.key}>
                          <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                          {isUrl ? (
                            <a
                              href={val}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              {val.replace(/^https?:\/\//, '').slice(0, 40)}…
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : isAssignment ? (
                            <div className="space-y-0.5">
                              {val.split(',').map((email, i) => (
                                <p key={i} className="text-sm break-words">{email.trim()}</p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm break-words">{val}</p>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Sidebar: Comments & History */}
          <div className="space-y-4">
            {/* Add comment */}
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({comments?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Add a comment…"
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    className="min-h-[60px] resize-none text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => addComment.mutate()}
                  disabled={!comment.trim() || addComment.isPending}
                  className="w-full gap-1"
                >
                  <Send className="h-3.5 w-3.5" />
                  Post
                </Button>

                {comments && comments.length > 0 && (
                  <>
                    <Separator />
                    <div className="max-h-[300px] space-y-3 overflow-y-auto">
                      {comments.map(c => (
                        <div key={c.id} className="rounded-lg bg-muted/50 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium">{c.user_email}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(c.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <p className="mt-1 text-sm">{c.comment_text}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Status history */}
            {statusHistory && statusHistory.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="h-4 w-4" />
                    Status History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {statusHistory.map(h => (
                      <div key={h.id} className="flex items-start gap-2 text-xs">
                        <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <div>
                          <p>
                            <span className="font-medium">{h.updated_by_email}</span> changed from{' '}
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {h.old_status || '—'}
                            </Badge>{' '}
                            to{' '}
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {h.new_status}
                            </Badge>
                          </p>
                          <p className="text-muted-foreground">
                            {new Date(h.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default IssueDetail;
