<script lang="ts">
  import { PARTY_ACCESS, PARTY_PROFILE_FIELDS, type PartyProfile } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Modal, Button, ErrorNotice, Skeleton } from '$lib/components/ui';
  import PartyIdentity from './PartyIdentity.svelte';
  import PartyWorkspace from './PartyWorkspace.svelte';
  import CommunicationButton from '$lib/components/communications/CommunicationButton.svelte';
  let { endpoint, name }: { endpoint: string; name: string } = $props();
  const access = $derived(PARTY_ACCESS.find((a) => endpoint.startsWith(`/${a.path}/`)));
  const canManage = $derived(!!access && !!$auth?.user.permissions.includes(access.manage));
  let open = $state(false),
    workspaceOpen = $state(false),
    tab = $state('profile'),
    loading = $state(false),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false),
    saved = $state(false);
  let values = $state<PartyProfile>({}),
    version = $state<number | null>(null);
  const sections = [...new Set(PARTY_PROFILE_FIELDS.map((f) => f.section))];
  async function load() {
    loading = true;
    version = null;
    error = '';
    saved = false;
    try {
      const r = await api<{ data: PartyProfile; version: number }>(`${endpoint}/business-profile`);
      values = r.data;
      version = r.version;
      uncertain = false;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  async function show() {
    open = true;
    tab = 'profile';
    await load();
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || uncertain || version === null) return;
    busy = true;
    error = '';
    saved = false;
    try {
      const r = await api<{ data: PartyProfile; version: number }>(`${endpoint}/business-profile`, {
        method: 'PUT',
        body: { expectedVersion: version, data: values },
      });
      values = r.data;
      version = r.version;
      saved = true;
    } catch (e) {
      error = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
    } finally {
      busy = false;
    }
  }
</script>

<span data-tour="party-workspace"
  ><Button
    variant="secondary"
    aria-label={`Dossier 360° de ${name}`}
    onclick={() => {
      workspaceOpen = true;
    }}>Dossier 360°</Button
  ></span
>
{#if access}<CommunicationButton
    access={access.path}
    entityId={endpoint.slice(access.path.length + 2)}
  />{/if}
<Modal bind:open={workspaceOpen} title={`Dossier 360° · ${name}`} size="xl">
  {#if workspaceOpen}<PartyWorkspace
      {endpoint}
      onopen={() => {
        workspaceOpen = false;
      }}
    />{/if}
</Modal>
<Button variant="secondary" aria-label={`Fiche entreprise de ${name}`} onclick={show}
  >Fiche entreprise</Button
>
<Modal bind:open title={`Fiche entreprise · ${name}`} size="xl" dismissible={!busy}>
  <div class="mb-5 flex flex-wrap gap-2" aria-label="Sections du dossier">
    <Button
      variant={tab === 'profile' ? 'primary' : 'secondary'}
      disabled={busy}
      onclick={() => {
        tab = 'profile';
      }}>Informations</Button
    >
    <Button
      variant={tab === 'identity' ? 'primary' : 'secondary'}
      disabled={busy}
      onclick={() => {
        tab = 'identity';
      }}>Rapprochement</Button
    >
  </div>
  {#if tab === 'identity'}<PartyIdentity {endpoint} />{:else}
    <p class="mb-4 text-sm text-ink-muted">
      Informations internes partagées par les modules utilisant cette fiche. Elles ne sont ni
      publiées au portail ni copiées dans les documents. Elles ne remplacent pas les coordonnées du
      carnet ou les règles métier.
    </p>
    {#if loading}<Skeleton rows={5} />{:else if version !== null}
      <form onsubmit={save} class="space-y-5">
        {#each sections as section}<fieldset class="rounded-lg border border-edge p-4">
            <legend class="px-2 text-sm font-semibold">{section}</legend>
            <div class="grid min-w-0 gap-4 sm:grid-cols-2">
              {#each PARTY_PROFILE_FIELDS.filter((f) => f.section === section) as field}
                <label
                  class={`grid min-w-0 gap-1 text-sm ${'type' in field && field.type === 'textarea' ? 'sm:col-span-2' : ''}`}
                  ><span>{field.label}</span>
                  {#if 'type' in field && field.type === 'textarea'}<textarea
                      class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2"
                      rows={3}
                      maxlength={field.max}
                      bind:value={values[field.key]}
                      disabled={!canManage || busy || uncertain}
                    ></textarea>
                  {:else}<input
                      class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2"
                      type={field.key === 'website' ? 'url' : 'text'}
                      maxlength={field.max}
                      bind:value={values[field.key]}
                      placeholder={field.key === 'timeZone' ? 'America/Toronto' : ''}
                      disabled={!canManage || busy || uncertain}
                    />{/if}
                </label>
              {/each}
            </div>
          </fieldset>{/each}
        <fieldset class="space-y-3 rounded-lg border border-edge p-4">
          <legend class="px-2 text-sm font-semibold">Informations propres à votre entreprise</legend
          >
          <p class="text-xs text-ink-muted">
            Jusqu’à 20 renseignements nommés. Texte informatif uniquement : pas de mots de passe,
            données bancaires, données de santé ou décisions automatiques.
          </p>
          {#each values.additional ?? [] as row, index}<div
              class="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
            >
              <input
                class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2 text-sm"
                aria-label={`Libellé complémentaire ${index + 1}`}
                maxlength={100}
                required
                bind:value={row.label}
                disabled={!canManage || busy || uncertain}
              /><textarea
                class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2 text-sm"
                aria-label={`Valeur complémentaire ${index + 1}`}
                maxlength={2000}
                bind:value={row.value}
                disabled={!canManage || busy || uncertain}
              ></textarea>{#if canManage}<Button
                  variant="ghost"
                  disabled={busy || uncertain}
                  aria-label={`Retirer l’information ${index + 1}`}
                  onclick={() => {
                    values.additional = values.additional?.filter((_, i) => i !== index);
                    saved = false;
                  }}>Retirer</Button
                >{/if}
            </div>{/each}
          {#if canManage}<Button
              variant="secondary"
              disabled={busy || uncertain || (values.additional?.length ?? 0) >= 20}
              onclick={() => {
                values.additional = [...(values.additional ?? []), { label: '', value: '' }];
                saved = false;
              }}>Ajouter une information</Button
            >{/if}
        </fieldset>
        <p class="text-xs text-ink-muted">
          Les consignes ne bloquent aucune opération. Le fuseau indiqué ne change pas votre fuseau
          utilisateur; le responsable est un repère, pas une affectation ou une permission. Version {version}.
        </p>
        {#if saved}<p role="status" class="text-sm text-ok">Fiche enregistrée.</p>{/if}
        {#if canManage}<Button type="submit" disabled={busy || uncertain}
            >{busy ? 'Enregistrement…' : 'Enregistrer les informations'}</Button
          >{/if}
      </form>
    {/if}
    <ErrorNotice message={error} />
    {#if uncertain}<p role="alert" class="mt-3 text-sm text-warn">
        Enregistrement incertain ou fiche modifiée ailleurs. Relisez la version enregistrée avant de
        poursuivre. La relecture remplace votre saisie.
      </p>{/if}
    {#if error}<Button variant="secondary" disabled={busy || loading} onclick={load}
        >Relire la fiche enregistrée</Button
      >{/if}
  {/if}
</Modal>
