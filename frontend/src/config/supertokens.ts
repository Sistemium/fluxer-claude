import SuperTokens from 'supertokens-web-js'
import EmailPassword from 'supertokens-web-js/recipe/emailpassword'
import Session from 'supertokens-web-js/recipe/session'

export function initSuperTokens() {
  SuperTokens.init({
    appInfo: {
      appName: "Fluxer",
      apiDomain: 'http://localhost:3000',
      websiteDomain: window.location.origin,
      apiBasePath: "/auth",
      websiteBasePath: "/auth"
    },
    recipeList: [
      EmailPassword.init(),
      Session.init()
    ]
  })
}