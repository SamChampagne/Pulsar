/** Editorial documentation of implemented contracts; never a dynamic schema or an access grant. */
export interface FieldReference {
  key: string;
  label: string;
  purpose: string;
  type: string;
  required: string;
  validation: string;
  example: string;
  effect: string;
  limits: string;
  defaultValue?: string;
}
export interface ToolExample {
  title: string;
  prompt: string;
  tools: string[];
  result: string;
  guard: string;
  modules: string[];
  permissions: string[];
}
export interface FieldGuide {
  key: string;
  domain: string;
  title: string;
  summary: string;
  href: string;
  permissions: string[];
  /** Additional activated modules required by this documented cross-module screen. */
  modules?: string[];
  fields: FieldReference[];
  rules: string[];
  sources: string[];
  examples?: ToolExample[];
}
export interface FieldAccess {
  domains: string[];
  modules: string[];
  can: (permission: string) => boolean;
}
export const field = (
  key: string,
  label: string,
  type: string,
  required: string,
  purpose: string,
  validation: string,
  example: string,
  effect: string,
  limits: string,
  defaultValue?: string,
): FieldReference => ({
  key,
  label,
  type,
  required,
  purpose,
  validation,
  example,
  effect,
  limits,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
});
export const optional =
  'Facultatif dans le contrat API; votre processus peut demander plus de précision.';
export const dateFields = (prefix: string, label: string) => [
  field(
    `${prefix}Early`,
    `${label} · dès`,
    'Date et heure',
    optional,
    'Définir le début de la plage souhaitée.',
    'Date ISO côté API; vérifier le fuseau affiché et la cohérence des bornes.',
    '2 octobre, 08 h 30 dans le fuseau affiché.',
    'Alimente les fenêtres de planification.',
    'Ne constate pas une arrivée réelle et ne réserve ni camion ni quai.',
  ),
  field(
    `${prefix}Late`,
    `${label} · avant`,
    'Date et heure',
    optional,
    'Définir la fin de la plage souhaitée.',
    'Date ISO; une fin avant le début est incohérente. Les contrôles dépendent du processus concerné.',
    '2 octobre, 10 h 15 dans le fuseau affiché.',
    'Permet de repérer les arrivées prévues trop tardives.',
    'Ne garantit ni ponctualité ni acceptation du transporteur.',
  ),
];
