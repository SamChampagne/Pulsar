<script lang="ts">
  import {
    Bot,
    Box,
    Code2,
    Database,
    Globe2,
    Mail,
    MonitorCog,
    Plug,
    Printer,
    Settings,
    ShieldCheck,
    Users,
    Workflow,
  } from 'lucide-svelte';
  import type { ComponentType } from 'svelte';

  interface FrameworkTile {
    label: string;
    href: string;
    icon: ComponentType;
    description: string;
    status?: 'ready' | 'planned';
  }

  const workspaces: FrameworkTile[] = [
    {
      label: 'Automation',
      href: '/workbench',
      icon: Workflow,
      description: 'Automatisations, tâches opératoires et futures règles métier.',
      status: 'ready',
    },
    {
      label: 'Build',
      href: '/framework',
      icon: Box,
      description: 'Futur studio pour créer apps, doctypes, pages et workflows Pulsar.',
      status: 'planned',
    },
    {
      label: 'Données',
      href: '/settings/modules',
      icon: Database,
      description: 'Modules, objets partagés, schéma et seed/config tenant.',
      status: 'ready',
    },
    {
      label: 'Courriel',
      href: '/settings/appearance',
      icon: Mail,
      description: 'Emails, notifications et templates transactionnels.',
      status: 'planned',
    },
    {
      label: 'Intégrations',
      href: '/connect',
      icon: Plug,
      description: 'Connecteurs, API keys, webhooks, MCP tools et systèmes externes.',
      status: 'ready',
    },
    {
      label: 'Printing',
      href: '/framework',
      icon: Printer,
      description: 'PDF, documents, bons, rapports imprimables et templates.',
      status: 'planned',
    },
    {
      label: 'Système',
      href: '/settings/modules',
      icon: MonitorCog,
      description: 'Tenant, runtime, modules, préférences et santé plateforme.',
      status: 'ready',
    },
    {
      label: 'Utilisateurs',
      href: '/settings/users',
      icon: Users,
      description: 'Utilisateurs, rôles, permissions, SSO et accès.',
      status: 'ready',
    },
    {
      label: 'Website',
      href: '/framework',
      icon: Globe2,
      description: 'Futur site/portal builder pour clients, drivers et self-service.',
      status: 'planned',
    },
    {
      label: 'Agents',
      href: '/agents',
      icon: Bot,
      description: 'Employés IA gouvernés, proposed actions, audit et outils.',
      status: 'ready',
    },
    {
      label: 'Sécurité',
      href: '/settings/sso',
      icon: ShieldCheck,
      description: 'SSO, sessions, policies, audit et garde-fous.',
      status: 'ready',
    },
    {
      label: 'Développement',
      href: '/framework',
      icon: Code2,
      description: 'Roadmap Odoo-like: développer sur Pulsar avec modules installables.',
      status: 'planned',
    },
  ];
</script>

<svelte:head><title>Framework · Pulsar</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top,rgba(115,121,133,0.18),transparent_360px),#f8f8f7] px-4 py-10 text-ink sm:px-8">
  <div class="mx-auto max-w-4xl">
    <div class="mb-8 text-center">
      <a href="/apps" class="text-xs font-semibold tracking-[0.22em] text-ink-faint uppercase hover:text-ink">← Pulsar Desk</a>
      <h1 class="mt-5 text-2xl font-semibold tracking-tight text-ink">Framework</h1>
      <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-muted">
        Le coeur de Pulsar : système, utilisateurs, agents, intégrations et futur environnement de développement de modules.
      </p>
    </div>

    <div class="rounded-[32px] border border-edge-soft bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:p-9">
      <div class="grid grid-cols-3 gap-x-7 gap-y-9 sm:grid-cols-4">
        {#each workspaces as workspace (workspace.label)}
          {@const Icon = workspace.icon}
          <a href={workspace.href} class="group flex flex-col items-center text-center outline-none" title={workspace.description}>
            <span class="relative flex size-14 items-center justify-center rounded-2xl bg-[#737985] text-white shadow-sm transition duration-150 group-hover:-translate-y-1 group-hover:bg-[#636976] group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent">
              <Icon class="size-7" strokeWidth={2.05} />
              {#if workspace.status === 'planned'}
                <span class="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-amber-400"></span>
              {/if}
            </span>
            <span class="mt-3 text-sm font-semibold leading-tight text-ink group-hover:text-[#636976]">{workspace.label}</span>
            {#if workspace.status === 'planned'}
              <span class="mt-1 text-[11px] text-ink-faint">prévu</span>
            {/if}
          </a>
        {/each}
      </div>
    </div>

    <div class="mt-7 grid gap-3 sm:grid-cols-3">
      <div class="rounded-2xl border border-edge-soft bg-white/70 p-4">
        <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Rôle</p>
        <p class="mt-2 text-sm leading-6 text-ink-muted">Framework n’est pas un module métier : il porte la configuration, la gouvernance et les primitives de développement.</p>
      </div>
      <div class="rounded-2xl border border-edge-soft bg-white/70 p-4">
        <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Plus tard</p>
        <p class="mt-2 text-sm leading-6 text-ink-muted">Le workspace Build pourra devenir l’équivalent Odoo: créer des objets, vues, workflows et modules installables.</p>
      </div>
      <div class="rounded-2xl border border-edge-soft bg-white/70 p-4">
        <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Agents</p>
        <p class="mt-2 text-sm leading-6 text-ink-muted">Les agents restent dans le coeur parce qu’ils traversent tous les univers avec permissions, audit et approvals.</p>
      </div>
    </div>
  </div>
</section>
