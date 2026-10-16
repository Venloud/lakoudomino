// Sign in (Figma 11-2).
import React, { useState } from 'react';
import { Domino } from './Domino';
import { Page } from './Shell';

export interface SignInScreenProps {
  onLogin: (user: string, password: string) => void;
  onGoogle?: () => void;
  onApple?: () => void;
  onForgot?: () => void;
  onSignUp?: () => void;
  onGuest?: () => void;
  onBack?: () => void;
  /** Shown in red under the password field, e.g. "Wrong username or password." */
  error?: string | null;
  busy?: boolean;
}

export function SignInScreen({ onLogin, onGoogle, onApple, onForgot, onSignUp, onGuest, onBack, error, busy }: SignInScreenProps) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  return (
    <Page right={onBack && <button className="lk-back" onClick={onBack}>← Back to lobby</button>} onHome={onBack}>
      <main className="lk-auth">
        <div className="lk-chain" aria-hidden="true">
          <Domino first={6} second={6} orientation="v" unit={18} />
          <Domino first={6} second={3} orientation="h" unit={18} />
          <Domino first={3} second={5} orientation="h" unit={18} />
          <Domino first={5} second={5} orientation="v" unit={18} />
          <Domino first={5} second={1} orientation="h" unit={18} />
        </div>
        <form className="lk-panel lk-auth-card" onSubmit={(e) => { e.preventDefault(); if (user.trim() && pass) onLogin(user.trim(), pass); }}>
          <h1 className="lk-auth-title">Sign in to Lakou Domino</h1>
          <p className="lk-auth-sub">Save your crowns, add friends and see who’s online.</p>
          {onGoogle && <button type="button" className="lk-sso lk-sso-google" onClick={onGoogle}><b className="lk-g-mark">G</b>Continue with Google</button>}
          {onApple && <button type="button" className="lk-sso lk-sso-apple" onClick={onApple}>Continue with Apple</button>}
          {(onGoogle || onApple) && <div className="lk-or"><i /><span>OR</span><i /></div>}
          <label className="lk-field">
            <span>Username or email</span>
            <input id="lk-login-user" className="lk-input lk-input-42" value={user} onChange={(e) => setUser(e.target.value)} placeholder="e.g. venloud" autoComplete="username" autoCapitalize="none" />
          </label>
          <label className="lk-field">
            <span>Password</span>
            <input id="lk-login-pass" className="lk-input lk-input-42" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </label>
          {error && <p className="lk-auth-error" role="alert">{error}</p>}
          {onForgot && <button type="button" className="lk-link lk-forgot" onClick={onForgot}>Forgot password?</button>}
          <button type="submit" className="lk-login-btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          {onSignUp && <p className="lk-auth-alt">No account? <button type="button" className="lk-link" onClick={onSignUp}>Sign up</button></p>}
          {onGuest && <button type="button" className="lk-guest" onClick={onGuest}>Keep playing as a guest</button>}
        </form>
      </main>
    </Page>
  );
}
