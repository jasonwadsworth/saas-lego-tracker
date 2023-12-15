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
        tenantRoleArn: 'arn:aws:iam::546385742337:role/Tenant1Role', // this should result in failures when the tenantId is not the correct one for tenant 1 (01HHNG3FHTRCHCRY26N72V5GQT)
    };

    // the denied fields are all the fields that were not explicitly allowed
    // ideally AppSync would change it to explicitly allow, but for now we have to invert it this means it's important to have a test to be sure
    //  everything in the schema is included in the list of mutations, queries, and types
    return {
        isAuthorized: true,
        resolverContext,
    };
};
