import { AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { TenantSettings } from './model';
import { Context } from 'aws-lambda';

const sts = new STSClient({});

export const handler = async (event: { tenantSettings: TenantSettings; user: User }, context: Context): Promise<void> => {
    console.log(event);

    const {
        tenantSettings: { awsAccount, region, tenantId, userPoolId },
        user,
    } = event;

    await createCognitoUser({ awsAccount, region, tenantId, user, userPoolId });
};

async function createCognitoUser({
    awsAccount,
    region,
    tenantId,
    user,
    userPoolId,
}: {
    awsAccount: string;
    region: string;
    tenantId: string;
    user: User;
    userPoolId: string;
}): Promise<void> {
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

    const cognitoIdentityProviderClient = new CognitoIdentityProviderClient({ credentials, region });

    const { email } = user;

    const adminCreateUser = new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: getUserAttributes({ tenantId, user }),
        DesiredDeliveryMediums: ['EMAIL'],
    });

    await cognitoIdentityProviderClient.send(adminCreateUser);
}

type User = {
    email: string;
    firstName: string;
    lastName: string;
};

type UserAttributes = {
    Name: string;
    Value: string;
};

function getUserAttributes({ tenantId, user }: { tenantId: string; user: User }): UserAttributes[] | undefined {
    const { email, firstName, lastName } = user;
    return [
        {
            Name: 'email',
            Value: email,
        },
        {
            Name: 'given_name',
            Value: firstName,
        },
        {
            Name: 'family_name',
            Value: lastName,
        },
        {
            Name: 'email_verified',
            Value: 'True',
        },
        {
            Name: 'preferred_username',
            Value: email,
        },
        {
            Name: 'dev:custom:tenant_id',
            Value: tenantId,
        },
    ];
}
