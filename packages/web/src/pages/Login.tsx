import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBox } from '../components/ui';
import { useTRPC } from '../trpc';

export function LoginPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const onSuccess = () => qc.invalidateQueries();
  const login = useMutation(trpc.auth.login.mutationOptions({ onSuccess }));
  const register = useMutation(trpc.auth.register.mutationOptions({ onSuccess }));
  const busy = login.isPending || register.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') login.mutate({ username, password });
    else register.mutate({ username, password, displayName: displayName || username });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1c2a44_0%,_#070b14_60%)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border-4 border-goal/80 bg-rink-900">
            <div className="h-3 w-7 rounded-full bg-ice-100" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-wide text-white uppercase">Hockey GM</h1>
          <p className="mt-1 text-sm text-ice-400">Run a franchise with your friends.</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-rink-700 bg-rink-900 p-5">
          <div className="grid grid-cols-2 rounded-lg bg-rink-800 p-1 text-sm">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md py-1.5 font-semibold ${mode === m ? 'bg-rink-600 text-white' : 'text-ice-400'}`}
              >
                {m === 'login' ? 'Log in' : 'Create account'}
              </button>
            ))}
          </div>
          <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
          {mode === 'register' && <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="How other managers see you" />}
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'register' ? 'At least 8 characters' : undefined}
          />
          <ErrorBox error={login.error ?? register.error} />
          <Button type="submit" className="w-full py-2" disabled={busy || !username || !password}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-wide text-ice-400 uppercase">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-rink-600 bg-rink-800 px-3 py-2 text-sm text-white placeholder:text-ice-500 focus:border-blueline focus:outline-none"
        {...rest}
      />
    </label>
  );
}
