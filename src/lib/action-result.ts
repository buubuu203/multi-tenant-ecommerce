// Shared by any Server Action across Platform Admin and Tenant Admin so
// both areas' mutations and the generic ActionForm component agree on one
// result shape, without either admin area depending on the other's code.
export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };
