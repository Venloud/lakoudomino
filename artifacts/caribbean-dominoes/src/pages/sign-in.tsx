import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { getGetAuthMeQueryKey, getGetLobbyQueryKey, getListFriendsQueryKey, useLogin } from '@workspace/api-client-react';
import { SignInScreen } from '../../../../lakou-engine/ui';

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code === 'google_setup') return 'Google sign-in is not configured yet. Add the Google OAuth credentials in Replit Secrets.';
    if (code?.startsWith('google_')) return 'Google sign-in could not be completed. Please try again.';
    return null;
  });

  const enterAccount = (username: string, password: string) => {
    setError(null);
    login.mutate({ data: { username, password } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetAuthMeQueryKey(), { user: result.user });
        queryClient.removeQueries({ queryKey: getListFriendsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
        setLocation('/');
      },
      onError: (cause) => setError(cause instanceof Error ? cause.message : 'We could not sign you in.'),
    });
  };

  return (
    <SignInScreen
      onLogin={enterAccount}
      onGoogle={() => window.location.assign('/api/auth/google')}
      onGuest={() => setLocation('/')}
      onBack={() => setLocation('/')}
      onSignUp={() => setLocation('/sign-up')}
      error={error}
      busy={login.isPending}
    />
  );
}