<script lang="ts">
  import {
    MODULE_CONNECTIONS,
    CONNECTION_KINDS,
    BUSINESS_JOURNEYS,
    CONNECTION_GLOSSARY,
  } from '$lib/help/connections';
  import { normalizeKnowledgeSearch } from '$lib/help/knowledge';
  import type { NavDomain } from '$lib/modules/navigation';
  import { Badge } from '$lib/components/ui';
  let {
    module = undefined,
    domains,
    search = '',
  }: { module?: string; domains: NavDomain[]; search?: string } = $props();
  const visible = $derived(new Set(domains.map((d) => d.key)));
  const connections = $derived(
    MODULE_CONNECTIONS.filter(
      (c) =>
        (module
          ? c.from === module || c.to === module
          : visible.has(c.from) || visible.has(c.to)) &&
        normalizeKnowledgeSearch(search)
          .trim()
          .split(/\s+/)
          .every((term) => normalizeKnowledgeSearch(Object.values(c).join(' ')).includes(term)),
    ),
  );
  const journeys = $derived(
    BUSINESS_JOURNEYS.filter((j) =>
      module ? j.modules.includes(module) : j.modules.some((m) => visible.has(m)),
    ),
  );
  const label = (key: string) =>
    domains.find((d) => d.key === key)?.label ??
    (
      {
        catalog: 'Catalogue',
        services: 'Services',
        support: 'SAV',
        wms: 'Entrepôt',
        purchasing: 'Achats fournisseurs',
        transport: 'Transport',
        billing: 'Facturation',
        yard: 'Cour et quais',
        manufacturing: 'Fabrication',
        fleet: 'Flotte',
        crm: 'CRM',
        sites: 'Sites',
        agents: 'Agents',
        analytics: 'Analytique',
        connect: 'Connexions',
        emails: 'Courriels',
        documents: 'Documents',
        procurement: 'Achats transport',
        settings: 'Accès et réglages',
        personalize: 'Personnalisation',
        dashboard: 'Bureau',
        documentation: 'Documentation',
        'customer-portal': 'Portail client',
      } as Record<string, string>
    )[key] ??
    key;
</script>

<section aria-label="Liens entre modules" class="space-y-5">
  <div>
    <h3 class="text-xl font-semibold tracking-tight">Liens entre modules</h3>
    <p class="mt-2 max-w-prose text-sm leading-7 text-ink-muted">
      Une connexion ne veut pas toujours dire automatisation. Ces fiches expliquent les effets
      réellement disponibles dans cette version. Elles ne surveillent pas l’état de vos connecteurs
      en temps réel.
    </p>
  </div>
  {#if !module}<dl
      class="grid gap-x-6 gap-y-3 rounded-md bg-surface-muted p-4 sm:grid-cols-2 text-sm"
    >
      {#each Object.entries(CONNECTION_KINDS) as [key, value]}<div>
          <dt class="font-medium">{value}</dt>
          <dd class="mt-1 text-ink-muted">
            {key === 'reference'
              ? 'Une fiche est réutilisée sans recopier tout le dossier.'
              : key === 'operation'
                ? 'Une action explicite peut modifier le module lié.'
                : key === 'context'
                  ? 'Le lien explique le dossier, sans changer son état.'
                  : key === 'configured'
                    ? 'Nécessite configuration et vérification du résultat.'
                    : 'Limite actuelle; ne comptez pas sur cet échange.'}
          </dd>
        </div>{/each}
    </dl>{/if}
  <nav aria-label="Sommaire des connexions" class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
    {#each connections as c}<a
        class="text-accent underline underline-offset-4"
        href={`#connection-${c.id}`}>{c.title}</a
      >{/each}
  </nav>
  {#if !connections.length}<p class="text-sm text-ink-muted">
      Aucune fiche de connexion pour ces critères. Les règles d’accès et le rôle de cette
      application restent décrits dans son guide.
    </p>{/if}
  {#each connections as c}<section
      id={`connection-${c.id}`}
      class="scroll-mt-6 rounded-lg border border-edge p-4 sm:p-5"
      aria-label={c.title}
    >
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {#each [c.from, c.to] as key, i}{#if i}<span aria-hidden="true">↔</span
              >{/if}{#if visible.has(key)}<a
                class="text-accent underline underline-offset-4"
                href={`/documentation?module=${key}`}>{label(key)}</a
              >{:else}<span>{label(key)} · accès non disponible</span>{/if}{/each}
        </div>
        <Badge tone={c.kind === 'planned' ? 'warn' : 'neutral'}>{CONNECTION_KINDS[c.kind]}</Badge>
      </div>
      <h4 class="font-semibold">{c.title}</h4>
      <dl class="mt-4 space-y-4 text-sm leading-6">
        {#each [['Qui conserve les données ?', c.owner], ['Avant de commencer', c.requires], ['Ce qui déclenche le lien', c.trigger], ['Données transmises ou partagées', c.data], ['Effet réel', c.effect], ['Ce qui ne se fait pas automatiquement', c.noEffect], ['En cas d’erreur ou de correction', c.recovery]] as [term, description]}<div
          >
            <dt class="font-medium">{term}</dt>
            <dd class="mt-1 max-w-prose text-ink-muted">{description}</dd>
          </div>{/each}
      </dl>
    </section>{/each}
  {#if journeys.length}<section class="space-y-5" aria-label="Parcours entre modules">
      <h3 class="text-lg font-semibold">Parcours de bout en bout</h3>
      {#each journeys as journey}<div class="rounded-lg bg-surface-muted p-5">
          <h4 class="font-semibold">{journey.title}</h4>
          <ol class="mt-4 space-y-4 border-l border-edge pl-5 text-sm leading-6">
            {#each journey.steps as [where, action], i}<li>
                <p class="font-medium">{i + 1}. {where}</p>
                <p class="max-w-prose text-ink-muted">{action}</p>
              </li>{/each}
          </ol>
        </div>{/each}
    </section>{/if}
  {#if !module}<section aria-label="Vocabulaire métier">
      <h3 class="text-lg font-semibold">Comprendre les termes</h3>
      <dl class="mt-4 divide-y divide-edge text-sm leading-6">
        {#each CONNECTION_GLOSSARY as [term, definition]}<div class="py-3">
            <dt class="font-medium">{term}</dt>
            <dd class="mt-1 max-w-prose text-ink-muted">{definition}</dd>
          </div>{/each}
      </dl>
    </section>
    <section class="rounded-lg border border-edge p-5 text-sm leading-7">
      <h3 class="text-lg font-semibold">Pourquoi une connexion ne semble pas fonctionner ?</h3>
      <ol class="mt-3 list-decimal space-y-2 pl-5">
        <li>
          Vérifier les modules activés et les permissions de chaque côté. Une affectation ne donne
          pas de droits; reconnectez-vous après un changement de rôle.
        </li>
        <li>
          Vérifier le type de lien ci-dessus. Un lien de contexte ne lance aucune opération; une
          connexion prévue n’existe pas encore.
        </li>
        <li>
          Contrôler les identifiants, l’unité, le site, les fiches actives et le statut du dossier.
          Le nom seul ne prouve pas la correspondance.
        </li>
        <li>
          Lire le message d’erreur. Un conflit de version impose de recharger puis de revoir la
          décision, pas de forcer l’enregistrement.
        </li>
        <li>
          Après une réponse perdue, inspecter l’historique ou reprendre l’opération conservée si
          l’écran le propose. Ne pas créer une deuxième demande à l’aveugle.
        </li>
      </ol>
    </section>
  {/if}
</section>
