// Pure, browser-safe. No Node imports.
//
// Builds the prompt handed to an always-on agent when the Workbench dispatcher
// wakes it on an OperationalTask (phase 13). The dispatcher only knew the task
// id before, so the agent had to discover everything itself and tended to stop
// at analysis. Here we hand it the task context + the category playbook + an
// explicit, autonomy-aware directive so it actually acts and (when allowed)
// closes the task.
import { getPlaybook } from './playbooks';

export interface WakeTaskContext {
  id: string;
  category: string;
  title: string | null;
  description: string | null;
  severity: string | null;
  subjectType: string | null;
  subjectId: string | null;
  slaDueAt: string | null;
}

/** Mirrors the prisma `AgentAutonomy` enum (kept as a string union to stay browser-safe). */
export type WakeAutonomy = 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';

/** True when the agent's autonomy lets it execute + close the task itself (vs. propose-only). */
export function canSelfResolve(autonomy: WakeAutonomy): boolean {
  return autonomy === 'ACT_LOW' || autonomy === 'AUTONOMOUS';
}

export function buildWakePrompt(task: WakeTaskContext, autonomy: WakeAutonomy): string {
  const playbook = getPlaybook(task.category);
  const lines: string[] = [];

  lines.push(`Tu es réveillé pour traiter une tâche opérationnelle (id ${task.id}).`);
  lines.push('');
  lines.push('Situation :');
  lines.push(`  - Catégorie : ${task.category}`);
  if (task.title) lines.push(`  - Titre : ${task.title}`);
  if (task.description) lines.push(`  - Détails : ${task.description}`);
  if (task.severity) lines.push(`  - Sévérité : ${task.severity}`);
  if (task.subjectType && task.subjectId) {
    lines.push(`  - Sujet concerné : ${task.subjectType} ${task.subjectId}`);
  }
  if (task.slaDueAt) lines.push(`  - Échéance SLA : ${task.slaDueAt}`);

  lines.push('');
  lines.push('Procédure recommandée (playbook) :');
  for (const step of playbook.checklist) lines.push(`  - ${step}`);

  lines.push('');
  lines.push(
    "Utilise tes outils Pulsar pour investiguer le sujet, puis traite la situation. " +
      "N'invente jamais d'identifiants : récupère-les via tes outils de lecture.",
  );

  if (canSelfResolve(autonomy)) {
    lines.push(
      "Exécute les actions correctives appropriées via tes outils (elles restent " +
        "soumises aux plafonds de gouvernance). Une fois la situation traitée, appelle " +
        `\`resolve_task\` (id ${task.id}) avec une note résumant ce que tu as fait. ` +
        "Si aucune action n'est nécessaire ou possible, explique pourquoi sans clôturer la tâche.",
    );
  } else {
    lines.push(
      "Propose les actions correctives appropriées (elles seront mises en file pour " +
        "validation humaine). Ne clôture PAS la tâche toi-même : un humain la fermera " +
        "après revue. Termine par un bref résumé de ce que tu proposes.",
    );
  }

  return lines.join('\n');
}
