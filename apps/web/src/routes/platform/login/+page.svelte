<script lang="ts">
  import { goto } from '$app/navigation';
  import { platformApi, PlatformApiError, setPlatformToken } from '$lib/api/platform';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Field, Input } from '$lib/components/ui';

  type LoginResponse =
    | { accessToken: string; user: unknown }
    | { mfaRequired: true; mfaToken: string }
    | { mfaEnrollmentRequired: true; enrollToken: string; otpauthUrl: string };

  let step = $state<'credentials' | 'mfa' | 'enroll' | 'recovery-codes'>('credentials');

  // Credentials step
  let email = $state('');
  let password = $state('');

  // MFA step
  let mfaToken = $state('');
  let code = $state('');

  // Enroll step
  let enrollToken = $state('');
  let otpauthUrl = $state('');

  // Recovery codes step
  let recoveryCodes = $state<string[]>([]);
  let pendingAccessToken = $state('');

  let error = $state('');
  let loading = $state(false);

  function resetToCredentials() {
    step = 'credentials';
    mfaToken = '';
    enrollToken = '';
    otpauthUrl = '';
    code = '';
    error = '';
    recoveryCodes = [];
    pendingAccessToken = '';
  }

  async function submitCredentials(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const result = await platformApi<LoginResponse>('/platform/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if ('mfaRequired' in result && result.mfaRequired) {
        mfaToken = result.mfaToken;
        code = '';
        step = 'mfa';
      } else if ('mfaEnrollmentRequired' in result && result.mfaEnrollmentRequired) {
        enrollToken = result.enrollToken;
        otpauthUrl = result.otpauthUrl;
        code = '';
        step = 'enroll';
      } else if ('accessToken' in result) {
        setPlatformToken(result.accessToken);
        void goto('/platform/tenants');
      }
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function submitMfa(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const result = await platformApi<{ accessToken: string; user: unknown }>(
        '/platform/auth/mfa/verify',
        { method: 'POST', body: { mfaToken, code } },
      );
      setPlatformToken(result.accessToken);
      void goto('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Verification failed';
    } finally {
      loading = false;
    }
  }

  async function submitEnroll(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const result = await platformApi<{ recoveryCodes: string[]; accessToken: string }>(
        '/platform/auth/mfa/enroll',
        { method: 'POST', body: { enrollToken, code } },
      );
      recoveryCodes = result.recoveryCodes;
      pendingAccessToken = result.accessToken;
      step = 'recovery-codes';
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Enrollment failed';
    } finally {
      loading = false;
    }
  }

  function continueAfterRecoveryCodes() {
    setPlatformToken(pendingAccessToken);
    void goto('/platform/tenants');
  }

  function getTotpSecret(): string {
    try {
      return new URL(otpauthUrl).searchParams.get('secret') ?? otpauthUrl;
    } catch {
      return otpauthUrl;
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore — user can copy manually
    }
  }
</script>

<PublicShell title="Platform sign-in">
  <div class="mb-4 flex justify-start">
    <Badge tone="danger">Platform admin</Badge>
  </div>

  {#if step === 'credentials'}
    <form onsubmit={submitCredentials} class="space-y-4">
      <Field label="Email">
        <Input type="email" bind:value={email} required placeholder="admin@example.com" />
      </Field>

      <Field label="Password">
        <Input type="password" bind:value={password} required placeholder="••••••••" />
      </Field>

      {#if error}
        <p class="text-sm text-danger">{error}</p>
      {/if}

      <Button type="submit" variant="primary" {loading} disabled={loading}>
        Sign in
      </Button>
    </form>

  {:else if step === 'mfa'}
    <p class="mb-4 text-sm text-ink-muted">
      Two-factor authentication is enabled on your account.
    </p>
    <form onsubmit={submitMfa} class="space-y-4">
      <Field label="Authentication code">
        <input
          type="text"
          bind:value={code}
          required
          autocomplete="one-time-code"
          minlength={6}
          maxlength={10}
          placeholder="000000"
          class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
        <p class="mt-1 text-xs text-ink-muted">
          Enter the 6-digit code from your authenticator, or one of your recovery codes.
        </p>
      </Field>

      {#if error}
        <p class="text-sm text-danger">{error}</p>
      {/if}

      <div class="flex gap-2">
        <Button type="submit" variant="primary" {loading} disabled={loading}>
          Verify
        </Button>
        <Button type="button" variant="ghost" onclick={resetToCredentials}>
          Back to sign in
        </Button>
      </div>
    </form>

  {:else if step === 'enroll'}
    <p class="mb-4 text-sm text-ink-muted">
      Multi-factor authentication is required for platform access. Set up your authenticator app using the secret below.
    </p>
    <div class="mb-4 space-y-2">
      <p class="text-xs font-semibold text-ink-muted uppercase tracking-wide">TOTP Secret</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 break-all rounded-md border border-edge bg-surface-muted px-3 py-2 text-sm font-mono text-ink">
          {getTotpSecret()}
        </code>
        <Button type="button" variant="secondary" onclick={() => copyText(getTotpSecret())}>
          Copy
        </Button>
      </div>
      <p class="text-xs font-semibold text-ink-muted uppercase tracking-wide mt-3">Full URI (for QR scan apps)</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 break-all rounded-md border border-edge bg-surface-muted px-3 py-2 text-xs font-mono text-ink-muted">
          {otpauthUrl}
        </code>
        <Button type="button" variant="secondary" onclick={() => copyText(otpauthUrl)}>
          Copy
        </Button>
      </div>
    </div>
    <form onsubmit={submitEnroll} class="space-y-4">
      <Field label="Confirmation code">
        <input
          type="text"
          bind:value={code}
          required
          autocomplete="one-time-code"
          minlength={6}
          maxlength={10}
          placeholder="000000"
          class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
      </Field>

      {#if error}
        <p class="text-sm text-danger">{error}</p>
      {/if}

      <div class="flex gap-2">
        <Button type="submit" variant="primary" {loading} disabled={loading}>
          Confirm enrollment
        </Button>
        <Button type="button" variant="ghost" onclick={resetToCredentials}>
          Back to sign in
        </Button>
      </div>
    </form>

  {:else if step === 'recovery-codes'}
    <div class="mb-4 rounded-card border border-warn bg-warn-soft p-3 text-sm text-warn font-semibold">
      Store these recovery codes now — they are shown only once.
    </div>
    <ul class="mb-4 space-y-1 rounded-md border border-edge bg-surface-muted p-3">
      {#each recoveryCodes as rc (rc)}
        <li class="font-mono text-sm text-ink">{rc}</li>
      {/each}
    </ul>
    <div class="mb-4">
      <Button
        type="button"
        variant="secondary"
        onclick={() => copyText(recoveryCodes.join('\n'))}
      >
        Copy all
      </Button>
    </div>
    <Button type="button" variant="primary" onclick={continueAfterRecoveryCodes}>
      Continue
    </Button>
  {/if}
</PublicShell>
