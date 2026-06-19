<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { PageHeader, Button, Badge, Card, Skeleton } from '$lib/components/ui';

  interface OnboardingStep {
    key: string;
    label: string;
    description: string;
    done: boolean;
    detail?: string;
    href: string;
  }

  interface OnboardingStatus {
    steps: OnboardingStep[];
    completed: number;
    total: number;
    percent: number;
  }

  let status = $state<OnboardingStatus | null>(null);
  let error = $state('');
  let loading = $state(true);

  async function load() {
    try {
      status = await api<OnboardingStatus>('/onboarding/status');
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec du chargement de l'onboarding";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Onboarding"
  subtitle="Configurez votre plateforme étape par étape pour démarrer vos opérations."
/>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <div class="space-y-3">
    <Card><Skeleton rows={2} /></Card>
    {#each Array(4) as _, i (i)}
      <Card padded={false}><Skeleton rows={2} /></Card>
    {/each}
  </div>
{:else if status}
  <!-- Progression -->
  <Card>
    <div class="mb-2 flex items-baseline justify-between gap-3">
      <span class="text-sm font-semibold text-ink">Progression</span>
      <span class="text-sm tabular-nums text-ink-muted">
        {status.completed}/{status.total} étapes complétées
      </span>
    </div>
    <div class="flex items-center gap-3">
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-edge">
        <div
          class={`h-full rounded-full ${status.percent >= 100 ? 'bg-ok' : 'bg-accent'}`}
          style={`width: ${status.percent}%`}
        ></div>
      </div>
      <span class="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-ink"
        >{status.percent}%</span
      >
    </div>
  </Card>

  <!-- Étapes -->
  <div class="mt-3 space-y-3">
    {#each status.steps as step (step.key)}
      <div class={step.done ? 'opacity-70' : ''}>
        <Card>
          <div class="flex items-start gap-3">
            <!-- Indicateur d'état -->
            {#if step.done}
              <span
                class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  class="size-3.5"
                >
                  <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            {:else}
              <span
                class="mt-0.5 size-6 shrink-0 rounded-full border-2 border-edge"
                aria-hidden="true"
              ></span>
            {/if}

            <!-- Contenu -->
            <div class="min-w-0 flex-1">
              <div class="mb-0.5 flex items-center gap-2">
                <span class="font-semibold text-ink">{step.label}</span>
                {#if step.done}
                  <Badge tone="ok">Terminé</Badge>
                {:else}
                  <Badge tone="warn">À faire</Badge>
                {/if}
              </div>
              <p class="text-sm text-ink-muted">{step.description}</p>
              {#if step.detail}
                <p class="mt-1 text-xs text-ink-faint">{step.detail}</p>
              {/if}
            </div>

            <!-- Action -->
            <div class="shrink-0">
              <Button variant={step.done ? 'secondary' : 'primary'} href={step.href}>
                Configurer
              </Button>
            </div>
          </div>
        </Card>
      </div>
    {/each}
  </div>
{/if}
