import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { getGetAuthMeQueryKey, getGetLobbyQueryKey, getListFriendsQueryKey, useLogin } from '@workspace/api-client-react';
import { SignInScreen } from '../../../../lakou-engine/ui';

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);

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
      onGuest={() => setLocation('/')}
      onBack={() => setLocation('/')}
      onSignUp={() => setLocation('/sign-up')}
      error={error}
      busy={login.isPending}
    />
  );
}