import type { Prisma } from './generated/client'

type Modelos = readonly Prisma.ModelName[]

/** `business_id` obrigatório: todo acesso é filtrado pela conta. */
export const TENANT_MODELS: Modelos = [
  'Membership',
  'BusinessBranding',
  'BusinessModules',
  'BusinessSettings',
  'Customer',
  'Professional',
  'Service',
  'ProfessionalService',
  'WorkingHours',
  'TimeBlock',
  'BusinessClosure',
  'Appointment',
  'AppointmentItem',
  'Notification',
  'LoyaltyTransaction',
  'Prize',
  'PrizeRedemption',
  'Banner',
  'StoreSettings',
  'ProductCategory',
  'Product',
  'ProductImage',
  'Address',
  'Order',
  'OrderItem',
  'Payment',
]

/**
 * `business_id` anulável. Dentro de `tenantDb` valem as mesmas regras dos modelos tenant;
 * linhas com `business_id` nulo (da plataforma) não são visíveis nem alteráveis.
 */
export const TENANT_OPTIONAL_MODELS: Modelos = ['Upload', 'AuditLog']

/** O próprio registro da conta: dentro de `tenantDb` só existe `id = conta`. */
export const SELF_MODELS: Modelos = ['Business']

/** Sem dono de conta ou entre contas: qualquer acesso por `tenantDb` é recusado. */
export const PLATFORM_MODELS: Modelos = [
  'PlatformAdmin',
  'PlatformSession',
  'SupportHandoff',
  'SchedulerRun',
  'BusinessIntegration',
  'User',
  'Session',
  'UserToken',
  'RateLimitBucket',
  'EmailCode',
]
