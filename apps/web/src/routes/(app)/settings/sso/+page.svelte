<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Badge,
    Card,
    Skeleton,
  } from '$lib/components/ui';

  interface OidcConfigView {
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecret: string;
    defaultRoleId: string;
  }
  interface RoleOption {
    id: string;
    name: string;
  }

  let config = $state<OidcConfigView>({
    enabled: false,
    issuer: '',
    clientId: '',
    clientSecret: '',
    defaultRoleId: '',
  });
  let roles = $state<RoleOption[]>([]);
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);

  async function load() {
    try {
      // GET /roles returns a plain array (not paginated)
      [config, roles] = await Promise.all([
        api<OidcConfigView>('/auth/oidc-config'),
        api<RoleOption[]>('/roles'),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la configuration SSO';
    } finally {
      loading = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    try {
      config = await api<OidcConfigView>('/auth/oidc-config', { method: 'PUT', body: config });
      toast.success('Configuration SSO enregistrée');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Authentification unique (OIDC)">
  {#snippet actions()}
    {#if !loading}
      {#if config.enabled}
        <Badge tone="ok">Activé</Badge>
      {:else}
        <Badge tone="neutral">Désactivé</Badge>
      {/if}
    {/if}
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Connectez un fournisseur OpenID Connect pour permettre à vos utilisateurs de se connecter avec
  le système d'identité de votre organisation.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  <form onsubmit={save} class="max-w-2xl space-y-4">
    <Card>
      <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" bind:checked={config.enabled} />
        Activer l'authentification unique pour cette organisation
      </label>
    </Card>

    <Card>
      <div class="space-y-4">
        <div>
          <h2 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Fournisseur</h2>
          <p class="mt-0.5 text-xs text-ink-faint">Coordonnées de connexion à votre fournisseur OIDC.</p>
        </div>
        <Field label="URL de l'émetteur (issuer)">
          <Input bind:value={config.issuer} placeholder="https://login.example.com" />
        </Field>
        <Field label="Identifiant client (client ID)">
          <Input bind:value={config.clientId} />
        </Field>
        <Field label="Secret client (client secret)">
          <Input
            bind:value={config.clientSecret}
            placeholder="*** (inchangé si laissé masqué)"
          />
        </Field>
      </div>
    </Card>

    <Card>
      <div class="space-y-4">
        <div>
          <h2 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Provisionnement
          </h2>
          <p class="mt-0.5 text-xs text-ink-faint">
            Rôle attribué automatiquement aux nouveaux utilisateurs provisionnés via SSO.
          </p>
        </div>
        <Field label="Rôle par défaut des utilisateurs provisionnés">
          <Select bind:value={config.defaultRoleId}>
            <option value="" disabled>Choisir un rôle…</option>
            {#each roles as role (role.id)}
              <option value={role.id}>{role.name}</option>
            {/each}
          </Select>
        </Field>
      </div>
    </Card>

    <div class="flex justify-end">
      <Button type="submit" loading={saving}>Enregistrer</Button>
    </div>
  </form>
{/if}
