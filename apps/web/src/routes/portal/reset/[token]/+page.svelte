<script lang="ts">
  import { page } from '$app/state';
  import SetPasswordForm from '../../SetPasswordForm.svelte';

  const token = $derived(page.params.token ?? '');
</script>

<SetPasswordForm
  {token}
  title="Nouveau mot de passe"
  subtitle="Choisissez un nouveau mot de passe pour votre compte portail."
  successMessage="Mot de passe enregistré — vous pouvez maintenant vous connecter."
  submitLabel="Enregistrer le mot de passe"
/>
