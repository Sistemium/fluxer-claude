import { Context } from 'koa'
import { SessionContainer } from 'supertokens-node/recipe/session'

export interface SessionContext extends Context {
  session: SessionContainer
}