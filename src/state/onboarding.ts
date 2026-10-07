import { DEFAULT_SETTINGS, type Mode, type Settings } from '../shared/types';

export interface OnboardingState {
  version: 1;
  presented: boolean;
  completed: boolean;
}
export interface OnboardingChoices {
  mode: Mode;
  sites: Settings['sites'];
}
export function parseOnboarding(value: unknown): OnboardingState {
  const input =
    value && typeof value === 'object'
      ? (value as Partial<OnboardingState>)
      : {};
  return {
    version: 1,
    presented: input.presented === true,
    completed: input.completed === true,
  };
}
export function shouldOpenOnboarding(
  reason: string,
  state: OnboardingState,
): boolean {
  return reason === 'install' && !state.presented && !state.completed;
}
export function validChoices(value: unknown): value is OnboardingChoices {
  if (!value || typeof value !== 'object') return false;
  const choices = value as OnboardingChoices;
  return (
    ['normal', 'goggles', 'blocker', 'only'].includes(choices.mode) &&
    !!choices.sites &&
    typeof choices.sites === 'object' &&
    Object.keys(DEFAULT_SETTINGS.sites).every(
      (site) =>
        Object.hasOwn(choices.sites, site) &&
        typeof choices.sites[site as keyof Settings['sites']] === 'boolean',
    ) &&
    Object.keys(choices).every((key) => ['mode', 'sites'].includes(key)) &&
    Object.keys(choices.sites).every((key) =>
      Object.hasOwn(DEFAULT_SETTINGS.sites, key),
    )
  );
}
export function applyChoices(
  settings: Settings,
  choices: OnboardingChoices,
): Settings {
  return { ...settings, mode: choices.mode, sites: { ...choices.sites } };
}
