<script lang="ts">
  import {
    DOCUMENT_COORDINATE_ROLES,
    DOCUMENT_COORDINATE_LABELS,
    directoryValidity,
    type DocumentCoordinates,
    type CoordinateCopy,
    type CoordinateIssue,
    type DocumentCoordinateRole,
    type Paginated,
  } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { Button, Badge, ErrorNotice, Skeleton, Input } from '$lib/components/ui';
  type View = {
    id: string;
    status: string;
    updatedAt: string;
    owner: { kind: DocumentCoordinates['owner']['kind']; id: string };
    captured: DocumentCoordinates | null;
    issues: CoordinateIssue[];
    identityIssue: string | null;
    referenceDate: string;
    timeZone: string;
    roles?: readonly DocumentCoordinateRole[];
    labels?: Record<DocumentCoordinateRole, string>;
  };
  let {
    endpoint,
    directoryBase,
    canManage,
    onchanged,
    documentVersion,
    busy = $bindable(false),
    blocked = $bindable(false),
    selectionOpen = $bindable(false),
  }: {
    endpoint: string;
    directoryBase: string;
    canManage: boolean;
    onchanged: () => Promise<void>;
    documentVersion?: string;
    busy?: boolean;
    blocked?: boolean;
    selectionOpen?: boolean;
  } = $props();
  let view = $state<View | null>(null),
    loading = $state(true),
    error = $state('');
  let editing = $state(false),
    uncertain = $state(false),
    reason = $state('');
  let entries = $state<Record<DocumentCoordinateRole, CoordinateCopy | null>>({
    billingAddress: null,
    deliveryAddress: null,
    contact: null,
  });
  let role = $state<DocumentCoordinateRole>('billingAddress'),
    search = $state(''),
    page = $state(1);
  let choices = $state<CoordinateCopy[]>([]),
    count = $state(0),
    choosing = $state(false),
    choiceError = $state('');
  let generation = 0;
  const roles = $derived(view?.roles ?? DOCUMENT_COORDINATE_ROLES);
  const labels = $derived(view?.labels ?? DOCUMENT_COORDINATE_LABELS);
  $effect(() => {
    selectionOpen = editing || uncertain;
    blocked =
      loading || editing || uncertain || !!error || !!view?.issues.length || !!view?.identityIssue;
  });
  const directory = $derived(view ? `${directoryBase}/${view.owner.id}/directory` : '');
  const address = (r: CoordinateCopy) =>
    r.data.address
      ? [
          r.data.address.line1,
          r.data.address.line2,
          r.data.address.city,
          r.data.address.region,
          r.data.address.postalCode,
          r.data.address.countryCode,
        ]
          .filter(Boolean)
          .join(', ')
      : [r.data.email, r.data.phone].filter(Boolean).join(' · ');
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<View>(endpoint);
      if (g !== generation) return;
      view = result;
      editing = false;
      uncertain = false;
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void endpoint;
    void documentVersion;
    void load();
  });
  $effect(() => {
    if (!editing || !directory) return;
    const path = directory,
      kind = role === 'contact' ? 'CONTACT' : 'ADDRESS',
      q = search,
      p = page;
    let stale = false;
    choosing = true;
    choiceError = '';
    const timer = setTimeout(() => {
      api<Paginated<CoordinateCopy>>(path, { query: { kind, search: q, page: p, pageSize: 10 } })
        .then((r) => {
          if (!stale) {
            choices = r.items;
            count = r.total;
          }
        })
        .catch((e) => {
          if (!stale) {
            choices = [];
            choiceError = e.message;
          }
        })
        .finally(() => {
          if (!stale) choosing = false;
        });
    }, 100);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });
  function edit() {
    if (!view || !canManage || busy) return;
    entries = structuredClone(
      $state.snapshot(
        view.captured?.entries ?? { billingAddress: null, deliveryAddress: null, contact: null },
      ),
    );
    reason = '';
    error = '';
    editing = true;
    role = 'billingAddress';
    search = '';
    page = 1;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!view || busy || uncertain || !canManage) return;
    busy = true;
    error = '';
    try {
      const selections = Object.fromEntries(
        DOCUMENT_COORDINATE_ROLES.map((r) => [
          r,
          entries[r] ? { id: entries[r]!.id, version: entries[r]!.version } : null,
        ]),
      );
      await api(endpoint, {
        method: 'PATCH',
        body: { expectedUpdatedAt: view.updatedAt, selections, reason: reason.trim() },
      });
      await onchanged();
      await load();
    } catch (e) {
      error = (e as Error).message;
      // No blind retry: reread the stored document before any new selection after failure.
      uncertain = true;
    } finally {
      busy = false;
    }
  }
</script>

<section class="my-4 rounded-lg border border-edge p-4" aria-label="Coordonnées du document">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="font-semibold">Coordonnées du document</h2>
    {#if view?.captured?.frozenAt}<Badge tone="ok">Copie figée</Badge>
    {:else if view?.status === 'DRAFT' && view.captured}<Badge
        tone={view.issues.length || view.identityIssue ? 'warn' : 'neutral'}
        >{view.issues.length || view.identityIssue ? 'À revoir' : 'Sélection enregistrée'}</Badge
      >{/if}
  </div>
  <p class="mt-2 text-xs leading-relaxed text-ink-muted">
    {#if view?.owner.kind === 'supplier'}
      Adresse et interlocuteur du fournisseur uniquement. L’entrepôt de réception et l’adresse de
      votre entreprise sont distincts; aucun lieu de stock ni destinataire courriel ne change.
    {:else}
      Choix du carnet pour ce document uniquement. Aucun changement de destinataire courriel, de
      droits portail ou de lieu opérationnel.
    {/if}
  </p>
  <ErrorNotice
    message={error}
    onretry={async () => {
      await onchanged();
      await load();
    }}
  />
  {#if loading}<Skeleton rows={2} />{:else if view}
    <ErrorNotice message={view.identityIssue ?? ''} />
    {#if !view.captured && !editing}<p class="my-3 text-sm text-ink-muted">
        Aucune coordonnée du carnet capturée. Les coordonnées principales du partenaire ne
        constituent pas une copie historique de ce document.
      </p>{/if}
    {#if view.captured && !editing}
      <p class="my-3 text-sm font-medium">
        {view.captured.owner.name}{view.captured.owner.code ? ` · ${view.captured.owner.code}` : ''}
      </p>
      <div class="space-y-3">
        {#each roles as r}
          {@const entry = view.captured.entries[r]}
          {#if entry}<div class="min-w-0 text-sm">
              <p class="text-xs text-ink-muted">{labels[r]}</p>
              <p class="font-medium">
                {entry.data.label}
                <span class="font-normal text-ink-muted">· v{entry.version}</span>
              </p>
              <p class="break-words">{address(entry)}</p>
            </div>{/if}
        {/each}
      </div>
      <p class="mt-3 text-xs text-ink-muted">
        {view.captured.frozenAt ? 'Figées le' : 'Choisies le'}
        {formatDateTime(view.captured.frozenAt ?? view.captured.selectedAt)}
      </p>
    {/if}
    {#if view.issues.length}<ul
        class="my-3 space-y-1 rounded-md bg-warn-soft p-3 text-sm"
        aria-label="Coordonnées à revoir"
      >
        {#each view.issues as issue}<li>
            {labels[issue.role]} : {issue.message}
          </li>{/each}
      </ul>{/if}
    {#if uncertain}<p class="my-3 text-sm">
        Rechargez le document pour vérifier ce qui a été enregistré avant toute nouvelle
        modification.
      </p>
      <Button
        variant="secondary"
        onclick={async () => {
          await onchanged();
          await load();
        }}>Vérifier le document enregistré</Button
      >
    {:else if editing}
      <form class="mt-4 space-y-4" onsubmit={save}>
        <fieldset disabled={busy} class="space-y-4">
          <div class="flex flex-wrap gap-2" aria-label="Usage de la coordonnée">
            {#each roles as r}<Button
                variant={role === r ? 'primary' : 'secondary'}
                onclick={() => {
                  role = r;
                  search = '';
                  page = 1;
                }}>{labels[r]}</Button
              >{/each}
          </div>
          <div class="rounded-md bg-surface-muted p-3 text-sm">
            {#if entries[role]}<p class="font-medium">
                Choix : {entries[role]!.data.label} · v{entries[role]!.version}
              </p>
              <p class="break-words">{address(entries[role]!)}</p>
              <Button
                variant="ghost"
                onclick={() => {
                  entries[role] = null;
                }}>Retirer ce choix</Button
              >
            {:else}<p>Aucun choix pour cet usage.</p>{/if}
          </div>
          <Input
            aria-label="Rechercher dans le carnet"
            placeholder="Nom du site ou du contact"
            bind:value={search}
            oninput={() => {
              page = 1;
            }}
          />
          <p class="text-xs text-ink-muted">
            Validité vérifiée au {view.referenceDate} ({view.timeZone}). Une version modifiée doit
            être choisie à nouveau.
          </p>
          <ErrorNotice message={choiceError} />
          {#if choosing}<Skeleton rows={2} />{:else if !choices.length}<p
              class="text-sm text-ink-muted"
            >
              Aucune entrée. Ajoutez une adresse ou un contact dans le carnet du partenaire, puis
              rouvrez cette sélection.
            </p>
          {:else}<div class="divide-y divide-edge">
              {#each choices as choice (choice.id)}{@const valid =
                  directoryValidity(choice.data, view.referenceDate) === 'ACTIVE'}
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{choice.data.label} · v{choice.version}</p>
                    <p class="break-words text-xs text-ink-muted">{address(choice)}</p>
                    {#if !valid}<p class="text-xs text-warn">Désactivée ou hors validité</p>{/if}
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!valid}
                    onclick={() => {
                      entries[role] = structuredClone($state.snapshot(choice));
                    }}>Choisir {choice.data.label}</Button
                  >
                </div>
              {/each}
            </div>{/if}
          <div class="flex justify-between gap-2">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onclick={() => {
                page--;
              }}>Précédent</Button
            ><span class="self-center text-xs">{count} entrées · page {page}</span><Button
              variant="ghost"
              disabled={page * 10 >= count}
              onclick={() => {
                page++;
              }}>Suivant</Button
            >
          </div>
          <label class="block text-sm"
            >Motif du choix / changement<Input
              bind:value={reason}
              required
              minlength={3}
              maxlength={500}
            /></label
          >
          <div class="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>Enregistrer les coordonnées</Button><Button
              variant="ghost"
              onclick={() => {
                editing = false;
              }}>Annuler les choix</Button
            >
          </div>
        </fieldset>
      </form>
    {:else if canManage && view.status === 'DRAFT'}<Button
        class="mt-3"
        variant="secondary"
        disabled={busy}
        onclick={edit}>Choisir / revoir les coordonnées</Button
      >{/if}
  {/if}
</section>
