<script lang="ts">
  import { page } from '$app/state';
  import SetPasswordForm from '../../SetPasswordForm.svelte';

  const token = $derived(page.params.token ?? '');
</script>

<SetPasswordForm
  {token}
  title="Activer votre compte"
  subtitle="Choisissez un mot de passe pour accéder au portail."
  successMessage="Compte activé — vous pouvez maintenant vous connecter."
  submitLabel="Activer mon compte"
/>
