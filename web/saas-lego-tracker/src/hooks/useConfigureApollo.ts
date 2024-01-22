import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { fetchAuthSession } from 'aws-amplify/auth';
import { createAuthLink } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import { TenantSettings } from './useTenantSettings';

export function useConfigureApollo(tenantSettings: TenantSettings | null) {
    if (tenantSettings) {
        const subscriptionLink = createSubscriptionHandshakeLink({
            url: tenantSettings.graphqlEndpoint,
            region: tenantSettings.region,
            auth: {
                type: 'AWS_LAMBDA',
                token: async () => {
                    const currentSession = await fetchAuthSession();
                    return currentSession.tokens?.idToken ? `Bearer ${currentSession.tokens.idToken}` : '';
                },
            },
        });

        const authLink = createAuthLink({
            url: tenantSettings.graphqlEndpoint,
            region: tenantSettings.region,
            auth: {
                type: 'AWS_LAMBDA',
                token: async () => {
                    const currentSession = await fetchAuthSession();
                    return currentSession.tokens?.idToken ? `Bearer ${currentSession.tokens.idToken}` : '';
                },
            },
        });

        const client = new ApolloClient({
            cache: new InMemoryCache({}),
            link: ApolloLink.from([authLink, subscriptionLink]),
            defaultOptions: {
                watchQuery: {
                    fetchPolicy: 'cache-and-network',
                },
            },
        });

        return client;
    }

    return undefined;
}
