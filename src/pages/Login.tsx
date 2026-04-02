import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Mail, ArrowRight, CheckCircle } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error('Google sign-in failed');
      setGoogleLoading(false);
    }
    if (result.redirected) return;
    setGoogleLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success('Check your email for the login link!');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Mail className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Audit Tracker
          </h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to view your assigned website audits
          </p>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {sent ? 'Check your inbox' : 'Sign in with email'}
            </CardTitle>
            <CardDescription>
              {sent
                ? `We sent a magic link to ${email}`
                : 'Enter your email to receive a magic login link'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <CheckCircle className="h-12 w-12 text-accent" />
                <p className="text-sm text-muted-foreground text-center">
                  Click the link in the email to sign in. You can close this tab.
                </p>
                <Button
                  variant="ghost"
                  onClick={() => setSent(false)}
                  className="mt-2"
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="h-11"
                />
                <Button type="submit" disabled={loading} className="h-11 gap-2">
                  {loading ? 'Sending…' : 'Send magic link'}
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
