import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  renew: vi.fn(),
  status: vi.fn(),
  user: vi.fn(),
  onboarding: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/shared/api', () => ({
  renewAuthSession: mocks.renew,
  api: {
    auth: { status: mocks.status, user: mocks.user },
    user: { onboardingStatus: mocks.onboarding },
  },
}));
vi.mock('@/shared/userSettings', () => ({ hydrateUserPreferences: vi.fn(), resetUserPreferences: vi.fn() }));
vi.mock('@/shared/chatDrafts', () => ({ hydrateChatDrafts: vi.fn(), resetChatDrafts: vi.fn() }));

const jwt = (iat: number, exp: number) => `e30.${btoa(JSON.stringify({ iat, exp })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  vi.resetModules();
  localStorage.clear();
  const now = Date.now() / 1000;
  localStorage.setItem('auth-token', jwt(now - 600, now + 60));
  mocks.renew.mockReset();
  mocks.status.mockReset().mockImplementation(async () => json({ needsSetup: false }));
  mocks.user.mockReset().mockImplementation(async () => json({ user: { id: 1, username: 'tester' } }));
  mocks.onboarding.mockReset().mockImplementation(async () => json({ hasCompletedOnboarding: true }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function mount() {
  const { AuthProvider, useAuth } = await import('@/modules/auth/context/AuthContext');
  function Probe() {
    const { user, token } = useAuth();
    return <output>{user?.username ?? 'none'}:{token ? 'token' : 'empty'}</output>;
  }
  const view = render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => {});
  return view;
}

test('offline renewal retains the user, coalesces wake events, and retries while visible', async () => {
  mocks.renew.mockRejectedValue(new TypeError('offline'));
  const view = await mount();
  const originalToken = localStorage.getItem('auth-token');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));
  });
  expect(mocks.renew).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).toBe('tester:token');
  expect(localStorage.getItem('auth-token')).toBe(originalToken);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(mocks.renew).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(mocks.renew).toHaveBeenCalledTimes(2);
});

test('hidden tabs defer due renewal and resume on visibility wake', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  mocks.renew.mockResolvedValue(null);
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(mocks.renew).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(mocks.renew).toHaveBeenCalledTimes(1);
});

test('a failed bootstrap user request retains credentials and can recover without page reload', async () => {
  mocks.user.mockImplementationOnce(async () => json({}, 503));
  mocks.renew.mockResolvedValue(null);
  const view = await mount();
  expect(view.container.textContent).toBe('none:token');
  expect(localStorage.getItem('auth-token')).toBeTruthy();
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(view.container.textContent).toBe('tester:token');
});

test('platform auth ignores standalone expiry and never calls standalone JWT renewal', async () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'true');
  const view = await mount();
  const { expireAuthSession } = await import('@/shared/authToken');
  act(() => expireAuthSession());
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(view.container.textContent).toContain('platform-user');
  expect(mocks.renew).not.toHaveBeenCalled();
});

test('bootstrap accepts the user when its own response rotates the half-life JWT', async () => {
  mocks.user.mockImplementationOnce(async () => {
    const { storeAuthToken } = await import('@/shared/authToken');
    const now = Date.now() / 1000;
    const rotated = jwt(now, now + 600);
    storeAuthToken(rotated);
    return new Response(JSON.stringify({ user: { id: 1, username: 'tester' } }), {
      headers: { 'X-Refreshed-Token': rotated },
    });
  });
  const view = await mount();
  expect(view.container.textContent).toBe('tester:token');
});
