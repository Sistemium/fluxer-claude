import supertokens from 'supertokens-node'
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js'
import Session from 'supertokens-node/recipe/session/index.js'
import Dashboard from 'supertokens-node/recipe/dashboard/index.js'

export function initSupertokens() {
  console.log('Initializing SuperTokens with:', {
    connectionURI: process.env.SUPERTOKENS_CONNECTION_URI,
    apiKey: process.env.SUPERTOKENS_API_KEY ? 'SET' : 'NOT_SET'
  })
  
  supertokens.init({
    // debug: true,
    framework: "koa",
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_CONNECTION_URI || 'https://try.supertokens.com',
      apiKey: process.env.SUPERTOKENS_API_KEY as string,
    },
    appInfo: {
      appName: "Fluxer",
      apiDomain: process.env.API_DOMAIN || 'http://localhost:3000',
      websiteDomain: process.env.WEBSITE_DOMAIN || 'http://localhost:5173',
      apiBasePath: "/auth",
      websiteBasePath: "/auth"
    },
    recipeList: [
      EmailPassword.init({
        // signUpFeature: {
        //   formFields: [{
        //     id: "email",
        //     validate: async (value) => {
        //       if (typeof value !== "string") {
        //         return "Please provide a valid email"
        //       }
        //       return undefined
        //     }
        //   }]
        // }
      }),
      Session.init({
        // ...(process.env.NODE_ENV === 'production' && { cookieDomain: '.yourdomain.com' }),
        // cookieSecure: process.env.NODE_ENV === 'production',
        // cookieSameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
      }),
      Dashboard.init({
        apiKey: process.env.SUPERTOKENS_API_KEY as string
      })
    ]
  })
}