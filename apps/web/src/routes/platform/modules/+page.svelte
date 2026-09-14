<script lang="ts">
  import { MODULE_CATALOG } from '@pulsar/shared';
  import { Table, Badge } from '$lib/components/ui';
</script>

<svelte:head><title>Catalogue | Pulsar</title></svelte:head>
<h1 class="text-2xl font-semibold tracking-tight">Catalogue des modules</h1>
<p class="mb-6 mt-2 max-w-2xl text-sm text-ink-muted">
  Catalogue de cette version. La disponibilité logicielle n’indique ni l’activation dans une
  entreprise, ni la connexion de ses services externes.
</p>
<Table
  >{#snippet head()}<th>Module</th><th>Clé technique</th><th>Disponibilité</th><th>Périmètre</th
    >{/snippet}
  {#snippet body()}{#each MODULE_CATALOG as module (module.key)}<tr
        ><td class="whitespace-nowrap font-medium">{module.name}</td><td class="font-mono text-xs"
          >{module.key}</td
        ><td
          ><Badge tone={module.available ? 'ok' : 'neutral'}
            >{module.available ? 'Disponible' : 'Prévu'}</Badge
          ></td
        ><td class="min-w-64 text-xs leading-5 text-ink-muted">{module.description}</td></tr
      >{/each}{/snippet}</Table
>
