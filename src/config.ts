// Public build-time configuration. The publishable key is designed to be public;
// data protection is enforced by Supabase Auth + RLS, not by hiding this file.
export const config = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '',
  username: (import.meta.env.VITE_APP_USERNAME as string | undefined) || 'shoura',
  emailDomain: (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) || 'users.car-calc.invalid',
  appVersion: '1.0.0',
};
