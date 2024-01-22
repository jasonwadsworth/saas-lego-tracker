import { AppSyncAuthorizerEvent, AppSyncAuthorizerResult, Context } from 'aws-lambda';
import { decode, JwtPayload, verify } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { JwtValidation } from '../provision-tenant/model';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

type ResolverContext = {
    tenantId: string;
    tenantRoleArn: string;
};

export const handler = async (event: AppSyncAuthorizerEvent, context: Context): Promise<AppSyncAuthorizerResult<ResolverContext>> => {
    console.log(event);

    const awsAccount = context.invokedFunctionArn.split(':')[4];

    // auth token format should be "Bearer <token>"
    const authTokenParts = event.authorizationToken.split(' ');

    if (authTokenParts.length !== 2) {
        return {
            isAuthorized: false,
        };
    }

    const token = authTokenParts[1];

    try {
        const resolverContext = await authenticate({ awsAccount, token });
        // the denied fields are all the fields that were not explicitly allowed
        // ideally AppSync would change it to explicitly allow, but for now we have to invert it this means it's important to have a test to be sure
        //  everything in the schema is included in the list of mutations, queries, and types
        return {
            isAuthorized: true,
            resolverContext,
        };
    } catch {
        return {
            isAuthorized: false,
        };
    }
};

async function authenticate({ awsAccount, token }: { awsAccount: string; token: string }): Promise<ResolverContext> {
    const jwtPayload = await verifyToken({ token });

    const { aud, iss, userId, email, tenantId } = jwtPayload;

    if (!aud) throw new Error('Invalid or missing audience');
    if (!iss) throw new Error('Invalid or missing issuer');

    const jwtValidation = await getJwtValidation({ issuer: iss, audience: Array.isArray(aud) ? aud[0] : aud });

    if (!jwtValidation) {
        throw new Error('Token is not from a trusted source.');
    }

    const userPoolId = iss?.substring(iss.lastIndexOf('/') + 1);

    return {
        tenantId: tenantId,
        tenantRoleArn: `arn:aws:iam::${awsAccount}:role/tenant/${tenantId}`,
    };
}

async function verifyToken({ token }: { token: string }): Promise<JwtPayload> {
    const decodedToken = decode(token, { complete: true });
    if (!decodedToken) {
        throw new Error('Invalid token.');
    }

    const { kid } = decodedToken.header;
    const { iss: unverifiedIssuer } = decodedToken.payload as JwtPayload;
    const client = new JwksClient({
        jwksUri: `${unverifiedIssuer}/.well-known/jwks.json`,
    });

    const key = await client.getSigningKey(kid);
    const publicKey = key.getPublicKey();
    const verifiedToken = verify(token, publicKey, { complete: true });
    if (!verifiedToken) {
        throw new Error('Unable to verify token.');
    }

    return verifiedToken.payload as JwtPayload;
}

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function getJwtValidation({ audience, issuer }: { audience: string; issuer: string }): Promise<JwtValidation | null> {
    const response = await dynamodb.send(
        new GetCommand({
            Key: {
                pk: 'JwtValidation',
                sk: `${audience}|${issuer}`,
            },
            TableName: 'TenantManagement',
        }),
    );

    return response.Item ? (response.Item as JwtValidation) : null;
}
