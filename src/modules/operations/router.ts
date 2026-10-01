import * as sqlite from './server-api.ts'
import * as supabase from './supabase-api.ts'
import { AppError } from './domain/validation.ts'

function provider() {
  const store = process.env.OPERATIONS_STORE
  if (store === 'supabase') return supabase
  if (!store || store === 'sqlite') return sqlite
  throw new AppError(503, 'Invalid OPERATIONS_STORE configuration')
}

type RouteName = 'sessionGet' | 'loginPost' | 'logoutPost' | 'enquiryPost' |
  'operationsGet' | 'schedulePost' | 'calendarsGet' | 'calendarPost' |
  'gmailLabelsGet' | 'gmailLabelPost' | 'syncPost' | 'changePost' |
  'googleConnectGet' | 'googleCallbackGet'

const route = (name: RouteName) => sqlite.safe((req) => provider()[name](req))

export const sessionGet = route('sessionGet')
export const loginPost = route('loginPost')
export const logoutPost = route('logoutPost')
export const enquiryPost = route('enquiryPost')
export const operationsGet = route('operationsGet')
export const schedulePost = route('schedulePost')
export const calendarsGet = route('calendarsGet')
export const calendarPost = route('calendarPost')
export const gmailLabelsGet = route('gmailLabelsGet')
export const gmailLabelPost = route('gmailLabelPost')
export const syncPost = route('syncPost')
export const changePost = route('changePost')
export const googleConnectGet = route('googleConnectGet')
export const googleCallbackGet = route('googleCallbackGet')
export const syncAll = () => provider().syncAll()
