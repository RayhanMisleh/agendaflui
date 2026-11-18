import type { AnyRouteDef } from './define-route'
import * as r00 from '@/app/api/v1/appointments/[id]/cancel/route'
import * as r01 from '@/app/api/v1/appointments/[id]/reschedule/route'
import * as r02 from '@/app/api/v1/appointments/[id]/route'
import * as r03 from '@/app/api/v1/appointments/next/route'
import * as r04 from '@/app/api/v1/appointments/route'
import * as r05 from '@/app/api/v1/auth/customer/login/route'
import * as r06 from '@/app/api/v1/auth/customer/logout/route'
import * as r07 from '@/app/api/v1/auth/customer/password/forgot/route'
import * as r08 from '@/app/api/v1/auth/customer/password/reset/route'
import * as r09 from '@/app/api/v1/auth/customer/refresh/route'
import * as r10 from '@/app/api/v1/auth/customer/register/route'
import * as r11 from '@/app/api/v1/auth/customer/verify/route'
import * as r12 from '@/app/api/v1/auth/staff/login/route'
import * as r13 from '@/app/api/v1/auth/staff/logout/route'
import * as r14 from '@/app/api/v1/auth/staff/refresh/route'
import * as r15 from '@/app/api/v1/availability/days/route'
import * as r16 from '@/app/api/v1/availability/route'
import * as r17 from '@/app/api/v1/banners/route'
import * as r18 from '@/app/api/v1/business/route'
import * as r19 from '@/app/api/v1/health/route'
import * as r20 from '@/app/api/v1/loyalty/me/route'
import * as r21 from '@/app/api/v1/loyalty/me/statement/route'
import * as r22 from '@/app/api/v1/loyalty/prizes/route'
import * as r23 from '@/app/api/v1/loyalty/ranking/route'
import * as r24 from '@/app/api/v1/loyalty/redemptions/[id]/cancel/route'
import * as r25 from '@/app/api/v1/loyalty/redemptions/route'
import * as r26 from '@/app/api/v1/me/addresses/[id]/route'
import * as r27 from '@/app/api/v1/me/addresses/route'
import * as r28 from '@/app/api/v1/me/delete/route'
import * as r29 from '@/app/api/v1/me/devices/[pushToken]/route'
import * as r30 from '@/app/api/v1/me/devices/route'
import * as r31 from '@/app/api/v1/me/notifications/route'
import * as r32 from '@/app/api/v1/me/password/route'
import * as r33 from '@/app/api/v1/me/route'
import * as r34 from '@/app/api/v1/openapi.json/route'
import * as r35 from '@/app/api/v1/professionals/route'
import * as r36 from '@/app/api/v1/services/route'
import * as r37 from '@/app/api/v1/staff/agenda/route'
import * as r38 from '@/app/api/v1/staff/appointments/[id]/adjust/route'
import * as r39 from '@/app/api/v1/staff/appointments/[id]/cancel/route'
import * as r40 from '@/app/api/v1/staff/appointments/[id]/complete/route'
import * as r41 from '@/app/api/v1/staff/appointments/[id]/confirm/route'
import * as r42 from '@/app/api/v1/staff/appointments/[id]/free-early/route'
import * as r43 from '@/app/api/v1/staff/appointments/[id]/no-show/route'
import * as r44 from '@/app/api/v1/staff/appointments/[id]/reschedule/route'
import * as r45 from '@/app/api/v1/staff/appointments/[id]/route'
import * as r46 from '@/app/api/v1/staff/appointments/[id]/undo/route'
import * as r47 from '@/app/api/v1/staff/appointments/route'
import * as r48 from '@/app/api/v1/staff/customers/[id]/appointments/route'
import * as r49 from '@/app/api/v1/staff/customers/[id]/route'
import * as r50 from '@/app/api/v1/staff/customers/route'
import * as r51 from '@/app/api/v1/staff/devices/[pushToken]/route'
import * as r52 from '@/app/api/v1/staff/devices/route'
import * as r53 from '@/app/api/v1/staff/me/route'
import * as r54 from '@/app/api/v1/staff/professionals/route'
import * as r55 from '@/app/api/v1/staff/services/route'
import * as r56 from '@/app/api/v1/staff/summary/route'
import * as r57 from '@/app/api/v1/staff/time-blocks/[id]/route'
import * as r58 from '@/app/api/v1/staff/time-blocks/route'
import * as r59 from '@/app/api/v1/staff/working-hours/[professionalId]/route'
import * as r60 from '@/app/api/v1/store/categories/route'
import * as r61 from '@/app/api/v1/store/options/route'
import * as r62 from '@/app/api/v1/store/postal-codes/[cep]/route'
import * as r63 from '@/app/api/v1/store/products/[id]/route'
import * as r64 from '@/app/api/v1/store/products/route'

export const ROUTE_MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'appointments/[id]/cancel/route.ts': r00,
  'appointments/[id]/reschedule/route.ts': r01,
  'appointments/[id]/route.ts': r02,
  'appointments/next/route.ts': r03,
  'appointments/route.ts': r04,
  'auth/customer/login/route.ts': r05,
  'auth/customer/logout/route.ts': r06,
  'auth/customer/password/forgot/route.ts': r07,
  'auth/customer/password/reset/route.ts': r08,
  'auth/customer/refresh/route.ts': r09,
  'auth/customer/register/route.ts': r10,
  'auth/customer/verify/route.ts': r11,
  'auth/staff/login/route.ts': r12,
  'auth/staff/logout/route.ts': r13,
  'auth/staff/refresh/route.ts': r14,
  'availability/days/route.ts': r15,
  'availability/route.ts': r16,
  'banners/route.ts': r17,
  'business/route.ts': r18,
  'health/route.ts': r19,
  'loyalty/me/route.ts': r20,
  'loyalty/me/statement/route.ts': r21,
  'loyalty/prizes/route.ts': r22,
  'loyalty/ranking/route.ts': r23,
  'loyalty/redemptions/[id]/cancel/route.ts': r24,
  'loyalty/redemptions/route.ts': r25,
  'me/addresses/[id]/route.ts': r26,
  'me/addresses/route.ts': r27,
  'me/delete/route.ts': r28,
  'me/devices/[pushToken]/route.ts': r29,
  'me/devices/route.ts': r30,
  'me/notifications/route.ts': r31,
  'me/password/route.ts': r32,
  'me/route.ts': r33,
  'openapi.json/route.ts': r34,
  'professionals/route.ts': r35,
  'services/route.ts': r36,
  'staff/agenda/route.ts': r37,
  'staff/appointments/[id]/adjust/route.ts': r38,
  'staff/appointments/[id]/cancel/route.ts': r39,
  'staff/appointments/[id]/complete/route.ts': r40,
  'staff/appointments/[id]/confirm/route.ts': r41,
  'staff/appointments/[id]/free-early/route.ts': r42,
  'staff/appointments/[id]/no-show/route.ts': r43,
  'staff/appointments/[id]/reschedule/route.ts': r44,
  'staff/appointments/[id]/route.ts': r45,
  'staff/appointments/[id]/undo/route.ts': r46,
  'staff/appointments/route.ts': r47,
  'staff/customers/[id]/appointments/route.ts': r48,
  'staff/customers/[id]/route.ts': r49,
  'staff/customers/route.ts': r50,
  'staff/devices/[pushToken]/route.ts': r51,
  'staff/devices/route.ts': r52,
  'staff/me/route.ts': r53,
  'staff/professionals/route.ts': r54,
  'staff/services/route.ts': r55,
  'staff/summary/route.ts': r56,
  'staff/time-blocks/[id]/route.ts': r57,
  'staff/time-blocks/route.ts': r58,
  'staff/working-hours/[professionalId]/route.ts': r59,
  'store/categories/route.ts': r60,
  'store/options/route.ts': r61,
  'store/postal-codes/[cep]/route.ts': r62,
  'store/products/[id]/route.ts': r63,
  'store/products/route.ts': r64,
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function definitionOf(exported: unknown): AnyRouteDef | null {
  if (typeof exported !== 'function' || !('definition' in exported)) return null
  return exported.definition as AnyRouteDef
}

/** Definição de toda rota exportada pelos arquivos do manifesto, na ordem dos arquivos e dos métodos. */
export function routeDefinitions(): AnyRouteDef[] {
  const found: AnyRouteDef[] = []
  for (const mod of Object.values(ROUTE_MODULES)) {
    for (const method of METHODS) {
      const def = definitionOf(mod[method])
      if (def) found.push(def)
    }
  }
  return found
}
