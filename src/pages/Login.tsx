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
            Atollian Dynamic Detective
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
              <div className="flex flex-col gap-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2 w-full"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {googleLoading ? 'Signing in…' : 'Continue with Google'}
                </Button>

                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <Separator className="flex-1" />
                </div>

                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11"
                  />
                  <Button type="submit" disabled={loading} className="h-11 gap-2">
                    {loading ? 'Sending…' : 'Send magic link'}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
