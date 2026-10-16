import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { getGetAuthMeQueryKey, getGetLobbyQueryKey, getListFriendsQueryKey, useSignup } from '@workspace/api-client-react';

export default function SignUpPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const signup = useSignup();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    signup.mutate({ data: { username: username.trim(), password } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetAuthMeQueryKey(), { user: result.user });
        queryClient.removeQueries({ queryKey: getListFriendsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
        setLocation('/');
      },
      onError: (cause) => setError(cause instanceof Error ? cause.message : 'We could not create your account.'),
    });
  };

  return (
    <main className="account-shell">
      <section className="account-card">
        <p className="account-kicker">LAKOU DOMINO</p>
        <h1 className="account-title">Bring your people to the table.</h1>
        <p className="account-copy">Create an account to keep your crowns, find friends and see who is ready for a game.</p>
        <form className="account-form" onSubmit={submit}>
          <label className="account-field">Username<input data-testid="input-signup-username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={16} pattern="[A-Za-z0-9_]+" autoComplete="username" required /></label>
          <label className="account-field">Password<input data-testid="input-signup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          {error && <p className="account-error" role="alert" data-testid="signup-error">{error}</p>}
          <button className="account-submit" data-testid="button-signup-submit" type="submit" disabled={signup.isPending}>{signup.isPending ? 'Creating account…' : 'Create account'}</button>
        </form>
        <div className="account-foot"><span>Already playing?</span><button className="account-link" data-testid="link-signin" type="button" onClick={() => setLocation('/sign-in')}>Sign in</button></div>
      </section>
    </main>
  );
}