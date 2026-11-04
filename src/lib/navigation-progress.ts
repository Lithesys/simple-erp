export const APP_NAVIGATION_START_EVENT = "app:navigation-start";

export function announceAppNavigationStart() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(APP_NAVIGATION_START_EVENT));
  }
}
