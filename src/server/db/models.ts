/** Modelos com `business_id` obrigatório: todo acesso é filtrado pela conta. */
export const TENANT_MODELS: readonly string[] = [
  'Membership',
  'BusinessBranding',
  'BusinessModules',
  'BusinessSettings',
]

/** Modelos sem dono de conta, ou que atravessam contas. */
export const GLOBAL_MODELS: readonly string[] = [
  'PlatformAdmin',
  'PlatformSession',
  'Business',
  'User',
  'Session',
  'UserToken',
  'Upload',
  'AuditLog',
]
