import { Context } from 'aws-lambda';
import {
    AliasAttributeType,
    CognitoIdentityProviderClient,
    CreateUserPoolClientCommand,
    CreateUserPoolCommand,
    ExplicitAuthFlowsType,
    OAuthFlowType,
    PreventUserExistenceErrorTypes,
    RecoveryOptionNameType,
    VerifiedAttributeType,
    AttributeDataType,
    UserPoolMfaType,
    SetUserPoolMfaConfigCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { JwtValidation, ProvisionTenant, TenantSettings } from './model';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const sts = new STSClient({});

export const handler = async (event: ProvisionTenant, context: Context): Promise<{ tenantSettings: TenantSettings; jwtValidation: JwtValidation }> => {
    console.log(event);

    const { awsAccount, domainName, region, tenantId } = event;

    const { tenantSettings, jwtValidation } = await createCognitoPool({
        awsAccount,
        domainName,
        region,
        tenantId,
    });

    return {
        tenantSettings,
        jwtValidation,
    };
};

export async function createCognitoPool({
    awsAccount,
    domainName,
    region,
    tenantId,
}: {
    awsAccount: string;
    domainName: string;
    region: string;
    tenantId: string;
}): Promise<{ tenantSettings: TenantSettings; jwtValidation: JwtValidation }> {
    const stsResponse = await sts.send(
        new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${awsAccount}:role/tenant-management/TenantProvisioning`, RoleSessionName: 'TenantProvisioning' }),
    );

    if (!stsResponse.Credentials || !stsResponse.Credentials.AccessKeyId || !stsResponse.Credentials.SecretAccessKey) {
        throw new Error('Unable to get credentials');
    }

    const credentials = {
        accessKeyId: stsResponse.Credentials.AccessKeyId,
        secretAccessKey: stsResponse.Credentials.SecretAccessKey,
        sessionToken: stsResponse.Credentials.SessionToken,
    };

    const ssm = new SSMClient({ credentials, region });

    const ssmResult = await ssm.send(
        new GetParameterCommand({
            Name: 'AccountInfo',
        }),
    );

    if (!ssmResult.Parameter?.Value) {
        throw new Error('Unable to locate account info.');
    }

    const { graphqlEndpoint } = JSON.parse(ssmResult.Parameter.Value) as { graphqlEndpoint: string };

    const cognitoClient = new CognitoIdentityProviderClient({
        credentials,
        region,
    });

    const createUserPool = new CreateUserPoolCommand({
        PoolName: tenantId,
        AutoVerifiedAttributes: [VerifiedAttributeType.EMAIL],
        AliasAttributes: [AliasAttributeType.PREFERRED_USERNAME],
        AdminCreateUserConfig: {
            AllowAdminCreateUserOnly: true,
        },
        AccountRecoverySetting: {
            RecoveryMechanisms: [
                {
                    Name: RecoveryOptionNameType.VERIFIED_EMAIL,
                    Priority: 1,
                },
            ],
        },
        // LambdaConfig: {
        //     PreTokenGeneration: preTokenGenerationFunctionArn,
        // },
        // this has to be done in a separate step in order to make it not support SMS
        // MfaConfiguration: UserPoolMfaType.ON,
        Schema: [
            {
                AttributeDataType: AttributeDataType.STRING,
                DeveloperOnlyAttribute: true,
                Mutable: false,
                Name: 'tenant_id',
                Required: false,
            },
        ],
        UsernameConfiguration: {
            CaseSensitive: false,
        },
    });

    const result = await cognitoClient.send(createUserPool);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const userPoolId = result.UserPool!.Id!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const userPoolArn = result.UserPool!.Arn!;

    await cognitoClient.send(
        new SetUserPoolMfaConfigCommand({
            UserPoolId: userPoolId,
            MfaConfiguration: UserPoolMfaType.ON,
            SoftwareTokenMfaConfiguration: {
                Enabled: true,
            },
        }),
    );

    const appClient = new CreateUserPoolClientCommand({
        ClientName: 'default',
        UserPoolId: userPoolId,
        AllowedOAuthFlows: [OAuthFlowType.code],
        AllowedOAuthFlowsUserPoolClient: true,
        CallbackURLs: [`https://${domainName}/login`],
        ExplicitAuthFlows: [ExplicitAuthFlowsType.ALLOW_USER_SRP_AUTH, ExplicitAuthFlowsType.ALLOW_REFRESH_TOKEN_AUTH],
        GenerateSecret: false,
        LogoutURLs: [`https://${domainName}/logout`],
        PreventUserExistenceErrors: PreventUserExistenceErrorTypes.ENABLED,
        RefreshTokenValidity: 30,
        AllowedOAuthScopes: ['email', 'openid', 'profile'],
    });

    const appClientResult = await cognitoClient.send(appClient);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const userPoolClientId = appClientResult.UserPoolClient!.ClientId!;

    const tenantSettings = { awsAccount, domainName, graphqlEndpoint, region, tenantId, userPoolId, userPoolClientId, userPoolArn };

    const jwtValidation: JwtValidation = {
        tenantId,
        audience: userPoolClientId,
        issuer: `https://cognito-idp.${tenantSettings.region}.amazonaws.com/${tenantSettings.userPoolId}`,
    };

    const dynamodb = DynamoDBDocumentClient.from(
        new DynamoDBClient({
            credentials,
            region,
        }),
    );

    await dynamodb.send(
        new PutCommand({
            Item: {
                pk: 'TenantSettings',
                sk: tenantId,
                ...tenantSettings,
            },
            TableName: 'TenantManagement',
        }),
    );
    await dynamodb.send(
        new PutCommand({
            Item: {
                pk: 'JwtValidation',
                sk: tenantId,
                ...jwtValidation,
            },
            TableName: 'TenantManagement',
        }),
    );

    return { tenantSettings, jwtValidation };
}
