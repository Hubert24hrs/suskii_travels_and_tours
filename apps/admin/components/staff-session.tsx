'use client';

import type { Permission, Role } from '@suskii/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { adminApi, type Schemas } from '../lib/api';
import { grantedPermissions } from '../lib/permissions';
import { forgetSession, hasSession, SESSION_EVENT } from '../lib/session';

export type StaffSession =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | {
      status: 'signed-in';
      user: Schemas['AuthUser'];
      permissions: ReadonlySet<Permission>;
      /** A staff role (not just customer). */
      staff: boolean;
    };

interface StaffSessionValue {
  session: StaffSession;
  /** Reads the signed-in user again (after sign-in, enrolment or a 401). */
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const StaffSessionContext = createContext<StaffSessionValue | null>(null);

const isStaffRole = (role: Role): boolean => role !== 'customer';

/** Who is signed in to the console, from GET /v1/me with the session cookies. */
export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<StaffSession>({ status: 'loading' });

  const reload = useCallback(async () => {
    if (!hasSession()) {
      setSession({ status: 'signed-out' });
      return;
    }
    const { data, response } = await adminApi.GET('/v1/me');
    if (data) {
      setSession({
        status: 'signed-in',
        user: data,
        permissions: grantedPermissions(data.roles),
        staff: data.roles.some(isStaffRole),
      });
    } else if (response.status === 401) {
      forgetSession();
      setSession({ status: 'signed-out' });
    } else {
      // A network or server error: keep whatever we knew rather than signing staff out.
      setSession((current) => (current.status === 'loading' ? { status: 'signed-out' } : current));
    }
  }, []);

  useEffect(() => {
    // A microtask keeps the state change out of the effect body (React Compiler rule).
    void Promise.resolve().then(reload);
    const onSession = () => void reload();
    window.addEventListener(SESSION_EVENT, onSession);
    return () => window.removeEventListener(SESSION_EVENT, onSession);
  }, [reload]);

  const signOut = useCallback(async () => {
    await adminApi.POST('/v1/auth/logout', { body: {} }).catch(() => undefined);
    forgetSession();
    queryClient.clear();
    setSession({ status: 'signed-out' });
  }, [queryClient]);

  const value = useMemo<StaffSessionValue>(
    () => ({
      session,
      reload,
      signOut,
      can: (permission) => session.status === 'signed-in' && session.permissions.has(permission),
    }),
    [session, reload, signOut],
  );
  return <StaffSessionContext value={value}>{children}</StaffSessionContext>;
}

export function useStaffSession(): StaffSessionValue {
  const value = use(StaffSessionContext);
  if (!value) throw new Error('useStaffSession must be used inside <StaffSessionProvider>');
  return value;
}
