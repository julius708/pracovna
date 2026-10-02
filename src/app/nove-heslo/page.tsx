import { NewPasswordForm } from '@/ui/NewPasswordForm';

export const dynamic = 'force-dynamic';

/** Target of password-recovery links: sets a new password for the recovery session. */
export default function NewPasswordPage() {
  return <NewPasswordForm />;
}
