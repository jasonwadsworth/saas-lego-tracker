import { AppSyncAuthorizerEvent, AppSyncAuthorizerResult, Context } from 'aws-lambda';

type ResolverContext = {
    tenantId: string;
};

export const handler = async (event: AppSyncAuthorizerEvent, context: Context): Promise<AppSyncAuthorizerResult<ResolverContext>> => {
    console.log(event);
    // auth token format should be "Bearer <TENANT_ID>"
    const authTokenParts = event.authorizationToken.split(' ');

    if (authTokenParts.length !== 2) {
        return {
            isAuthorized: false,
        };
    }

    const tenantId = authTokenParts[1];
    const resolverContext = {
        tenantId: tenantId,
        // the will return tenant2's role arn if it is tenant2, and tenant1's in all other cases
        // this means that you can see a failure by passing any value that it's either tenant1 or tenant2
        tenantRoleArn: tenantId === '01HHQVKK2X549Q276EK0TCCVZP' ? process.env.TENANT_2_ROLE_ARN : process.env.TENANT_1_ROLE_ARN,
    };

    // the denied fields are all the fields that were not explicitly allowed
    // ideally AppSync would change it to explicitly allow, but for now we have to invert it this means it's important to have a test to be sure
    //  everything in the schema is included in the list of mutations, queries, and types
    return {
        isAuthorized: true,
        resolverContext,
    };
};
